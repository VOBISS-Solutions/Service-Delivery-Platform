import hashlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import MagicMock, patch
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from openpyxl import Workbook

import special_projects as sp


STAGES = ('Cable Stringing', 'Cable Entry - Site A', 'Cable Entry - Site B',
          'Fiber Splicing', 'ODF Termination - Site A', 'ODF Termination - Site B',
          'OTDR / Fiber Test', 'Nokia Install - Site A', 'Nokia Install - Site B',
          'Power-up & Commissioning', 'Provisioning', 'Service Up (E2E Test)')
HEADERS = ['No', 'Link Type', 'Link', 'Site A', 'Site B', 'Fiber Link', 'Priority',
           *STAGES, 'Current Blocker / Issue', 'Responsible', 'Remarks', 'Last Updated']


def workbook(rows=(), headers=HEADERS, offset=0, sheet='Link Status Tracker'):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    for _ in range(offset):
        ws.append(['Title'])
    ws.append(list(headers))
    for row in rows:
        ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    wb.close()
    return out.getvalue()


def link(statuses=None, number=1, name='A-B', kind='Backbone'):
    return [number, kind, name, 'A', 'B', 'Yes', 'High',
            *(statuses or ['Not Started'] * 12), 'Issue', 'Team', 'Notes', '2026-10-29']


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.path = Path(self.tmp.name) / 'store.db'
        self.sql = lambda query: query
        sp.init_store(self.connect, self.sql)

    def tearDown(self):
        self.tmp.cleanup()

    def connect(self):
        class ClosingConnection(sqlite3.Connection):
            def __exit__(self, *args):
                try:
                    return super().__exit__(*args)
                finally:
                    self.close()
        conn = sqlite3.connect(self.path, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def load(self, payload):
        return sp.import_snapshot(payload, self.connect, self.sql)

    def read(self):
        return sp.read_snapshot(self.connect, self.sql)

    def automated(self, payload, filename='tracker.xlsx'):
        return sp.import_snapshot(payload, self.connect, self.sql,
                                  source='power_automate', filename=filename)

    def test_automated_retry_skips_parse_and_preserves_import_time(self):
        payload = workbook([link()])
        class Clock(datetime):
            current = datetime(2026, 10, 29, tzinfo=timezone.utc)

            @classmethod
            def now(cls, tz=None):
                return cls.current
        with patch.object(sp, 'datetime', Clock):
            first = self.automated(payload)
            Clock.current = datetime(2026, 10, 30, tzinfo=timezone.utc)
            with patch.object(sp, '_parse_links', side_effect=AssertionError('parsed retry')):
                retry = self.automated(payload, 'retry.xlsx')
        self.assertFalse(first['unchanged'])
        self.assertTrue(retry['unchanged'])
        self.assertEqual(retry['imported_at'], first['imported_at'])
        self.assertGreater(retry['last_received_at'], first['last_received_at'])
        self.assertEqual(retry['links'], first['links'])
        self.assertEqual(retry['connection'], 'power_automate')
        self.assertEqual(retry['source_filename'], 'retry.xlsx')
        self.assertEqual(retry['content_sha256'], hashlib.sha256(payload).hexdigest())
        self.assertEqual(self.read(), {k: v for k, v in retry.items() if k != 'unchanged'})

    def test_changed_automated_import_and_manual_hash(self):
        payload_a = workbook([link()])
        payload_b = workbook([link(name='B-C')])
        first = self.automated(payload_a)
        changed = self.automated(payload_b)
        self.assertFalse(changed['unchanged'])
        self.assertNotEqual(changed['imported_at'], first['imported_at'])
        manual = self.load(payload_b)
        self.assertEqual(manual['connection'], 'imported')
        self.assertEqual(manual['content_sha256'], hashlib.sha256(payload_b).hexdigest())
        restored = self.automated(payload_a)
        self.assertFalse(restored['unchanged'])
        self.assertEqual(restored['links'], first['links'])

    def test_automated_failures_preserve_all_metadata(self):
        before = self.automated(workbook([link()]))
        persisted = self.read()
        for payload in (b'bad', workbook(), workbook([link(['bad'] * 12)])):
            with self.assertRaises(ValueError):
                self.automated(payload)
            self.assertEqual(self.read(), persisted)
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT imported_at FROM special_project_sources')
                             .fetchone()[0], before['imported_at'])

    def test_initial_parse_failure_rolls_back_transaction(self):
        transactions = []
        def connect():
            conn = self.connect()
            conn.set_trace_callback(transactions.append)
            return conn
        with self.assertRaises(ValueError):
            sp.import_snapshot(b'bad', connect, self.sql, source='power_automate')
        self.assertIn('BEGIN IMMEDIATE', transactions)
        self.assertIn('ROLLBACK', transactions)
        self.assertEqual(self.read()['connection'], 'not_configured')
        self.assertFalse(self.automated(workbook([link()]))['unchanged'])

    def test_concurrent_identical_imports_parse_once(self):
        payload = workbook([link()])
        entered = Event()
        release = Event()
        original = sp._parse_links

        def parse(value):
            entered.set()
            if not release.wait(5):
                raise AssertionError('Import was not released')
            return original(value)

        with patch.object(sp, '_parse_links', side_effect=parse) as parser:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(self.automated, payload)
                try:
                    self.assertTrue(entered.wait(5))
                    second = pool.submit(self.automated, payload)
                finally:
                    release.set()
                results = [first.result(timeout=10), second.result(timeout=10)]
            self.assertEqual(parser.call_count, 1)
        self.assertEqual([r['unchanged'] for r in results], [False, True])
        self.assertEqual(results[0]['imported_at'], results[1]['imported_at'])

    def test_postgres_lock_is_inside_transaction_before_parse(self):
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = None
        adapter = lambda query: query.replace('?', '%s')

        def parse(payload):
            conn.__enter__.assert_called_once()
            self.assertEqual(conn.execute.call_args_list[0].args,
                             ('SELECT pg_advisory_xact_lock(%s)', (sp.IMPORT_LOCK_KEY,)))
            raise ValueError('parse failed')

        with patch.object(sp, '_parse_links', side_effect=parse):
            with self.assertRaisesRegex(ValueError, 'parse failed'):
                sp.import_snapshot(b'bad', lambda: conn, adapter, source='power_automate')
        self.assertIs(conn.__exit__.call_args.args[0], ValueError)
        conn.close.assert_called_once()
        self.assertFalse(any('INSERT' in call.args[0] for call in conn.execute.call_args_list))

    def test_failed_retry_write_preserves_receipt_metadata(self):
        payload = workbook([link()])
        self.automated(payload)
        before = self.read()
        with self.connect() as conn:
            conn.execute('''CREATE TRIGGER fail_update BEFORE UPDATE ON special_project_sources
                BEGIN SELECT RAISE(ABORT, 'test failure'); END''')
        with self.assertRaises(sqlite3.IntegrityError):
            self.automated(payload, 'retry.xlsx')
        self.assertEqual(self.read(), before)

    def test_default_and_empty_import(self):
        self.assertEqual(self.read(), dict(title='4G Transport', workbook_url=sp.WORKBOOK_URL,
                         imported_at=None, connection='not_configured', links=[]))
        with self.assertRaisesRegex(ValueError, 'no valid links'):
            self.load(workbook())
        self.assertEqual(self.read()['connection'], 'not_configured')
        result = self.load(workbook([link()]))
        self.assertTrue(result['imported_at'].endswith('Z'))

    def test_empty_import_preserves_existing_snapshot(self):
        before = self.load(workbook([link()]))
        for payload in (workbook(), workbook([link(name='  ')])):
            with self.assertRaisesRegex(ValueError, 'no valid links'):
                self.load(payload)
            self.assertEqual(self.read(), before)

    def test_progress_mapping_persistence_and_repeat(self):
        payload = workbook([link(['Completed'] * 6 + ['N/A'] * 6)])
        first = self.load(payload)
        item = first['links'][0]
        self.assertEqual(item['fraction'], 1)
        self.assertEqual(item['status'], 'Completed')
        self.assertEqual(item['team'], 'Team')
        self.assertEqual(len(item['stages']), 12)
        self.assertEqual(self.read(), first)
        self.assertEqual(self.load(payload)['links'], first['links'])
        with self.connect() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM special_project_sources').fetchone()[0], 1)

    def test_overall_statuses(self):
        cases = [(['Blocked'] + ['Completed'] * 11, 'Blocked', 11/12),
                 (['In Progress'] + ['Not Started'] * 11, 'In Progress', 0),
                 (['Completed'] + ['Not Started'] * 11, 'In Progress', 1/12),
                 (['Not Started'] * 12, 'Not Started', 0),
                 (['N/A'] * 12, 'Not Started', 0)]
        for stages, status, fraction in cases:
            with self.subTest(status=status, stages=stages):
                item = self.load(workbook([link(stages)]))['links'][0]
                self.assertEqual(item['status'], status)
                self.assertAlmostEqual(item['fraction'], fraction)

    def test_header_normalization_and_blank_links(self):
        headers = [value.upper().replace(' ', '\n').replace('-', '.') for value in HEADERS]
        result = self.load(workbook([link(name=' '), link()], headers, 9))
        self.assertEqual(len(result['links']), 1)

    def test_validation_preserves_snapshot(self):
        before = self.load(workbook([link()]))
        invalid = [b'bad', workbook(sheet='Other'), workbook(headers=HEADERS[:18]),
                   workbook(offset=10), workbook([link(), link()]),
                   workbook([link([None] * 12)]), workbook([link(['Done'] * 12)]),
                   workbook([link(['=IF(1=1,"Completed","Blocked")'] * 12)]),
                   workbook([link(name='x' * 501)])]
        for payload in invalid:
            with self.subTest(size=len(payload)):
                with self.assertRaises(ValueError):
                    self.load(payload)
                self.assertEqual(self.read(), before)

    def test_row_error_and_fallback_identity(self):
        with self.assertRaisesRegex(ValueError, 'Row 2'):
            self.load(workbook([link(['bad'] * 12)]))
        first = self.load(workbook([link(number=None)]))['links'][0]['id']
        self.assertEqual(first, self.load(workbook([link(number=None)]))['links'][0]['id'])
        with self.assertRaises(ValueError):
            self.load(workbook([link(number=None), link(number=None)]))

    def test_limits(self):
        with patch.object(sp, 'MAX_COMPRESSED', 10):
            with self.assertRaises(ValueError):
                self.load(workbook())
        with patch.object(sp, 'MAX_UNCOMPRESSED', 10):
            with self.assertRaises(ValueError):
                self.load(workbook())
        with patch.object(sp, 'MAX_LINKS', 1):
            with self.assertRaises(ValueError):
                self.load(workbook([link(), link(number=2)]))

    def test_sql_adapter_is_used(self):
        calls = []
        def adapter(query):
            calls.append(query)
            return query
        sp.init_store(self.connect, adapter)
        sp.import_snapshot(workbook([link()]), self.connect, adapter)
        sp.read_snapshot(self.connect, adapter)
        self.assertTrue(any('ON CONFLICT' in query for query in calls))
        self.assertTrue(any('?' in query for query in calls))

    def test_cached_formula_statuses(self):
        payload = workbook([link(['=IF(TRUE,"Completed","Blocked")'] * 12)])
        output = io.BytesIO()
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        with ZipFile(io.BytesIO(payload)) as source, ZipFile(output, 'w') as target:
            for member in source.infolist():
                content = source.read(member)
                if member.filename == 'xl/worksheets/sheet1.xml':
                    root = ET.fromstring(content)
                    for cell in root.findall('.//s:c', ns):
                        if cell.find('s:f', ns) is not None:
                            cell.set('t', 'str')
                            cell.find('s:v', ns).text = 'Completed'
                    content = ET.tostring(root)
                target.writestr(member, content)
        self.assertEqual(self.load(output.getvalue())['links'][0]['status'], 'Completed')

    def test_failed_database_write_rolls_back(self):
        before = self.load(workbook([link()]))
        with self.connect() as conn:
            conn.execute('''CREATE TRIGGER fail_update BEFORE UPDATE ON special_project_sources
                BEGIN SELECT RAISE(ABORT, 'test failure'); END''')
        with self.assertRaises(sqlite3.IntegrityError):
            self.load(workbook([link(number=2)]))
        self.assertEqual(self.read(), before)

    def test_replaces_previous_rows_and_stable_number_identity(self):
        first = self.load(workbook([link(), link(number=2)]))
        second = self.load(workbook([link(name='Renamed')]))
        self.assertEqual(len(second['links']), 1)
        self.assertEqual(first['links'][0]['id'], second['links'][0]['id'])
        self.assertEqual(self.read(), second)

    def test_duplicate_headers_and_non_xlsx_zip(self):
        with self.assertRaises(ValueError):
            self.load(workbook(headers=[*HEADERS, 'Link']))
        output = io.BytesIO()
        with ZipFile(output, 'w') as archive:
            archive.writestr('other.txt', 'not a workbook')
        with self.assertRaises(ValueError):
            self.load(output.getvalue())
        for value in (None, b'', 'text'):
            with self.assertRaises(ValueError):
                self.load(value)

    def test_sparse_worksheet_coordinates_are_rejected(self):
        original = workbook([link()])
        output = io.BytesIO()
        with ZipFile(io.BytesIO(original)) as source, ZipFile(output, 'w') as target:
            for member in source.infolist():
                content = source.read(member.filename)
                if member.filename == 'xl/worksheets/sheet1.xml':
                    content = content.replace(b'r="2"', b'r="900000"')
                    content = content.replace(b'2"', b'900000"')
                target.writestr(member, content)
        with self.assertRaisesRegex(ValueError, 'worksheet limits'):
            self.load(output.getvalue())


if __name__ == '__main__':
    unittest.main()
