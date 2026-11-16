"""Private bootstrap for the owner's Cloudflare account. Never commit data/."""

import argparse
import base64
import hashlib
import http.cookiejar
import io
import json
import secrets
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from affiliate_feed import NoRedirect
from security import clean_content, upload_path

PRIVATE = ROOT / 'data/cloudflare'
SECRETS = PRIVATE / 'secrets.json'


def wrangler(arguments, stdin=None):
    result = subprocess.run(['node', str(ROOT / 'node_modules/wrangler/bin/wrangler.js'), *arguments], input=stdin, capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=ROOT)
    if result.returncode:
        raise RuntimeError('Falha no comando Cloudflare ' + ' '.join(arguments[:2]))
    return result.stdout


def prepare():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    material = json.loads(SECRETS.read_text(encoding='utf-8')) if SECRETS.exists() else {
        'CSRF_SECRET': secrets.token_hex(32), 'SYNC_KEY': secrets.token_hex(32),
    }
    connection = sqlite3.connect('file:' + (ROOT / 'data/content.sqlite3').as_posix() + '?mode=ro', uri=True)
    try:
        material['ADMIN_PASSWORD_HASH'] = connection.execute("SELECT value FROM config WHERE key='password'").fetchone()[0]
        content = clean_content(json.loads(connection.execute("SELECT value FROM config WHERE key='content'").fetchone()[0]), strict=False)
    finally:
        connection.close()
    if content['settings']['name'] in ('conecta.', 'conecta', 'Conecta', 'Pedrão Ofertas'):
        content['settings'] = {'name': 'lopesdapromoção', 'headline': 'O próximo achado está logo abaixo.', 'description': 'Arraste a tela e veja as ofertas que estão rolando no grupo agora. Gostou de alguma? O link está a um toque.'}
    SECRETS.write_text(json.dumps(material), encoding='utf-8')
    (PRIVATE / 'initial-content.json').write_text(json.dumps(content, ensure_ascii=False), encoding='utf-8')
    print('Material privado de implantação preparado em data/cloudflare, fora do Git.')


def rows(command):
    result = json.loads(wrangler(['d1', 'execute', 'landpagdeoferta', '--remote', '--command', command, '--json']))
    return result[0]['results']


def seed(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Informe a origem HTTPS confirmada do Worker.')
    url = url.rstrip('/')
    material = json.loads(SECRETS.read_text(encoding='utf-8'))
    existing = rows("SELECT key FROM landing_config WHERE key='content'")
    uploaded = 0
    if not existing:
        content = json.loads((PRIVATE / 'initial-content.json').read_text(encoding='utf-8'))
        token = secrets.token_hex(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        statement = f"INSERT INTO landing_sessions (token_hash, expires_at) VALUES ('{token_hash}', {int(time.time()) + 600});"
        migration = PRIVATE / 'bootstrap-session.sql'
        migration.write_text(statement, encoding='utf-8')
        wrangler(['d1', 'execute', 'landpagdeoferta', '--remote', '--file', str(migration)])
        client = build_opener(NoRedirect, HTTPCookieProcessor(http.cookiejar.CookieJar()))
        try:
            with client.open(url + '/api/session', timeout=30) as response:
                csrf = json.load(response)['csrf_token']
            request_headers = {'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Cookie': 'session=' + token + '; csrf=' + csrf}
            def post(path, value):
                request = Request(url + path, json.dumps(value, ensure_ascii=False).encode(), request_headers)
                with client.open(request, timeout=30) as response:
                    return json.load(response)
            references = {offer.get('image') for offer in content['offers']}
            references.update(group.get('photo_url') for group in content['groups'])
            mapping_file = PRIVATE / 'image-migration.json'
            mapping = json.loads(mapping_file.read_text(encoding='utf-8')) if mapping_file.exists() else {}
            for reference in sorted(value for value in references if upload_path(value)):
                if reference in mapping:
                    continue
                image_path = ROOT / 'data/uploads' / Path(reference).name
                image_path.resolve().relative_to((ROOT / 'data/uploads').resolve())
                with Image.open(image_path, formats=['PNG', 'JPEG', 'WEBP']) as image:
                    image.load()
                    image = ImageOps.exif_transpose(image).convert('RGBA')
                    image.thumbnail((512, 512))
                    clean = Image.new('RGBA', image.size)
                    clean.paste(image)
                    output = io.BytesIO()
                    clean.save(output, format='PNG')
                result = post('/api/upload', {'data': base64.b64encode(output.getvalue()).decode()})
                mapping[reference] = result['url']
                mapping_file.write_text(json.dumps(mapping), encoding='utf-8')
                uploaded += 1
            for offer in content['offers']:
                if offer.get('image') in mapping:
                    offer['image'] = mapping[offer['image']]
            for group in content['groups']:
                if group.get('photo_url') in mapping:
                    group['photo_url'] = mapping[group['photo_url']]
            post('/api/content', content)
        finally:
            migration.write_text(f"DELETE FROM landing_sessions WHERE token_hash='{token_hash}';", encoding='utf-8')
            wrangler(['d1', 'execute', 'landpagdeoferta', '--remote', '--file', str(migration)])
            migration.unlink(missing_ok=True)
    config = {'url': url, 'key_id': 'local-primary', 'secret': material['SYNC_KEY']}
    (ROOT / 'data/cloudflare-sync.json').write_text(json.dumps(config), encoding='utf-8')
    state = ROOT / 'data/cloudflare-sync-state.json'
    if not state.exists():
        sequence = rows('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM landing_catalog')[0]['sequence']
        state.write_text(json.dumps({'sequence': sequence}), encoding='utf-8')
    print('Conteúdo remoto preservado.' if existing else 'Conteúdo e imagens migrados para o banco da Cloudflare.')
    print('Imagens enviadas nesta execução:', uploaded)
    print('Sincronização local configurada, sem publicar suas credenciais no Git.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'secrets', 'seed'])
    parser.add_argument('--url')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            prepare()
        elif args.command == 'secrets':
            wrangler(['secret', 'bulk'], stdin=SECRETS.read_text(encoding='utf-8'))
            print('Segredos gravados na Cloudflare. Valores omitidos.')
        else:
            seed(args.url or '')
    except Exception as error:
        print('Etapa interrompida:', type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
