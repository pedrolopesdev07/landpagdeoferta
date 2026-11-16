"""Local landing server. Internet-facing use requires an HTTPS reverse proxy."""

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import socket
import sqlite3
import threading
import tempfile
import time
from contextlib import contextmanager
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer as BaseHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from affiliate_feed import feed
from security import RateLimiter, clean_content, parse_json, sanitize_image, upload_path

ROOT = Path(__file__).resolve().parent
SESSION_SECONDS = 28800
MAX_UPLOAD_STORAGE = 100_000_000
MAX_UPLOAD_FILES = 500
sessions = {}
state_lock = threading.RLock()
upload_lock = threading.Lock()
login_slots = threading.BoundedSemaphore(2)
limiter = RateLimiter()
csrf_secret = secrets.token_bytes(32)
logger = logging.getLogger('landing.security')


@contextmanager
def db():
    connection = sqlite3.connect(ROOT / 'data/content.sqlite3', timeout=10)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def password_hash(password):
    salt = secrets.token_hex(16)
    hashed = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return salt + ':' + hashed


def initialize():
    (ROOT / 'data').mkdir(exist_ok=True)
    with db() as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)')
        if not connection.execute("SELECT 1 FROM config WHERE key='password'").fetchone():
            password = os.environ.get('ADMIN_PASSWORD', '')
            if len(password) < 12:
                raise RuntimeError('Configure a senha com python manage_site.py password ou ADMIN_PASSWORD (mínimo 12 caracteres).')
            connection.execute('INSERT INTO config VALUES (?, ?)', ('password', password_hash(password)))
        default = {'settings': {'name': 'lopesdapromoção', 'headline': 'O próximo achado está logo abaixo.', 'description': 'Confira as ofertas recentes dos nossos grupos.'}, 'groups': [], 'offers': [], 'reviews': []}
        connection.execute('INSERT OR IGNORE INTO config VALUES (?, ?)', ('content', json.dumps(default, ensure_ascii=False)))


def production():
    return os.environ.get('APP_ENV') == 'production'


def secure_cookies():
    return production() or os.environ.get('COOKIE_SECURE') == '1'


def configured_origin():
    value = os.environ.get('PUBLIC_ORIGIN', '').rstrip('/')
    parsed = urlsplit(value)
    if value and (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise RuntimeError('PUBLIC_ORIGIN deve conter apenas a origem do site.')
    if production() and (not value or parsed.scheme != 'https'):
        raise RuntimeError('Produção exige PUBLIC_ORIGIN com HTTPS e proxy preservando Host.')
    return value


def new_csrf_token():
    payload = secrets.token_urlsafe(24) + '.' + str(int(time.time()))
    return payload + '.' + hmac.new(csrf_secret, payload.encode(), hashlib.sha256).hexdigest()


def valid_csrf_token(token):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32}\.\d{1,12}\.[a-f0-9]{64}', token):
        return False
    try:
        nonce, stamp, signature = token.split('.')
        age = time.time() - int(stamp)
        expected = hmac.new(csrf_secret, (nonce + '.' + stamp).encode(), hashlib.sha256).hexdigest()
        return 0 <= age <= SESSION_SECONDS and hmac.compare_digest(signature, expected)
    except ValueError:
        return False


class ThreadingHTTPServer(BaseHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(24)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        request.settimeout(10)
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        logger.warning('request_failed')


class Handler(SimpleHTTPRequestHandler):
    server_version = 'Landing'
    sys_version = ''

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        policy = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' https:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if production():
            policy += '; upgrade-insecure-requests'
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
        self.send_header('Content-Security-Policy', policy)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), picture-in-picture=()')
        super().end_headers()

    def reply(self, code, data, cookies=()):
        raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        for cookie in cookies:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def send_error(self, code, message=None, explain=None):
        self.close_connection = True
        self.reply(code, {'error': 'Requisição indisponível.'})

    def cookie(self, name):
        try:
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            return cookie[name].value if name in cookie else ''
        except CookieError:
            return ''

    def set_cookie(self, name, value, max_age=SESSION_SECONDS):
        secure = '; Secure' if secure_cookies() else ''
        return f'{name}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}'

    def authenticated(self):
        now = time.time()
        with state_lock:
            expired = [token for token, expiry in sessions.items() if expiry <= now]
            for token in expired:
                del sessions[token]
            return sessions.get(self.cookie('session'), 0) > now

    def prepare_request(self):
        if not self.path.startswith('/'):
            self.send_error(400)
            return False
        hosts = self.headers.get_all('Host', [])
        if len(hosts) != 1:
            self.send_error(400)
            return False
        origin = configured_origin()
        allowed = {urlsplit(origin).netloc.lower()} if origin else set()
        if not production():
            for port in (self.server.server_port, 5173):
                allowed.update({f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'})
        if hosts[0].lower() not in allowed:
            self.send_error(403)
            return False
        if not limiter.allow(('requests', self.client_address[0]), 600, 60):
            self.reply(429, {'error': 'Muitas requisições. Aguarde um minuto.'})
            return False
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.prepare_request():
            return
        path = urlsplit(self.path).path
        if path in ('/api/catalog', '/api/offers'):
            return self.reply(200, feed.read(catalog=path == '/api/catalog'))
        if path == '/api/content':
            with db() as connection:
                value = json.loads(connection.execute("SELECT value FROM config WHERE key='content'").fetchone()[0])
            if value.get('settings', {}).get('name') in ('conecta.', 'conecta', 'Conecta', 'Pedrão Ofertas'):
                value['settings'] = {'name': 'lopesdapromoção', 'headline': 'O próximo achado está logo abaixo.', 'description': 'Arraste a tela e veja as ofertas que estão rolando no grupo agora. Gostou de alguma? O link está a um toque.'}
            try:
                return self.reply(200, clean_content(value, strict=False))
            except (ValueError, TypeError):
                logger.warning('content_validation_failed')
                return self.reply(503, {'error': 'Conteúdo temporariamente indisponível.'})
        if path == '/api/session':
            csrf = self.cookie('csrf')
            if not valid_csrf_token(csrf):
                csrf = new_csrf_token()
            return self.reply(200, {'authenticated': self.authenticated(), 'csrf_token': csrf}, [self.set_cookie('csrf', csrf)])
        if path.startswith('/api/'):
            return self.send_error(404)
        return self.serve_static(path)

    def static_path(self, url_path):
        decoded = unquote(url_path)
        parts = decoded.split('/')
        if '\\' in decoded or any(part in ('.', '..') or part.startswith('.') for part in parts if part):
            return None
        if any(ord(character) < 32 for character in decoded):
            return None
        if decoded in ('/', '/index.html'):
            decoded = '/index.html'
        elif decoded.rstrip('/') == '/admin':
            decoded = '/admin.html'
        if decoded.startswith('/uploads/'):
            if not upload_path(decoded):
                return None
            base = ROOT / 'data/uploads'
            relative = decoded[len('/uploads/'):]
        else:
            base = ROOT / 'dist'
            relative = decoded.lstrip('/')
        candidate = base / relative
        for current in (candidate, *candidate.parents):
            if current == ROOT:
                break
            if current.is_symlink() or current.is_junction():
                return None
        try:
            candidate.resolve().relative_to(base.resolve())
        except ValueError:
            return None
        if not candidate.is_file() or candidate.suffix.lower() not in {'.html', '.css', '.js', '.jpg', '.jpeg', '.png', '.webp', '.ico', '.woff2', '.mp4'}:
            return None
        return candidate

    def serve_static(self, url_path):
        path = self.static_path(url_path)
        if path is None:
            return self.send_error(404)
        try:
            with path.open('rb') as source:
                size = path.stat().st_size
                start, end = 0, size - 1
                requested = self.headers.get('Range') if path.suffix == '.mp4' else None
                if requested:
                    match = re.fullmatch(r'bytes=(\d{0,18})-(\d{0,18})', requested.strip())
                    if not match or not any(match.groups()):
                        return self.video_range_error(size)
                    first, last = match.groups()
                    if first:
                        start = int(first)
                        end = min(int(last), size - 1) if last else size - 1
                    else:
                        start = max(0, size - int(last))
                    if start > end or start >= size:
                        return self.video_range_error(size)
                self.send_response(206 if requested else 200)
                self.send_header('Content-Type', 'video/mp4' if path.suffix == '.mp4' else self.guess_type(str(path)))
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('Cache-Control', 'no-store' if path.suffix == '.html' or path.name.startswith('admin') else 'public, max-age=3600')
                if path.suffix == '.mp4':
                    self.send_header('Accept-Ranges', 'bytes')
                if requested:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()
                if self.command == 'HEAD':
                    return
                source.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = source.read(min(262144, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except FileNotFoundError:
            self.send_error(404)

    def video_range_error(self, size):
        self.send_response(416)
        self.send_header('Content-Range', f'bytes */{size}')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        if not self.prepare_request():
            return
        path = urlsplit(self.path).path
        if path not in ('/api/login', '/api/logout', '/api/content', '/api/upload'):
            return self.send_error(404)
        origin = self.headers.get('Origin')
        expected_origin = configured_origin() or 'http://' + self.headers['Host']
        if origin is not None and origin != expected_origin:
            logger.warning('origin_rejected')
            return self.send_error(403)
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.send_error(403)
        if path != '/api/login' and not self.authenticated():
            return self.reply(401, {'error': 'Entre novamente no painel.'})
        csrf = self.headers.get('X-CSRF-Token', '')
        if not valid_csrf_token(csrf) or not hmac.compare_digest(csrf, self.cookie('csrf')):
            logger.warning('csrf_rejected')
            return self.send_error(403)
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            return self.reply(415, {'error': 'Use JSON.'})
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get('Transfer-Encoding') or self.headers.get('Expect') or len(lengths) != 1:
            return self.send_error(400)
        limit = 7_000_000 if path == '/api/upload' else 500_000
        try:
            if not re.fullmatch(r'\d{1,9}', lengths[0]):
                raise ValueError()
            size = int(lengths[0])
            if not 0 < size <= limit:
                return self.send_error(413)
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError()
            data = parse_json(raw)
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeDecodeError, RecursionError, socket.timeout):
            return self.send_error(400)
        if path == '/api/login':
            return self.login(data)
        if path == '/api/logout':
            with state_lock:
                sessions.pop(self.cookie('session'), None)
            return self.reply(200, {'ok': True}, [self.set_cookie('session', '', 0), self.set_cookie('csrf', '', 0)])
        if path == '/api/upload':
            return self.upload(data)
        try:
            content = clean_content(data)
        except (ValueError, TypeError) as error:
            return self.reply(400, {'error': str(error)})
        with db() as connection:
            connection.execute("UPDATE config SET value=? WHERE key='content'", (json.dumps(content, ensure_ascii=False),))
        logger.info('content_updated')
        self.reply(200, {'ok': True})

    def login(self, data):
        password = data.get('password')
        if set(data) != {'password'} or not isinstance(password, str) or not 1 <= len(password) <= 1024:
            return self.send_error(400)
        if not limiter.allow(('login', self.client_address[0]), 10, 300) or not limiter.allow(('login_total',), 30, 300):
            logger.warning('login_limited')
            return self.reply(429, {'error': 'Aguarde cinco minutos para tentar novamente.'})
        if not login_slots.acquire(blocking=False):
            return self.reply(429, {'error': 'Aguarde para tentar novamente.'})
        try:
            with db() as connection:
                salt, expected = connection.execute("SELECT value FROM config WHERE key='password'").fetchone()[0].split(':')
            actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        finally:
            login_slots.release()
        if not hmac.compare_digest(actual, expected):
            logger.warning('login_failed')
            return self.reply(401, {'error': 'Senha incorreta.'})
        token = secrets.token_urlsafe(32)
        with state_lock:
            sessions.pop(self.cookie('session'), None)
            if len(sessions) >= 128:
                sessions.pop(next(iter(sessions)))
            sessions[token] = time.time() + SESSION_SECONDS
        logger.info('login_succeeded')
        return self.reply(200, {'ok': True}, [self.set_cookie('session', token)])

    def upload(self, data):
        if set(data) != {'data'}:
            return self.send_error(400)
        if not limiter.allow(('upload', self.client_address[0]), 10, 60):
            return self.reply(429, {'error': 'Aguarde um minuto para enviar mais imagens.'})
        with upload_lock:
            folder = ROOT / 'data/uploads'
            folder.mkdir(parents=True, exist_ok=True)
            files = list(folder.iterdir())
            if len(files) >= MAX_UPLOAD_FILES:
                return self.reply(413, {'error': 'Limite de imagens atingido. Faça a limpeza dos arquivos não utilizados.'})
            try:
                raw = sanitize_image(data['data'])
                occupied = sum(item.stat().st_size for item in files if item.is_file())
                if occupied + len(raw) > MAX_UPLOAD_STORAGE:
                    return self.reply(413, {'error': 'Limite de armazenamento das imagens atingido.'})
                filename = secrets.token_hex(16) + '.webp'
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(dir=folder, prefix='.upload-', suffix='.tmp', delete=False) as output:
                        temporary = Path(output.name)
                        output.write(raw)
                    os.replace(temporary, folder / filename)
                finally:
                    if temporary is not None and temporary.exists():
                        temporary.unlink()
            except (ValueError, TypeError):
                return self.reply(400, {'error': 'Envie uma imagem PNG, JPG ou WebP válida, até 5 MB, 6000 pixels por lado e 12 megapixels.'})
            except OSError:
                logger.warning('upload_storage_failed')
                return self.reply(503, {'error': 'Armazenamento indisponível. Tente novamente.'})
        logger.info('image_uploaded')
        return self.reply(200, {'url': '/uploads/' + filename})

    def method_not_allowed(self):
        self.send_response(405)
        self.send_header('Allow', 'GET, HEAD, POST')
        self.send_header('Content-Length', '0')
        self.end_headers()

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_TRACE = do_CONNECT = method_not_allowed


if __name__ == '__main__':
    configured_origin()
    initialize()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')
    port = int(os.environ.get('PORT', '8000'))
    print(f'Página local na porta {port}. Painel em /admin.', flush=True)
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), port), Handler).serve_forever()
