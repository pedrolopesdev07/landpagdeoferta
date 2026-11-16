import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';

it('bootstraps CSRF and sends it through login, save and logout without interpreting group text as HTML', async () => {
  const html = readFileSync(resolve('public/admin.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8765/admin', runScripts: 'outside-only' });
  const content = {
    settings: { name: 'Teste', headline: 'Teste', description: 'Teste' },
    groups: [{ name: '<svg onload=alert(1)>', category: 'Ofertas', description: '', icon: '', color: 'sage', url: 'https://chat.whatsapp.com/test' }],
    offers: [],
    reviews: [],
  };
  const csrf = 'disposable-csrf-fixture';
  let authenticated = false;
  dom.window.fetch = vi.fn(async (url, options = {}) => {
    if (url === '/api/session') return { ok: true, json: async () => ({ authenticated, csrf_token: csrf }) };
    if (url === '/api/offers') return { ok: true, json: async () => ({ enabled: false, offers: [] }) };
    if (options.method === 'POST') {
      expect(options.headers['X-CSRF-Token']).toBe(csrf);
      if (url === '/api/login') authenticated = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => structuredClone(content) };
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    for (const name of ['offers.js', 'admin-extras.js', 'admin-groups.js', 'admin.js']) {
      vm.runInContext(readFileSync(resolve('public', name), 'utf8'), dom.getInternalVMContext());
    }
    await settle();
    dom.window.document.querySelector('#password').value = 'disposable-password-fixture';
    dom.window.document.querySelector('#login').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    expect(dom.window.document.querySelector('#dashboard').hidden).toBe(false);
    expect(dom.window.document.querySelector('#editors svg')).toBeNull();
    expect(dom.window.document.querySelector('#editors input').value).toBe(content.groups[0].name);
    dom.window.document.querySelector('#save').click();
    await settle();
    expect(dom.window.fetch.mock.calls.some(([url, options]) => url === '/api/content' && options?.method === 'POST')).toBe(true);
    expect(dom.window.document.querySelector('#status').textContent).toContain('salvas');
    // Verify the logout API call while keeping jsdom on the current document.
    await vm.runInContext("api('logout', {})", dom.getInternalVMContext());
    expect(dom.window.fetch.mock.calls.some(([url, options]) => url === '/api/logout' && options?.method === 'POST')).toBe(true);
  } finally {
    dom.window.close();
  }
});
