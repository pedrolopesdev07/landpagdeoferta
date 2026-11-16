"""Send a signed public catalog snapshot. Credentials stay in local data/."""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from affiliate_feed import AffiliateFeed, NoRedirect

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'data/cloudflare-sync.json'
STATE = ROOT / 'data/cloudflare-sync-state.json'
STATUS = ROOT / 'data/cloudflare-sync-status.json'
LOCK = ROOT / 'data/cloudflare-sync.lock'


def save_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, path)


def synchronize():
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    if not config['url'].startswith('https://'):
        raise ValueError('HTTPS obrigatório.')
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {'sequence': 0}
    pending = state.get('pending')
    if pending is None:
        current = AffiliateFeed().read(catalog=True)
        if current['status'] != 'connected':
            return {'ok': False, 'reason': 'upstream_unavailable'}
        pending = {
            'operation': str(uuid.uuid4()),
            'payload': {'version': 1, 'sequence': state['sequence'] + 1, 'offers': current['offers'][:100]},
        }
        state['pending'] = pending
        save_json(STATE, state)
    raw = json.dumps(pending['payload'], ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(raw) > 524288:
        raise ValueError('Snapshot acima do limite.')
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    digest = hashlib.sha256(raw).hexdigest()
    canonical = '\n'.join(('v1', 'POST', '/api/sync/catalog', config['key_id'], stamp, nonce, pending['operation'], digest))
    signature = hmac.new(bytes.fromhex(config['secret']), canonical.encode(), hashlib.sha256).hexdigest()
    request = Request(config['url'].rstrip('/') + '/api/sync/catalog', raw, {
        'Content-Type': 'application/json',
        'User-Agent': 'LopesPromocaoSync/1.0',
        'X-Sync-Key-Id': config['key_id'],
        'X-Sync-Timestamp': stamp,
        'X-Sync-Nonce': nonce,
        'X-Sync-Operation': pending['operation'],
        'X-Sync-Signature': signature,
    })
    try:
        with build_opener(NoRedirect).open(request, timeout=20) as response:
            result = json.load(response)
    except HTTPError as error:
        try:
            failure = json.load(error) if error.code == 409 else {}
        finally:
            error.close()
        sequence = failure.get('sequence')
        if failure.get('code') == 'sequence_outdated' and type(sequence) is int and sequence >= state['sequence']:
            save_json(STATE, {'sequence': sequence})
            return {'ok': False, 'reason': 'sequence_rescheduled'}
        raise
    if result.get('ok') is not True or result.get('sequence') != pending['payload']['sequence']:
        raise ValueError('Confirmação de sincronização inválida.')
    state = {'sequence': pending['payload']['sequence']}
    save_json(STATE, state)
    return {'ok': True, 'sequence': state['sequence'], 'offers': len(pending['payload']['offers']), 'updated_at': time.time()}


def run_once():
    lock = LOCK.open('a+b')
    lock.seek(0, os.SEEK_END)
    if lock.tell() == 0:
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return
    try:
        try:
            result = synchronize()
        except Exception as error:
            result = {'ok': False, 'reason': type(error).__name__, 'checked_at': time.time()}
        previous = json.loads(STATUS.read_text(encoding='utf-8')) if STATUS.exists() else {}
        if result['ok']:
            previous = result
        else:
            previous['last_error'] = result
        save_json(STATUS, previous)
        print('Catálogo sincronizado.' if result['ok'] else 'Sincronização pendente. A última versão pública foi preservada.', flush=True)
    finally:
        lock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--loop', action='store_true')
    args = parser.parse_args()
    if not CONFIG.exists():
        raise SystemExit('Configure primeiro data/cloudflare-sync.json. Não coloque a credencial no Git.')
    while True:
        run_once()
        if not args.loop:
            break
        time.sleep(60)
