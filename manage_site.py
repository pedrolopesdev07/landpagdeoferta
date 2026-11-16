"""Offline administration. Run with the landing server stopped."""

import argparse
import getpass
import json
import shutil
import sqlite3
import sys
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path

import server
from security import clean_content, upload_path


def backup():
    folder = server.ROOT / '.backups' / datetime.now().strftime('site-%Y%m%d-%H%M%S-%f')
    folder.resolve().relative_to(server.ROOT.resolve())
    folder.mkdir(parents=True)
    database = server.ROOT / 'data/content.sqlite3'
    if database.exists():
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(folder / 'content.sqlite3')) as target:
            source.backup(target)
    uploads = server.ROOT / 'data/uploads'
    if uploads.exists():
        uploads.resolve().relative_to(server.ROOT.resolve())
        if uploads.is_symlink() or uploads.is_junction() or any(path.is_symlink() or path.is_junction() for path in uploads.rglob('*')):
            raise ValueError('A pasta de imagens deve conter apenas arquivos locais.')
        shutil.copytree(uploads, folder / 'uploads')
    print('Backup criado em', folder.relative_to(server.ROOT))
    return folder


def change_password():
    if not sys.stdin.isatty():
        raise ValueError('Use um terminal interativo para digitar a senha sem exibição.')
    password = getpass.getpass('Nova senha administrativa (mínimo 12 caracteres): ')
    confirm = getpass.getpass('Confirme a senha: ')
    if password != confirm or not 12 <= len(password) <= 1024:
        raise ValueError('As senhas devem coincidir e ter de 12 a 1024 caracteres.')
    backup()
    (server.ROOT / 'data').mkdir(exist_ok=True)
    with server.db() as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)')
        connection.execute('INSERT OR REPLACE INTO config VALUES (?, ?)', ('password', server.password_hash(password)))
    server.initialize()
    print('Senha salva. Inicie ou reinicie a landing para invalidar as sessões anteriores.')


def cleanup(apply=False):
    if apply:
        backup()
    with server.db() as connection:
        connection.execute('BEGIN IMMEDIATE')
        content = clean_content(json.loads(connection.execute("SELECT value FROM config WHERE key='content'").fetchone()[0]), strict=False)
        references = {offer.get('image') for offer in content['offers']}
        references.update(group.get('photo_url') for group in content['groups'])
        folder = server.ROOT / 'data/uploads'
        folder.resolve().relative_to(server.ROOT.resolve())
        if folder.is_symlink() or folder.is_junction():
            raise ValueError('A pasta de imagens deve ser local.')
        candidates = [path for path in folder.glob('*') if path.is_file() and not path.is_symlink() and upload_path('/uploads/' + path.name) and '/uploads/' + path.name not in references and path.stat().st_mtime < time.time() - 86400]
        for path in candidates:
            path.resolve().relative_to(folder.resolve())
            path.resolve().relative_to(server.ROOT.resolve())
            if apply:
                path.unlink()
        print('Imagens órfãs com mais de 24 horas:', len(candidates))
        print('Limpeza aplicada com backup.' if apply else 'Prévia. Use cleanup-uploads --apply, com o servidor parado, para remover.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'password', 'cleanup-uploads'])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'backup':
            backup()
        elif args.command == 'password':
            change_password()
        else:
            cleanup(args.apply)
    except (ValueError, sqlite3.Error):
        raise SystemExit('Operação interrompida. Verifique os dados e mantenha o servidor parado.')
