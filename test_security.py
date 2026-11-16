"""Security regressions run exclusively against a disposable landing instance."""

import base64
import copy
from contextlib import redirect_stdout
import http.client
import http.cookiejar
import io
import json
import os
import tempfile
import time
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from PIL import Image, PngImagePlugin

import server
import manage_site
from security import RateLimiter, affiliate_url, clean_content, parse_json, sanitize_image

CONTENT = {
    'settings': {'name': 'Teste', 'headline': 'Ofertas', 'description': 'Conteúdo de teste'},
    'groups': [{'name': 'Grupo A', 'category': 'Ofertas', 'description': '', 'icon': '', 'color': 'sage', 'url': 'https://chat.whatsapp.com/group-a'}],
    'offers': [],
    'reviews': [],
}


def png_bytes(size=(3, 3)):
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text('Comment', 'private metadata')
    Image.new('RGB', size, 'white').save(output, format='PNG', pnginfo=metadata)
    return output.getvalue()


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_root = server.ROOT
        cls.temporary = tempfile.TemporaryDirectory()
        server.ROOT = Path(cls.temporary.name)
        cls.environment = patch.dict(os.environ, {'ADMIN_PASSWORD': 'disposable-test-password', 'APP_ENV': 'development', 'PUBLIC_ORIGIN': ''})
        cls.environment.start()
        server.initialize()
        (server.ROOT / 'dist').mkdir()
        (server.ROOT / 'dist/index.html').write_text('<!doctype html><p>Test</p>')
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.environment.stop()
        server.ROOT = cls.original_root
        cls.temporary.cleanup()

    def setUp(self):
        server.sessions.clear()
        server.limiter = RateLimiter()
        with server.db() as connection:
            connection.execute("UPDATE config SET value=? WHERE key='content'", (json.dumps(CONTENT),))
        self.jar = http.cookiejar.CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.jar))
        self.csrf = json.load(self.client.open(self.base + '/api/session'))['csrf_token']

    def request(self, path, data=None, headers=None, method=None):
        request_headers = {'Content-Type': 'application/json', 'X-CSRF-Token': self.csrf}
        request_headers.update(headers or {})
        body = json.dumps(data).encode() if data is not None else None
        return self.client.open(Request(self.base + path, body, request_headers, method=method), timeout=10)

    def authenticate(self):
        with self.request('/api/login', {'password': 'disposable-test-password'}) as response:
            self.assertEqual(response.status, 200)

    def expect_error(self, code, path, data=None, headers=None, method=None):
        with self.assertRaises(HTTPError) as error:
            self.request(path, data, headers, method)
        self.assertEqual(error.exception.code, code)
        error.exception.close()
        return error.exception

    def test_authentication_and_logout(self):
        for path in ('/api/content', '/api/upload', '/api/logout'):
            self.expect_error(401, path, {})
        self.expect_error(401, '/api/login', {'password': 'incorrect-password'})
        self.authenticate()
        with self.request('/api/session') as response:
            self.assertTrue(json.load(response)['authenticated'])
        with self.request('/api/content', CONTENT) as response:
            self.assertEqual(response.status, 200)
        self.request('/api/logout', {}).close()
        self.expect_error(401, '/api/content', CONTENT)

    def test_csrf_requires_signed_header_and_matching_cookie_even_without_origin(self):
        self.expect_error(403, '/api/login', {'password': 'incorrect'}, {'X-CSRF-Token': ''})
        self.authenticate()
        self.expect_error(403, '/api/content', CONTENT, {'X-CSRF-Token': ''})
        self.expect_error(403, '/api/content', CONTENT, {'X-CSRF-Token': 'forged'})
        self.expect_error(403, '/api/content', CONTENT, {'X-CSRF-Token': server.new_csrf_token()})
        self.expect_error(403, '/api/content', CONTENT, {'Origin': 'https://attacker.example'})
        self.expect_error(403, '/api/content', CONTENT, {'Sec-Fetch-Site': 'cross-site'})
        self.request('/api/content', CONTENT).close()

    def test_login_rate_limit_and_bounded_state(self):
        for _ in range(10):
            self.expect_error(401, '/api/login', {'password': 'incorrect'})
        self.expect_error(429, '/api/login', {'password': 'incorrect'})
        bounded = RateLimiter(max_keys=2)
        for key in range(5):
            bounded.allow(key, 1, 60)
        self.assertEqual(len(bounded.entries), 2)

    def test_unknown_fields_are_rejected_and_legacy_private_fields_filtered(self):
        self.authenticate()
        for extra in ({'secret': 'private'}, {'settings': {**CONTENT['settings'], 'secret': 'private'}}):
            self.expect_error(400, '/api/content', {**CONTENT, **extra})
        with server.db() as connection:
            connection.execute("UPDATE config SET value=? WHERE key='content'", (json.dumps({**CONTENT, 'secret': 'private'}),))
        with self.request('/api/content') as response:
            self.assertNotIn('secret', json.load(response))

    def test_upload_reencodes_pixels_and_strips_metadata_and_trailing_content(self):
        self.authenticate()
        raw = png_bytes() + b'<script>trailing content</script>'
        with self.request('/api/upload', {'data': base64.b64encode(raw).decode()}) as response:
            path = json.load(response)['url']
        with self.request(path) as response:
            processed = response.read()
        self.assertNotIn(b'<script>', processed)
        self.assertNotIn(b'private metadata', processed)
        with Image.open(io.BytesIO(processed)) as image:
            self.assertEqual(image.format, 'WEBP')
            self.assertEqual(image.size, (3, 3))
        self.assertTrue((server.ROOT / 'data/uploads' / Path(path).name).is_file())

    def test_malformed_oversized_images_and_storage_quota(self):
        self.authenticate()
        for raw in (b'\x89PNG\r\n\x1a\nmalformed', b'<script>bad</script>', png_bytes((6001, 1))):
            self.expect_error(400, '/api/upload', {'data': base64.b64encode(raw).decode()})
        with self.assertRaises(ValueError):
            sanitize_image('A' * 6_666_669)
        with patch.object(server, 'MAX_UPLOAD_STORAGE', 1):
            self.expect_error(413, '/api/upload', {'data': base64.b64encode(png_bytes()).decode()})
        self.expect_error(413, '/api/content', {}, {'Content-Length': '8000000'})

    def test_failed_upload_leaves_no_partial_file_and_concurrent_uploads_respect_quota(self):
        self.authenticate()
        folder = server.ROOT / 'data/uploads'
        folder.mkdir(parents=True, exist_ok=True)
        initial_count = len(list(folder.iterdir()))
        payload = {'data': base64.b64encode(png_bytes()).decode()}
        with patch.object(server.os, 'replace', side_effect=OSError()):
            self.expect_error(503, '/api/upload', payload)
        self.assertEqual(len(list(folder.iterdir())), initial_count)
        def upload():
            try:
                with self.request('/api/upload', payload) as response:
                    return response.status
            except HTTPError as error:
                code = error.code
                error.close()
                return code
        with patch.object(server, 'MAX_UPLOAD_FILES', initial_count + 1):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: upload(), range(2)))
        self.assertEqual(sorted(results), [200, 413])

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_values(self):
        for value in ('{"groups":[],"groups":[]}', '{"value":NaN}', '{"value":Infinity}'):
            with self.assertRaises(ValueError):
                parse_json(value)
        self.assertFalse(server.valid_csrf_token('invalid.1.é'))

    def test_orphan_cleanup_backs_up_and_preserves_referenced_and_recent_images(self):
        folder = server.ROOT / 'data/uploads'
        folder.mkdir(parents=True, exist_ok=True)
        used, unused, recent = [folder / name for name in ('used.png', 'unused.png', 'recent.png')]
        for path in (used, unused, recent):
            path.write_bytes(png_bytes())
        old = time.time() - 90000
        for path in (used, unused):
            os.utime(path, (old, old))
        content = copy.deepcopy(CONTENT)
        content['groups'][0]['photo_url'] = '/uploads/used.png'
        with server.db() as connection:
            connection.execute("UPDATE config SET value=? WHERE key='content'", (json.dumps(content),))
        with redirect_stdout(io.StringIO()):
            manage_site.cleanup()
            self.assertTrue(unused.exists())
            manage_site.cleanup(apply=True)
        self.assertFalse(unused.exists())
        self.assertTrue(used.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(any((server.ROOT / '.backups').glob('site-*/uploads/unused.png')))

    def test_security_headers_head_and_video_range(self):
        (server.ROOT / 'dist/video.mp4').write_bytes(b'0123456789')
        for path in ('/', '/api/content', '/video.mp4'):
            with self.request(path) as response:
                self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
                self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
                self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
                self.assertNotIn('Python', response.headers['Server'])
                self.assertIsNone(response.headers.get('Strict-Transport-Security'))
        with self.request('/video.mp4', headers={'Range': 'bytes=2-4'}, method='HEAD') as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers['Content-Length'], '3')
            self.assertEqual(response.read(), b'')
        for value in ('bytes=9-2', 'bytes=-0', 'bytes=100-', 'bytes=0-1,3-4', 'bytes=' + '9' * 10000 + '-'):
            self.expect_error(416, '/video.mp4', headers={'Range': value})

    def test_host_path_directories_private_files_and_methods(self):
        self.expect_error(403, '/', headers={'Host': 'attacker.example'})
        (server.ROOT / 'dist/listing').mkdir(exist_ok=True)
        (server.ROOT / 'dist/.env').write_text('private')
        (server.ROOT / 'dist/private.sqlite3').write_text('private')
        for path in ('/listing/', '/.env', '/private.sqlite3', '/../data/content.sqlite3', '/%2e%2e/data/content.sqlite3', '/%5c..%5cdata/content.sqlite3'):
            self.expect_error(404, path)
            self.expect_error(404, path, method='HEAD')
        self.expect_error(405, '/', method='TRACE')
        self.expect_error(405, '/', {}, method='PUT')

    def test_framing_and_json_types_are_rejected(self):
        self.authenticate()
        self.expect_error(400, '/api/content', [])
        self.expect_error(415, '/api/content', {}, {'Content-Type': 'text/plain'})
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        cookie = '; '.join(f'{cookie.name}={cookie.value}' for cookie in self.jar)
        connection.putrequest('POST', '/api/content')
        connection.putheader('Content-Length', '2')
        connection.putheader('Content-Length', '2')
        connection.putheader('Content-Type', 'application/json')
        connection.putheader('X-CSRF-Token', self.csrf)
        connection.putheader('Cookie', cookie)
        connection.endheaders(b'{}')
        response = connection.getresponse()
        self.assertEqual(response.status, 400)
        response.read()
        connection.close()

    def test_production_requires_https_and_secure_cookie(self):
        with patch.dict(os.environ, {'APP_ENV': 'production', 'PUBLIC_ORIGIN': ''}):
            with self.assertRaises(RuntimeError):
                server.configured_origin()
        with patch.dict(os.environ, {'APP_ENV': 'production', 'PUBLIC_ORIGIN': 'https://site.example'}):
            with self.request('/api/session', headers={'Host': 'site.example'}) as response:
                self.assertIn('; Secure', response.headers['Set-Cookie'])
                self.assertIn('max-age=', response.headers['Strict-Transport-Security'])

    def test_marketplace_domains_and_explicit_validation(self):
        for url in ('https://s.shopee.com.br/code?affiliate=original', 'https://meli.la/code', 'https://www.mercadolivre.com.br/product'):
            self.assertEqual(affiliate_url(url), url)
        for url in ('https://s.shopee.com.br.attacker.example/code', 'https://attacker.example', 'https://user:password@meli.la/x', 'https://meli.la:8443/x', 'https://meli.la\\@attacker.example/x'):
            self.assertFalse(affiliate_url(url))
        invalid = copy.deepcopy(CONTENT)
        invalid['reviews'] = [{'name': 'Teste', 'comment': 'Teste', 'rating': True}]
        with self.assertRaises(ValueError):
            clean_content(invalid)


if __name__ == '__main__':
    unittest.main()
