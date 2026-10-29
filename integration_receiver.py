"""Narrow, cookie-independent workbook delivery boundary for Power Automate."""
import hmac
import ipaddress
import os
import socket
from threading import Lock

import special_projects

UPLOAD_PATH = '/api/integrations/special-projects/workbook'
EXPECTED_FILENAME = '4G Transport link plan_19.10.26.xlsx'
_UPLOAD_LOCK = Lock()


def receive_workbook(handler, connect, sql, respond):
    # Rejected requests are never reused with an unread body still buffered.
    handler.close_connection = True
    secret = os.environ.get('SPECIAL_PROJECTS_INTEGRATION_KEY', '')
    if len(secret) < 32:
        return respond(handler, {'error': 'Workbook integration is not configured'}, 503)
    supplied = handler.headers.get('X-Integration-Key', '')
    if not hmac.compare_digest(supplied.encode('utf-8'), secret.encode('utf-8')):
        return respond(handler, {'error': 'Invalid integration credentials'}, 401)
    native_tls = callable(getattr(handler.connection, 'cipher', None))
    try:
        peer = ipaddress.ip_address(handler.client_address[0])
        trusted_proxy = any(peer in ipaddress.ip_network(value.strip()) for value in
                            os.environ.get('SPECIAL_PROJECTS_TRUSTED_PROXIES', '').split(',') if value.strip())
    except ValueError:
        return respond(handler, {'error': 'Integration proxy configuration is invalid'}, 503)
    forwarded_tls = trusted_proxy and handler.headers.get('X-Forwarded-Proto', '').lower() == 'https'
    if not native_tls and not forwarded_tls:
        return respond(handler, {'error': 'HTTPS delivery is required'}, 403)
    if handler.headers.get_content_type() != 'application/octet-stream':
        return respond(handler, {'error': 'Send raw workbook binary as application/octet-stream'}, 415)
    filename = handler.headers.get('X-Source-Filename', '')
    expected = os.environ.get('SPECIAL_PROJECTS_SOURCE_FILENAME', EXPECTED_FILENAME)
    if not filename or filename != expected or any(char in filename for char in ('/', '\\', '\x00')):
        return respond(handler, {'error': 'Unexpected source workbook filename'}, 400)
    lengths = handler.headers.get_all('Content-Length', [])
    if handler.headers.get('Transfer-Encoding') or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
        return respond(handler, {'error': 'A single Content-Length is required; chunking is unsupported'}, 400)
    if len(lengths[0]) > 8:
        return respond(handler, {'error': 'Workbook exceeds the 20 MB limit'}, 413)
    length = int(lengths[0])
    if length > special_projects.MAX_COMPRESSED:
        return respond(handler, {'error': 'Workbook exceeds the 20 MB limit'}, 413)
    if length <= 0:
        return respond(handler, {'error': 'Workbook binary is empty'}, 400)
    if not _UPLOAD_LOCK.acquire(blocking=False):
        return respond(handler, {'error': 'A workbook upload is already running; retry later'}, 429)
    previous_timeout = handler.connection.gettimeout()
    try:
        handler.connection.settimeout(60)
        payload = handler.rfile.read(length)
        if len(payload) != length:
            raise ValueError('Incomplete workbook binary')
        snapshot = special_projects.import_snapshot(payload, connect, sql, source='power_automate', filename=filename)
        unchanged = snapshot.get('unchanged', False)
        return respond(handler, {
            'ok': True, 'imported': not unchanged, 'unchanged': unchanged,
            'total_links': len(snapshot['links']), 'imported_at': snapshot['imported_at'],
            'last_received_at': snapshot['last_received_at'],
        })
    except (socket.timeout, TimeoutError):
        return respond(handler, {'error': 'Workbook upload timed out'}, 408)
    except ValueError as exc:
        return respond(handler, {'error': str(exc)}, 400)
    except Exception:
        handler.log_error('Power Automate workbook import failed')
        return respond(handler, {'error': 'Workbook import failed; previous snapshot retained'}, 500)
    finally:
        _UPLOAD_LOCK.release()
        handler.connection.settimeout(previous_timeout)
