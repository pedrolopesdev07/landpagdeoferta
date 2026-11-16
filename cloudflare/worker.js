import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { decode, encode, hasPngSignature } from 'fast-png';
import { InputError, cleanContent, cleanSnapshot, isUpload, parseObject } from './validation.js';

const SESSION_SECONDS = 28800;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' https:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

class HttpError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}

function headers() {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), picture-in-picture=()',
    'Strict-Transport-Security': 'max-age=31536000',
  });
}

function json(value, status = 200, cookies = []) {
  const responseHeaders = headers();
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  for (const cookie of cookies) responseHeaders.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const signature = (secret, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest('hex');

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

function cookieValue(request, name) {
  const part = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : '';
}

function cookie(request, name, value, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function validCsrf(env, token, now) {
  if (!/^[a-f0-9]{48}\.[0-9]{10,12}\.[a-f0-9]{64}$/.test(token)) return false;
  const [nonce, stamp, supplied] = token.split('.');
  const age = now - Number(stamp);
  return age >= 0 && age <= SESSION_SECONDS && equal(supplied, signature(env.CSRF_SECRET, nonce + '.' + stamp));
}

async function authenticated(request, env, now) {
  const token = cookieValue(request, 'session');
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const row = await env.DB.prepare('SELECT expires_at FROM landing_sessions WHERE token_hash = ?').bind(sha256(token)).first();
  return !!row && row.expires_at > now;
}

async function rate(env, key, limit, seconds, now) {
  const result = await env.DB.prepare(`
    INSERT INTO landing_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    WHERE landing_rate_limits.expires_at <= ? OR landing_rate_limits.count < ?
    RETURNING count
  `).bind(key, now + seconds, now, now, now, limit).first();
  if (!result || result.count > limit) throw new HttpError(429, 'Muitas tentativas. Aguarde para tentar novamente.');
}

async function body(request, limit) {
  const advertised = request.headers.get('Content-Length');
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > limit)) throw new HttpError(413, 'Conteúdo acima do limite.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Corpo obrigatório.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'Conteúdo acima do limite.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function content(env) {
  const row = await env.DB.prepare("SELECT value FROM landing_config WHERE key = 'content'").first();
  if (!row) throw new HttpError(503, 'Conteúdo ainda não configurado.');
  return cleanContent(JSON.parse(row.value));
}

async function login(request, env, value, now, ip) {
  if (Object.keys(value).length !== 1 || typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 1024) throw new InputError('Senha inválida.');
  await rate(env, 'login:' + ip, 10, 300, now);
  await rate(env, 'login:global', 30, 300, now);
  if (!env.ADMIN_PASSWORD_HASH) throw new HttpError(503, 'Painel ainda não configurado.');
  const [salt, expected] = env.ADMIN_PASSWORD_HASH.split(':');
  const actual = await new Promise((resolve, reject) => {
    scrypt(value.password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, result) => error ? reject(error) : resolve(result.toString('hex')));
  });
  if (!equal(actual, expected)) throw new HttpError(401, 'Senha incorreta.');
  const token = randomBytes(32).toString('hex');
  const previous = cookieValue(request, 'session');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM landing_sessions WHERE expires_at <= ? OR token_hash = ?').bind(now, sha256(previous)),
    env.DB.prepare('INSERT INTO landing_sessions (token_hash, expires_at) VALUES (?, ?)').bind(sha256(token), now + SESSION_SECONDS),
  ]);
  return json({ ok: true }, 200, [cookie(request, 'session', token)]);
}

async function upload(env, value, now) {
  if (Object.keys(value).length !== 1 || typeof value.data !== 'string' || value.data.length > 1500000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new InputError('Imagem inválida.');
  let encoded;
  try {
    const input = Buffer.from(value.data, 'base64');
    if (input.length < 24 || input.length > 1100000 || input.readUInt32BE(16) > 512 || input.readUInt32BE(20) > 512) throw new InputError('Imagem acima de 512 pixels.');
    if (!hasPngSignature(input)) throw new InputError('PNG obrigatório.');
    const compressed = [];
    let offset = 8;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset);
      if (offset + size + 12 > input.length) throw new InputError('PNG truncado.');
      const type = input.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') compressed.push(input.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
      if (type === 'IEND') break;
    }
    // Bound the decompressed stream before the decoder allocates its pixel buffers.
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 1100000 });
    const decoded = decode(input, { checkCrc: true });
    if (!decoded.width || !decoded.height || decoded.width > 512 || decoded.height > 512) throw new InputError('Dimensões inválidas.');
    if (decoded.depth !== 8) throw new InputError('Use uma imagem preparada pelo painel.');
    encoded = encode({ width: decoded.width, height: decoded.height, data: decoded.data, depth: 8, channels: decoded.channels });
    if (encoded.length > 1100000) throw new InputError('Imagem acima do limite.');
  } catch { throw new InputError('Envie uma imagem válida pelo painel.'); }
  const filename = randomBytes(16).toString('hex') + '.png';
  const result = await env.DB.prepare(`
    INSERT INTO landing_uploads (filename, body, content_type, bytes, created_at)
    SELECT ?, ?, 'image/png', ?, ?
    WHERE (SELECT COUNT(*) FROM landing_uploads) < 500
      AND (SELECT COALESCE(SUM(bytes), 0) FROM landing_uploads) + ? <= 100000000
    RETURNING filename
  `).bind(filename, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength), encoded.length, now, encoded.length).first();
  if (!result) throw new HttpError(413, 'Limite de armazenamento das imagens atingido.');
  return json({ url: '/uploads/' + filename });
}

async function sync(request, env, now, ip) {
  const keyId = request.headers.get('X-Sync-Key-Id') || '';
  const stamp = request.headers.get('X-Sync-Timestamp') || '';
  const nonce = request.headers.get('X-Sync-Nonce') || '';
  const operation = request.headers.get('X-Sync-Operation') || '';
  const supplied = request.headers.get('X-Sync-Signature') || '';
  if (!env.SYNC_KEY || keyId !== env.SYNC_KEY_ID || !/^\d{10,12}$/.test(stamp) || Math.abs(now - Number(stamp)) > 300 || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9-]{36}$/.test(operation) || !/^[a-f0-9]{64}$/.test(supplied)) throw new HttpError(401, 'Sincronização não autorizada.');
  const bytes = await body(request, 524288);
  const digest = sha256(bytes);
  const canonical = ['v1', 'POST', '/api/sync/catalog', keyId, stamp, nonce, operation, digest].join('\n');
  if (!equal(supplied, signature(env.SYNC_KEY, canonical))) throw new HttpError(401, 'Sincronização não autorizada.');
  // Unauthenticated requests must not consume the D1 write quota.
  await rate(env, 'sync-ip:' + ip, 10, 60, now);
  const snapshot = cleanSnapshot(parseObject(bytes), now * 1000);
  const seen = await env.DB.prepare('SELECT key FROM landing_sync_nonces WHERE key = ?').bind(keyId + ':' + nonce).first();
  if (seen) throw new HttpError(409, 'Nonce já utilizado.');
  const previous = await env.DB.prepare('SELECT digest, sequence FROM landing_sync_receipts WHERE operation_id = ?').bind(operation).first()
    || await env.DB.prepare('SELECT digest, sequence FROM landing_catalog WHERE operation_id = ?').bind(operation).first();
  if (previous) {
    if (previous.digest !== digest || previous.sequence !== snapshot.sequence) throw new HttpError(409, 'Operação conflitante.');
    const claimed = await env.DB.prepare('INSERT INTO landing_sync_nonces (key, expires_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING RETURNING key').bind(keyId + ':' + nonce, now + 900).first();
    if (!claimed) throw new HttpError(409, 'Nonce já utilizado.');
    return json({ ok: true, sequence: previous.sequence, idempotent: true });
  }
  // The insert, conditional update and receipt are committed together by D1.
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare('INSERT INTO landing_sync_nonces (key, expires_at) VALUES (?, ?)').bind(keyId + ':' + nonce, now + 900),
      env.DB.prepare(`
        INSERT INTO landing_catalog (singleton, sequence, operation_id, digest, offers, updated_at)
        SELECT 1, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM landing_sync_receipts WHERE operation_id = ?)
        ON CONFLICT(singleton) DO UPDATE SET sequence=excluded.sequence, operation_id=excluded.operation_id,
          digest=excluded.digest, offers=excluded.offers, updated_at=excluded.updated_at
        WHERE excluded.sequence > landing_catalog.sequence
          AND NOT EXISTS (SELECT 1 FROM landing_sync_receipts WHERE operation_id = excluded.operation_id)
        RETURNING sequence
      `).bind(snapshot.sequence, operation, digest, JSON.stringify(snapshot.offers), now, operation),
      env.DB.prepare(`
        INSERT INTO landing_sync_receipts (operation_id, digest, sequence, created_at)
        SELECT ?, ?, ?, ? WHERE EXISTS
          (SELECT 1 FROM landing_catalog WHERE singleton=1 AND sequence=? AND operation_id=?)
        ON CONFLICT(operation_id) DO NOTHING
      `).bind(operation, digest, snapshot.sequence, now, snapshot.sequence, operation),
    ]);
  } catch {
    throw new HttpError(409, 'Sincronização concorrente. Reenvie a operação com novo nonce.');
  }
  if (!results[1].results.length) {
    const receipt = await env.DB.prepare('SELECT digest, sequence FROM landing_sync_receipts WHERE operation_id = ?').bind(operation).first();
    if (receipt?.digest === digest && receipt.sequence === snapshot.sequence) return json({ ok: true, sequence: snapshot.sequence, idempotent: true });
    const latest = await env.DB.prepare('SELECT sequence FROM landing_catalog WHERE singleton=1').first();
    throw new HttpError(409, 'Snapshot fora de ordem.', { code: 'sequence_outdated', sequence: latest?.sequence || 0 });
  }
  return json({ ok: true, sequence: snapshot.sequence, updated_at: new Date(now * 1000).toISOString() });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);
  if (!path.startsWith('/api/') && !path.startsWith('/uploads/')) return env.ASSETS.fetch(request);
  if (!env.DB || !env.CSRF_SECRET) throw new HttpError(503, 'Serviço ainda não configurado.');
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw new HttpError(405, 'Método não permitido.');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (request.method === 'POST' && path === '/api/sync/catalog') return sync(request, env, now, ip);
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (path === '/api/content') return json(await content(env));
    if (path === '/api/offers' || path === '/api/catalog') {
      const row = await env.DB.prepare('SELECT offers, updated_at FROM landing_catalog WHERE singleton=1').first();
      const offers = row ? JSON.parse(row.offers).filter(offer => Date.parse(offer.expires_at) > now * 1000) : [];
      const status = row ? (now - row.updated_at < 180 ? 'connected' : 'cached') : 'disabled';
      return json({ enabled: !!row, status, offers: path === '/api/offers' ? offers.slice(0, 30) : offers, updated_at: row ? new Date(row.updated_at * 1000).toISOString() : null });
    }
    if (path === '/api/session') {
      let csrf = cookieValue(request, 'csrf');
      if (!validCsrf(env, csrf, now)) {
        const payload = randomBytes(24).toString('hex') + '.' + now;
        csrf = payload + '.' + signature(env.CSRF_SECRET, payload);
      }
      return json({ authenticated: await authenticated(request, env, now), csrf_token: csrf, upload_format: 'png', upload_max_side: 512 }, 200, [cookie(request, 'csrf', csrf)]);
    }
    if (isUpload(path)) {
      const row = await env.DB.prepare('SELECT body, content_type, bytes FROM landing_uploads WHERE filename = ?').bind(path.slice('/uploads/'.length)).first();
      if (!row) throw new HttpError(404, 'Imagem indisponível.');
      const responseHeaders = headers();
      responseHeaders.set('Content-Type', row.content_type);
      responseHeaders.set('Content-Length', String(row.bytes));
      responseHeaders.set('Cache-Control', 'public, max-age=86400');
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(row.body), { headers: responseHeaders });
    }
    throw new HttpError(404, 'Recurso indisponível.');
  }
  if (!['/api/login', '/api/logout', '/api/content', '/api/upload'].includes(path)) throw new HttpError(404, 'Recurso indisponível.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== (env.PUBLIC_ORIGIN || url.origin)) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'Origem inválida.');
  if (path !== '/api/login' && !await authenticated(request, env, now)) throw new HttpError(401, 'Entre novamente no painel.');
  const csrf = request.headers.get('X-CSRF-Token') || '';
  if (!validCsrf(env, csrf, now) || !equal(csrf, cookieValue(request, 'csrf'))) throw new HttpError(403, 'Atualize o painel para renovar a autorização.');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Use JSON.');
  await rate(env, 'admin:' + ip, 60, 60, now);
  const value = parseObject(await body(request, path === '/api/upload' ? 1500100 : 500000));
  if (path === '/api/login') return login(request, env, value, now, ip);
  if (path === '/api/logout') {
    await env.DB.prepare('DELETE FROM landing_sessions WHERE token_hash = ?').bind(sha256(cookieValue(request, 'session'))).run();
    return json({ ok: true }, 200, [cookie(request, 'session', '', 0), cookie(request, 'csrf', '', 0)]);
  }
  if (path === '/api/upload') {
    await rate(env, 'uploads:' + ip, 10, 60, now);
    return upload(env, value, now);
  }
  const sanitized = cleanContent(value);
  await env.DB.prepare("INSERT INTO landing_config (key, value) VALUES ('content', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(sanitized)).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env);
      if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
      return response;
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, 400);
      if (error instanceof HttpError) return json({ error: error.message, ...error.details }, error.status);
      console.error('landing_request_failed', error.name);
      return json({ error: 'Serviço temporariamente indisponível.' }, 503);
    }
  },
  async scheduled(controller, env) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM landing_sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM landing_rate_limits WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM landing_sync_nonces WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM landing_sync_receipts WHERE created_at <= ?').bind(now - 172800),
    ]);
  },
};
