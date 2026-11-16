import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App, Storefront, VslIntro, GroupCard, OfferCarousel, OfferDialog, FloatingPromotions } from './main.jsx';
import { BRAND, DEFAULT_SETTINGS, safeLink, affiliateLink, validGroup, visibleOffers, offerGroup } from './lib.js';
import HERO from './data/hero.json';

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IntersectionObserver', class { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]); } disconnect() {} });
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 400 },
    offsetHeight: { configurable: true, get: () => 300 },
    offsetTop: { configurable: true, get: () => 0 },
    offsetLeft: { configurable: true, get() { return this.classList.contains('carousel-slide') ? Array.from(this.parentNode.children).indexOf(this) * 400 : 0; } },
  });
  const originalStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = originalStyle(element);
    const getPropertyValue = style.getPropertyValue.bind(style);
    style.getPropertyValue = property => property.startsWith('margin-') ? '0px' : getPropertyValue(property);
    return style;
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('React landing page', () => {
  it('shows a real group photo and occupancy only when both counts are provided', () => {
    const group = { name: 'Grupo de ofertas', category: 'Ofertas', url: 'https://chat.whatsapp.com/invite', photo_url: '/uploads/group-photo.jpg', member_count: 95, capacity: 100 };
    const view = render(<GroupCard group={group} />);
    expect(screen.getByRole('img', { name: 'Foto do grupo Grupo de ofertas' }).getAttribute('src')).toBe(group.photo_url);
    expect(screen.getByText('95% ocupado')).toBeTruthy();
    expect(screen.getByText('5% de vagas livres')).toBeTruthy();
    expect(screen.getByText('Poucas vagas')).toBeTruthy();
    view.rerender(<GroupCard group={{ ...group, member_count: null }} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Poucas vagas')).toBeNull();
  });
  it('still rotates automatically with reduced motion using an instant transition', async () => {
    window.matchMedia.mockImplementation(() => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const view = render(<OfferCarousel offers={HERO} hero onOffer={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(6200); });
    const dots = Array.from(view.container.querySelectorAll('.slide-indicators>span'));
    expect(dots.findIndex(dot => dot.classList.contains('active'))).toBe(1);
  });
  it('automatically advances the main carousel without a click', async () => {
    render(<OfferCarousel offers={HERO} onOffer={() => {}} />);
    expect(screen.getByText('01')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('02')).toBeTruthy();
  });
  it('shows real pinned floating prices and opens the selected promotion', () => {
    const click = vi.fn();
    const offers = [HERO[1], HERO[2], HERO[0]];
    render(<FloatingPromotions offers={offers} onOffer={click} />);
    const first = screen.getByRole('button', { name: /Explorar destaque:.*28,90/ });
    fireEvent.click(first);
    expect(click).toHaveBeenCalledWith(offers[0]);
    expect(screen.getByText('R$ 49,83')).toBeTruthy();
    expect(screen.getByText('R$ 99,99')).toBeTruthy();
    expect(screen.getByText('−67%')).toBeTruthy();
    expect(screen.getByText('na oferta do grupo')).toBeTruthy();
  });
  it('preserves Portuguese accents and caps the feed at 30 unique unexpired offers', () => {
    expect(BRAND).toBe('lopesdapromoção');
    expect(DEFAULT_SETTINGS.headline).toContain('próximo');
    expect(DEFAULT_SETTINGS.description).toContain('estão');
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: String(i), name: `Oferta ${i}` }));
    expect(visibleOffers([...rows, ...rows])).toHaveLength(30);
    expect(visibleOffers([{ id: 'old', expires_at: '2000-01-01' }, ...rows])[0].id).toBe('0');
    expect(safeLink('javascript:alert(1)')).toBe('');
    expect(validGroup('https://example.com/fake')).toBe(false);
    expect(validGroup('https://chat.whatsapp.com/invite')).toBe(true);
  });

  it('starts the real carousel automatically, supports forward/back gestures and opens an offer by click', async () => {
    const onOffer = vi.fn();
    const view = render(<OfferCarousel offers={HERO} hero onOffer={onOffer} />);
    const dots = () => Array.from(view.container.querySelectorAll('.slide-indicators > span')).findIndex(dot => dot.classList.contains('active'));
    expect(dots()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(4700); });
    expect(dots()).toBe(1);
    const viewport = view.container.querySelector('.carousel-viewport');
    fireEvent.keyDown(viewport, { key: 'ArrowLeft' });
    expect(dots()).toBe(0);
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(dots()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: `Ver opções: ${HERO[1].name}` }));
    expect(onOffer).toHaveBeenCalledWith(HERO[1], expect.anything());
    expect(view.container.querySelectorAll('button')).toHaveLength(3); // Product cards only: no navigation buttons.
    expect(view.container.textContent).toContain('Preço normal');
    expect(view.container.textContent).toContain('Na promoção');
  });

  it('resumes automatic playback after a drag interaction', async () => {
    const view = render(<OfferCarousel offers={HERO} hero onOffer={() => {}} />);
    const viewport = view.container.querySelector('.carousel-viewport');
    fireEvent.mouseDown(viewport, { button: 0, buttons: 1, clientX: 300, clientY: 40 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 80, clientY: 40 });
    fireEvent.mouseUp(document, { button: 0, clientX: 80, clientY: 40 });
    await act(async () => { vi.advanceTimersByTime(6000); });
    const indicators = view.container.querySelectorAll('.slide-indicators > span');
    expect(Array.from(indicators).some(dot => dot.classList.contains('active'))).toBe(true);
    expect(view.container.querySelector('.carousel-container').style.transform).toContain('translate');
  });

  it('keeps autoplay active when a new offer replaces another without increasing the card count', async () => {
    const view = render(<OfferCarousel offers={HERO} hero onOffer={() => {}} />);
    const updated = [{ ...HERO[0], name: 'Nova oferta do grupo', id: 'new' }, ...HERO.slice(1)];
    view.rerender(<OfferCarousel offers={updated} hero onOffer={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(5500); });
    expect(view.container.querySelectorAll('.carousel-slide')).toHaveLength(3);
    expect(view.container.querySelector('.slide-indicators > span.active')).not.toBe(view.container.querySelector('.slide-indicators > span'));
  });

  it('preserves the affiliate link and presents the group option in the modal', () => {
    const view = render(<div style={{ transform: 'translateX(50px)' }}><OfferDialog offer={{ ...HERO[0], url: 'https://s.shopee.com.br/original-code', group_url: 'https://chat.whatsapp.com/linked-offer-group' }} onClose={() => {}} /></div>);
    const link = screen.getByRole('link', { name: /Ver oferta/ });
    expect(link.getAttribute('href')).toBe('https://s.shopee.com.br/original-code');
    expect(link.getAttribute('rel')).toContain('sponsored');
    expect(screen.getByRole('link', { name: /Entrar no grupo desta oferta/ }).getAttribute('href')).toBe('https://chat.whatsapp.com/linked-offer-group');
    expect(document.querySelector('dialog').hasAttribute('open')).toBe(true);
    expect(document.querySelector('dialog').parentElement).toBe(document.body);
    expect(view.container.querySelector('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('uses live group offers and original affiliate links in the storefront', async () => {
    const current = { id: 'live-offer', name: 'Oferta recente do grupo', price: '37,90', old: '70,00', url: 'https://s.shopee.com.br/live-offer', image: '/uploads/live-product.jpg', group_name: '🚨↪ CLICA AQUI' };
    const groups = [{ name: 'Outro grupo', url: 'https://chat.whatsapp.com/other-group' }, { name: 'CLICA AQUI', url: 'https://chat.whatsapp.com/correct-group' }];
    vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url === '/api/content' ? { settings: DEFAULT_SETTINGS, groups, reviews: [], offers: [] } : { enabled: true, status: 'connected', offers: [current] } })));
    const view = render(<Storefront onReplay={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const card = view.container.querySelector('.shop-product');
    expect(card.textContent).toContain(current.name);
    expect(card.querySelector('img').getAttribute('src')).toBe(current.image);
    expect(within(card).getByRole('link', { name: /Entrar no grupo/ }).getAttribute('href')).toBe(groups[1].url);
    fireEvent.click(screen.getByRole('button', { name: /Ver detalhes: Oferta recente do grupo/ }));
    expect(within(document.querySelector('dialog')).getByRole('link', { name: /Ver oferta/ }).getAttribute('href')).toBe(current.url);
    expect(within(document.querySelector('dialog')).getByRole('link', { name: /Entrar no grupo desta oferta/ }).getAttribute('href')).toBe(groups[1].url);
    expect(screen.queryByText('Kit gamer completo')).toBeNull();
  });

  it('keeps unmatched and ambiguous group names from opening a different group', () => {
    const groups = [{ name: 'Grupo A', url: 'https://chat.whatsapp.com/a' }, { name: 'Grupo B', url: 'https://chat.whatsapp.com/b' }];
    expect(offerGroup({ group_name: 'Grupo C' }, groups)).toBeNull();
    expect(offerGroup({ group_name: 'Grupo A' }, [...groups, { ...groups[0], url: 'https://chat.whatsapp.com/duplicate' }])).toBeNull();
    expect(offerGroup({ group_name: 'Grupo A', group_url: 'javascript:alert(1)' }, groups)?.url).toBe(groups[0].url);
  });

  it('renders injected offer text as text and rejects unapproved affiliate hosts', () => {
    const payload = '<img src=x onerror=alert(1)>';
    render(<OfferDialog offer={{ name: payload, price: '10,00', url: 'https://s.shopee.com.br.attacker.example/x' }} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: payload }).textContent).toBe(payload);
    expect(document.querySelector('dialog h2 img')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ver oferta na loja/ })).toBeNull();
    expect(affiliateLink('https://meli.la/original?tag=keep')).toBe('https://meli.la/original?tag=keep');
    expect(affiliateLink('https://meli.la:8443/x')).toBe('');
    expect(affiliateLink('https://s.shopee.com.br.attacker.example/x')).toBe('');
  });

  it('starts with the VSL, then shows one CTA after ended, and opens the catalog only on click', async () => {
    const request = vi.fn(async url => ({ ok: true, json: async () => url === '/api/content' ? { settings: DEFAULT_SETTINGS, groups: [], offers: [] } : { enabled: true, status: 'connected', offers: [] } }));
    vi.stubGlobal('fetch', request);
    const view = render(<App />);
    const video = view.container.querySelector('video');
    expect(video.getAttribute('src')).toContain('vsl-web.mp4');
    expect(video.controls).toBe(false);
    Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
    expect(screen.queryByRole('button', { name: 'CLICA AQUI' })).toBeNull();
    expect(view.container.querySelector('.shop-grid')).toBeNull();
    fireEvent.pause(view.container.querySelector('video'));
    expect(screen.queryByRole('button', { name: 'CLICA AQUI' })).toBeNull();
    video.currentTime = 3;
    fireEvent.seeking(video);
    expect(video.currentTime).toBe(0);
    fireEvent.ended(video);
    expect(screen.queryByRole('button', { name: 'CLICA AQUI' })).toBeNull();
    // Browsers may deliver sparse progress events while decoding or buffering.
    for (const time of [0.75, 3]) {
      video.currentTime = time;
      fireEvent.timeUpdate(video);
    }
    fireEvent.ended(video);
    const completion = document.querySelector('dialog.vsl-completion');
    expect(completion.hasAttribute('open')).toBe(true);
    expect(completion.querySelectorAll('button')).toHaveLength(1);
    expect(completion.textContent).toBe('CLICA AQUI');
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'CLICA AQUI' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.container.querySelector('video')).toBeNull();
    expect(document.querySelector('.vsl-completion')).toBeNull();
    expect(view.container.querySelector('.shop-grid')).toBeTruthy();
    expect(window.location.hash).toBe('#loja');
    expect(request.mock.calls.some(([url]) => url === '/api/catalog')).toBe(true);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('lets the visitor start with sound when the browser blocks autoplay', async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('Autoplay blocked'));
    render(<VslIntro onContinue={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    const start = screen.getByRole('button', { name: /Assistir com som/ });
    await act(async () => { fireEvent.click(start); await Promise.resolve(); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /Assistir com som/ })).toBeNull();
  });

  it('supports more than 30 offers, search, marketplace filtering and progressive loading in the catalog', async () => {
    const products = Array.from({ length: 45 }, (_, i) => ({ id: String(i), name: `Produto ${i}`, price: `${i + 1},00`, url: `https://example.com/${i}`, image: '/uploads/example.jpg', marketplace: i % 2 ? 'shopee' : 'mercado_livre' }));
    vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url === '/api/content' ? { settings: DEFAULT_SETTINGS, groups: [], offers: [] } : { enabled: true, status: 'connected', offers: products } })));
    const view = render(<Storefront onReplay={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.container.querySelectorAll('.shop-product')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: /Ver mais ofertas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ver mais ofertas/ }));
    expect(view.container.querySelectorAll('.shop-product')).toHaveLength(36);
    fireEvent.click(screen.getByRole('button', { name: 'Shopee' }));
    expect(view.container.querySelectorAll('.shop-product')).toHaveLength(12);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar ofertas' }), { target: { value: 'Produto 41' } });
    expect(view.container.querySelectorAll('.shop-product')).toHaveLength(1);
    expect(view.container.querySelector('.shop-product').textContent).toContain('Produto 41');
  });

  it('keeps pinned hero content independent of feed replacements and pauses while a modal is open', async () => {
    const snapshots = JSON.stringify(HERO);
    const view = render(<OfferCarousel offers={HERO} hero modalOpen onOffer={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(9000); });
    expect(view.container.querySelector('.slide-indicators > span.active')).toBe(view.container.querySelector('.slide-indicators > span'));
    view.rerender(<OfferCarousel offers={HERO} hero modalOpen={false} onOffer={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(view.container.querySelector('.slide-indicators > span.active')).not.toBe(view.container.querySelector('.slide-indicators > span'));
    expect(JSON.stringify(HERO)).toBe(snapshots);
  });
});
