import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { decode, encode } from 'fast-png';

const secrets = { CSRF_SECRET: 'a'.repeat(64), SYNC_KEY: 'b'.repeat(64), SYNC_KEY_ID: 'test-key' };
const password = 'disposable-worker-password';
const salt = 'test-salt';
secrets.ADMIN_PASSWORD_HASH = salt + ':' + scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const content = { settings: { name: 'Teste', headline: 'Teste', description: 'Teste' }, groups: [], offers: [], reviews: [] };
let runtime;
let database;

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'cloudflare-build/worker.js',
    compatibilityDate: '2026-11-16',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    bindings: secrets,
    serviceBindings: { ASSETS: () => new Response('asset') },
  }));
  database = await runtime.getD1Database('DB');
  for (const statement of readFileSync('cloudflare/schema.sql', 'utf8').split(';').filter(value => value.trim())) await database.prepare(statement).run();
});

beforeEach(async () => {
  for (const table of ['landing_sessions', 'landing_rate_limits', 'landing_uploads', 'landing_catalog', 'landing_sync_nonces', 'landing_sync_receipts']) await database.prepare('DELETE FROM ' + table).run();
  await database.prepare("INSERT OR REPLACE INTO landing_config (key,value) VALUES ('content',?)").bind(JSON.stringify(content)).run();
});

after(async () => { await runtime?.dispose(); });

const request = (path, options = {}) => runtime.dispatchFetch('https://site.test' + path, options);

async function admin() {
  const response = await request('/api/session');
  const session = await response.json();
  const csrfCookie = response.headers.get('Set-Cookie').split(';')[0];
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, Cookie: csrfCookie };
  const login = await request('/api/login', { method: 'POST', headers, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  headers.Cookie += '; ' + login.headers.get('Set-Cookie').split(';')[0];
  return headers;
}

function snapshot(sequence = 1, name = 'Produto') {
  const now = Date.now();
  return { version: 1, sequence, offers: [{ id: 'offer-a', name, price: '20,00', old: '40,00', discount: '50%', image: 'https://images.example/image.jpg', url: 'https://s.shopee.com.br/original-code', icon: '', category: 'Ofertas', marketplace: 'shopee', group_name: 'Grupo A', published_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 3600000).toISOString(), source: 'afiliado_bot' }] };
}

function signed(value, operation = randomUUID(), nonce = randomBytes(16).toString('hex')) {
  const raw = JSON.stringify(value);
  const stamp = String(Math.floor(Date.now() / 1000));
  const digest = createHash('sha256').update(raw).digest('hex');
  const canonical = ['v1', 'POST', '/api/sync/catalog', secrets.SYNC_KEY_ID, stamp, nonce, operation, digest].join('\n');
  return {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key-Id': secrets.SYNC_KEY_ID, 'X-Sync-Timestamp': stamp, 'X-Sync-Nonce': nonce, 'X-Sync-Operation': operation, 'X-Sync-Signature': createHmac('sha256', Buffer.from(secrets.SYNC_KEY, 'hex')).update(canonical).digest('hex') },
  };
}

test('public content stays separate from credentials and missing API paths are JSON errors', async () => {
  const response = await request('/api/content');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), content);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await request('/api/missing')).status, 404);
  assert.equal((await request('/api/content', { method: 'PUT' })).status, 405);
});

test('JSON duplicate keys, escaped duplicates and excessive nesting are rejected', async () => {
  const headers = await admin();
  for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}']) {
    const response = await request('/api/content', { method: 'POST', headers, body: raw });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /repetido/);
  }
  const nested = await request('/api/content', { method: 'POST', headers, body: '{"value":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}' });
  assert.equal(nested.status, 400);
  assert.match((await nested.json()).error, /profundidade/);
  const value = { ...content, settings: { ...content.settings, description: 'text, { "quoted" } \\' } };
  assert.equal((await request('/api/content', { method: 'POST', headers, body: JSON.stringify(value) })).status, 200);
});

test('native scrypt login preserves the hash format, session and logout', async () => {
  const headers = await admin();
  const session = await request('/api/session', { headers });
  assert.equal((await session.json()).authenticated, true);
  assert.match(session.headers.get('Set-Cookie'), /Secure/);
  assert.equal((await request('/api/content', { method: 'POST', headers, body: JSON.stringify(content) })).status, 200);
  assert.equal((await request('/api/logout', { method: 'POST', headers, body: '{}' })).status, 200);
  assert.equal((await request('/api/content', { method: 'POST', headers, body: JSON.stringify(content) })).status, 401);
});

test('CSRF, origins, unauthorized edits and unknown content fields are rejected', async () => {
  assert.equal((await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).status, 403);
  assert.equal((await request('/api/content', { method: 'POST', body: '{}' })).status, 401);
  const headers = await admin();
  assert.equal((await request('/api/content', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.test' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/content', { method: 'POST', headers, body: JSON.stringify({ ...content, private: 'not-allowed' }) })).status, 400);
});

test('uploaded PNG is decoded and reencoded, malformed files and quota overflow fail', async () => {
  const headers = await admin();
  const bytes = Buffer.from(encode({ width: 3, height: 3, data: new Uint8Array(36).fill(255) }));
  const response = await request('/api/upload', { method: 'POST', headers, body: JSON.stringify({ data: bytes.toString('base64') }) });
  assert.equal(response.status, 200);
  const path = (await response.json()).url;
  const stored = await request(path);
  assert.equal(stored.headers.get('Content-Type'), 'image/png');
  assert.equal(decode(new Uint8Array(await stored.arrayBuffer())).width, 3);
  assert.equal((await request('/api/upload', { method: 'POST', headers, body: JSON.stringify({ data: 'not-png' }) })).status, 400);
  await database.prepare('UPDATE landing_uploads SET bytes = 100000000').run();
  assert.equal((await request('/api/upload', { method: 'POST', headers, body: JSON.stringify({ data: bytes.toString('base64') }) })).status, 413);
});

test('sync verifies signatures, replay, idempotency and conflicting operation IDs', async () => {
  const value = snapshot();
  const operation = randomUUID();
  const options = signed(value, operation);
  const incorrect = { ...options, headers: { ...options.headers, 'X-Sync-Signature': '0'.repeat(64) } };
  assert.equal((await request('/api/sync/catalog', incorrect)).status, 401);
  assert.equal((await request('/api/sync/catalog', options)).status, 200);
  assert.equal((await request('/api/sync/catalog', options)).status, 409);
  assert.equal((await request('/api/sync/catalog', signed(value, operation))).status, 200);
  assert.equal((await request('/api/sync/catalog', signed(snapshot(2), operation))).status, 409);
  const catalog = await (await request('/api/catalog')).json();
  assert.equal(catalog.offers[0].url, value.offers[0].url);
});

test('concurrent conflicting operation IDs commit only one snapshot', async () => {
  const operation = randomUUID();
  const responses = await Promise.all([
    request('/api/sync/catalog', signed(snapshot(1, 'Primeiro'), operation)),
    request('/api/sync/catalog', signed(snapshot(2, 'Segundo'), operation)),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const receipt = await database.prepare('SELECT sequence FROM landing_sync_receipts WHERE operation_id = ?').bind(operation).first();
  const catalog = await database.prepare('SELECT sequence FROM landing_catalog WHERE singleton=1').first();
  assert.equal(receipt.sequence, catalog.sequence);
});

test('older snapshots cannot replace newer ones and sync keys cannot edit content', async () => {
  assert.equal((await request('/api/sync/catalog', signed(snapshot(2)))).status, 200);
  const response = await request('/api/sync/catalog', signed(snapshot(1)));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).sequence, 2);
  assert.equal((await request('/api/content', signed(snapshot(3)))).status, 401);
});

test('expired offers are removed and stale snapshots are marked cached', async () => {
  const value = snapshot();
  value.offers[0].published_at = new Date(Date.now() - 7200000).toISOString();
  value.offers[0].expires_at = new Date(Date.now() - 3600000).toISOString();
  assert.equal((await request('/api/sync/catalog', signed(value))).status, 200);
  await database.prepare('UPDATE landing_catalog SET updated_at = ?').bind(Math.floor(Date.now() / 1000) - 400).run();
  const catalog = await (await request('/api/catalog')).json();
  assert.equal(catalog.status, 'cached');
  assert.equal(catalog.offers.length, 0);
});
