import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectFile } from './check-publication.mjs';
const bytes = value => Buffer.from(value);
test('blocks private paths and preserves intentional source files', () => {
  for (const path of ['data/content.sqlite3', '.aws/credentials', '.codex/state.json', 'integration.json', 'nested/.env.production', 'export.zip', 'secrets.json', '.dev.vars']) assert.ok(inspectFile(path, bytes('{}')), path);
  for (const path of ['src/data/offers.json', 'cloudflare/schema.sql', 'integration.example.json', '.gitignore', 'package-lock.json']) assert.equal(inspectFile(path, bytes('{}')), '', path);
});
test('blocks actual credential shapes without blocking symbolic environment variable names', () => {
  for (const value of ['ghp_' + 'x'.repeat(36), ['-----BEGIN ', 'PRIVATE KEY-----'].join(''), 'AKIA' + 'X'.repeat(16)]) assert.ok(inspectFile('src/config.js', bytes(value)));
  assert.equal(inspectFile('cloudflare/worker.js', bytes('env.ADMIN_PASSWORD_HASH; env.SYNC_KEY;')), '');
});
test('public assets reject source, databases, archives and maps but keep browser resources', () => {
  for (const path of ['server.py', 'schema.sql', '.env.example', 'bundle.js.map', 'backup.db', 'export.zip']) assert.ok(inspectFile(path, bytes(''), true), path);
  for (const path of ['ui/app.js', 'ui/style.css', 'ui/font.woff2', 'ui/video.mp4', '_headers', '.assetsignore']) assert.equal(inspectFile(path, bytes(''), true), '', path);
});
