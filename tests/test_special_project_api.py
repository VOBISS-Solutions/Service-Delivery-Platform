import http.client
import io
import json
from pathlib import Path
import tempfile
import sqlite3
import threading
import unittest
from unittest.mock import patch

from openpyxl import Workbook
import app
import special_projects as sp


def payload():
    book = Workbook()
    sheet = book.active
    sheet.title = 'Link Status Tracker'
    sheet.append(['No', 'Link Type', 'Link', *sp.STAGE_NAMES])
    sheet.append([1, '10G CSG', 'API Test A-B', *(['Completed'] + ['Not Started'] * 11)])
    stream = io.BytesIO()
    book.save(stream)
    book.close()
    return stream.getvalue()


class SpecialProjectAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = patch.multiple(app, DB_PATH=Path(self.directory.name) / 'test.db',
                                       USING_POSTGRES=False, DATABASE_URL=None,
                                       APP_PASSWORD='local-test-only', connect=self.connect)
        self.settings.start()
        app.init_db()
        sp.init_store(app.connect, app.sql)
        self.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.TrackerHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.cookie = None

    def connect(self):
        class ClosingConnection(sqlite3.Connection):
            def __exit__(self, *args):
                try:
                    return super().__exit__(*args)
                finally:
                    self.close()
        connection = sqlite3.connect(Path(self.directory.name) / 'test.db', factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        if self.cookie:
            app.SESSIONS.discard(self.cookie.split('=', 1)[1])
        self.settings.stop()
        self.directory.cleanup()

    def request(self, method, url, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        outgoing = dict(headers or {})
        if self.cookie:
            outgoing['Cookie'] = self.cookie
        connection.request(method, url, body=body, headers=outgoing)
        response = connection.getresponse()
        content = response.read()
        result = response.status, dict(response.getheaders()), content
        connection.close()
        return result

    def login(self):
        status, headers, _ = self.request('POST', '/api/login', json.dumps({'password': 'local-test-only'}))
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';', 1)[0]

    def test_authentication_required(self):
        for method, url in [('GET', '/api/special-projects'), ('POST', '/api/special-projects/import')]:
            status, _, _ = self.request(method, url)
            self.assertEqual(status, 401)

    def test_persistence_and_repeat_import(self):
        self.login()
        self.assertEqual(json.loads(self.request('GET', '/api/special-projects')[2])['links'], [])
        for _ in range(2):
            status, _, content = self.request('POST', '/api/special-projects/import', payload())
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(content)['total_links'], 1)
        snapshot = json.loads(self.request('GET', '/api/special-projects')[2])
        self.assertEqual(len(snapshot['links']), 1)
        self.assertEqual(snapshot['links'][0]['status'], 'In Progress')
        self.assertAlmostEqual(snapshot['links'][0]['fraction'], 1 / 12)
        self.assertEqual(app.get_projects({}), [], 'Special links must not enter ordinary Projects')
        self.assertEqual(sp.read_snapshot(app.connect, app.sql), snapshot)

    def test_bad_import_keeps_previous_snapshot(self):
        self.login()
        self.request('POST', '/api/special-projects/import', payload())
        before = self.request('GET', '/api/special-projects')[2]
        self.assertEqual(self.request('POST', '/api/special-projects/import', b'invalid')[0], 400)
        self.assertEqual(self.request('GET', '/api/special-projects')[2], before)

    def test_cross_origin_and_oversize_rejected(self):
        self.login()
        self.assertEqual(self.request('POST', '/api/special-projects/import', payload(), {'Origin': 'https://unrelated.example'})[0], 403)
        self.assertEqual(self.request('POST', '/api/special-projects/import', headers={'Content-Length': str(sp.MAX_COMPRESSED + 1)})[0], 400)

    def test_special_assets_are_authenticated(self):
        self.assertEqual(self.request('GET', '/special-projects.html')[0], 302)
        self.login()
        status, _, body = self.request('GET', '/special-projects.html')
        self.assertEqual(status, 200)
        self.assertIn(b'Import workbook', body)


if __name__ == '__main__':
    unittest.main()
