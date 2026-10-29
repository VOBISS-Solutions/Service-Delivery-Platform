import json
import os
from unittest.mock import patch
import unittest

import app
import integration_receiver
import special_projects as sp
import test_special_project_api as api_tests

ROUTE = '/api/integrations/special-projects/workbook'
FILENAME = '4G Transport link plan_19.10.26.xlsx'
TEST_KEY = 'test-integration-only-' + 'x' * 32


class PowerAutomateTests(api_tests.SpecialProjectAPITests):
    def setUp(self):
        super().setUp()
        self.environment = patch.dict(os.environ, {
            'SPECIAL_PROJECTS_INTEGRATION_KEY': TEST_KEY,
            'SPECIAL_PROJECTS_TRUSTED_PROXIES': '127.0.0.1/32',
        })
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        super().tearDown()

    def headers(self, **extra):
        return {'X-Integration-Key': TEST_KEY, 'Content-Type': 'application/octet-stream',
                'X-Source-Filename': FILENAME, 'X-Forwarded-Proto': 'https', **extra}

    def test_machine_upload_and_exact_retry(self):
        workbook = api_tests.payload()
        status, _, content = self.request('POST', ROUTE, workbook, self.headers())
        self.assertEqual(status, 200)
        first = json.loads(content)
        self.assertTrue(first['imported'])
        self.assertEqual(first['total_links'], 1)
        status, _, content = self.request('POST', ROUTE, workbook, self.headers())
        second = json.loads(content)
        self.assertEqual(status, 200)
        self.assertTrue(second['unchanged'])
        self.assertEqual(first['imported_at'], second['imported_at'])
        snapshot = sp.read_snapshot(app.connect, app.sql)
        self.assertEqual(snapshot['connection'], 'power_automate')
        self.assertEqual(len(snapshot['links']), 1)

    def test_no_session_bypass_or_scope_expansion(self):
        self.login()
        self.assertEqual(self.request('POST', ROUTE, b'')[0], 401)
        self.cookie = None
        self.assertEqual(self.request('GET', '/api/special-projects', headers=self.headers())[0], 401)
        self.assertEqual(self.request('POST', '/api/projects', b'{}', self.headers())[0], 401)

    def test_configuration_and_bad_keys(self):
        for key in ('', 'short'):
            with patch.dict(os.environ, {'SPECIAL_PROJECTS_INTEGRATION_KEY': key}):
                self.assertEqual(self.request('POST', ROUTE, b'x', self.headers())[0], 503)
        for key in ('wrong-key', '\u00e9'):
            self.assertEqual(self.request('POST', ROUTE, b'x', self.headers(**{'X-Integration-Key': key}))[0], 401)

    def test_binary_filename_and_https_contract(self):
        for extra in ({'Content-Type': 'application/json'}, {'X-Source-Filename': ''},
                      {'X-Source-Filename': '../' + FILENAME}, {'X-Source-Filename': 'other.xlsx'},
                      {'X-Forwarded-Proto': 'http'}):
            self.assertIn(self.request('POST', ROUTE, b'', self.headers(**extra))[0], (400, 403, 415))
        self.assertEqual(self.request('POST', ROUTE, json.dumps({'$content': 'abc'}), self.headers())[0], 400)
        self.assertEqual(self.request('POST', ROUTE, b'', self.headers())[0], 400)
        self.assertEqual(self.request('POST', ROUTE, b'x', self.headers(**{'Content-Length': str(sp.MAX_COMPRESSED + 1)}))[0], 413)

    def test_bad_upload_retains_existing_snapshot(self):
        self.request('POST', ROUTE, api_tests.payload(), self.headers())
        before = sp.read_snapshot(app.connect, app.sql)
        self.assertEqual(self.request('POST', ROUTE, b'invalid', self.headers())[0], 400)
        self.assertEqual(sp.read_snapshot(app.connect, app.sql), before)

    def test_forwarded_tls_requires_trusted_peer(self):
        with patch.dict(os.environ, {'SPECIAL_PROJECTS_TRUSTED_PROXIES': ''}):
            self.assertEqual(self.request('POST', ROUTE, b'', self.headers())[0], 403)

    def test_extreme_content_length_is_rejected(self):
        self.assertEqual(self.request('POST', ROUTE, b'', self.headers(**{
            'Content-Length': '9' * 5000,
        }))[0], 413)

    def test_invalid_framing_is_rejected(self):
        for extra in ({'Content-Length': '-1'}, {'Content-Length': 'abc'},
                      {'Transfer-Encoding': 'chunked'}):
            self.assertEqual(self.request('POST', ROUTE, b'', self.headers(**extra))[0], 400)

    def test_invalid_proxy_config_disables_upload(self):
        with patch.dict(os.environ, {'SPECIAL_PROJECTS_TRUSTED_PROXIES': 'not-a-network'}):
            self.assertEqual(self.request('POST', ROUTE, b'', self.headers())[0], 503)

    def test_busy_import_rejects_parallel_upload(self):
        integration_receiver._UPLOAD_LOCK.acquire()
        try:
            self.assertEqual(self.request('POST', ROUTE, b'x', self.headers())[0], 429)
        finally:
            integration_receiver._UPLOAD_LOCK.release()

    def test_internal_error_is_sanitized_and_lock_released(self):
        with patch.object(sp, 'import_snapshot', side_effect=RuntimeError('private-connection-details')):
            status, _, content = self.request('POST', ROUTE, b'x', self.headers())
            self.assertEqual(status, 500)
            self.assertNotIn(b'private-connection-details', content)
        self.assertEqual(self.request('POST', ROUTE, api_tests.payload(), self.headers())[0], 200)


if __name__ == '__main__':
    unittest.main()
