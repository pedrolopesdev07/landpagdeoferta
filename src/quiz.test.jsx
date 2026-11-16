import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Quiz } from './Quiz.jsx';
import { Recommendation, App } from './main.jsx';
import { questionPath, recommendedKind, findJourneyGroup, groupOffers, personalizedOffers, personalizedPreview } from './quiz.js';
const groups = [{ name: '🚨 CLICA AQUI AGORA(-90%)', url: 'https://chat.whatsapp.com/general' }, { name: 'MOTOBOYPROMO', url: 'https://chat.whatsapp.com/moto' }];
const offers = [
 { id: 'm', name: 'Capacete para moto', group_name: 'MOTOBOY PROMO', url: 'https://s.shopee.com.br/moto', price: '90,00' },
 { id: 'w', name: 'Perfume feminino', group_name: 'CLICA AQUI AGORA(-90%)', url: 'https://s.shopee.com.br/perfume', price: '50,00' },
 { id: 'p', name: 'Placa de vídeo para computador', group_name: 'CLICA AQUI AGORA(-90%)', url: 'https://s.shopee.com.br/pc', price: '500,00' },
 { id: 'r', name: 'Relógio masculino', group_name: 'CLICA AQUI AGORA(-90%)', url: 'https://s.shopee.com.br/watch', price: '40,00' },
];
beforeEach(() => {
 window.history.replaceState(null, '', '/');
 vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
 vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url === '/api/content' ? { groups, settings: {}, offers: [] } : { enabled: true, status: 'connected', offers, updated_at: new Date().toISOString() } })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const answer = name => fireEvent.click(screen.getByRole('button', { name }));
describe('personalized group journey', () => {
 it('completes the application journey from quiz through recommendation to the chosen catalog', async () => {
  window.history.replaceState(null, '', '/#quiz'); render(<App />);
  answer(/Sim/); answer(/Moto/); answer(/Farol/); answer(/Continuar/); answer(/Quero conhecer/); answer(/160/);
  await act(async () => {});
  expect(window.location.hash).toBe('#recomendacao?grupo=moto');
  expect(screen.getByText('Capacete para moto')).toBeTruthy();
  answer(/Escolher este grupo/); await act(async () => {});
  expect(window.location.hash).toBe('#loja?grupo=moto');
  expect(document.querySelectorAll('.shop-product')).toHaveLength(1);
  expect(document.querySelector('.shop-product').textContent).toContain('Capacete');
  expect(document.querySelector('.mobile-group-cta a').getAttribute('href')).toBe(groups[1].url);
 });
 it('plays a selection tone and respects the sound toggle', () => {
  const start = vi.fn();
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class AudioMock { currentTime = 0; destination = {}; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } createOscillator() { return { type: '', frequency: param(), connect() {}, start, stop() {} }; } createGain() { return { gain: param(), connect() {} }; } }
  vi.stubGlobal('AudioContext', AudioMock);
  render(<Quiz onComplete={() => {}} />); answer(/Sim/); expect(start).toHaveBeenCalledTimes(1);
  answer(/Som ligado/); answer(/Moto/); expect(start).toHaveBeenCalledTimes(1);
 });
 it('preserves Portuguese accents in the video headline', () => {
  render(<App />);
  expect(screen.getByRole('heading').textContent).toContain('ESSE VÍDEO SÓ VAI APARECER');
  expect(screen.getByRole('heading').textContent).toContain('PREÇOS');
  expect(document.querySelector('video').autoplay).toBe(false);
 });
 it('takes a motorcycle owner through exactly the motorcycle questions', () => {
  const done = vi.fn(); render(<Quiz onComplete={done} />);
  answer(/Sim/); answer(/Moto/); answer(/Capacete/); answer(/Escapamento/); answer(/Continuar/); answer(/Sim, gosto muito/); answer(/Fazer/);
  expect(done).toHaveBeenCalledWith({ transport: 'Sim', vehicle: 'Moto', parts: ['Capacete', 'Escapamento'], vonixx: 'Sim, gosto muito', model: 'Fazer' });
  expect(recommendedKind(done.mock.calls[0][0])).toBe('moto');
 });
 it.each(['Homem', 'Mulher', 'Prefiro não informar'])('completes the non-motorcycle path for %s', gender => {
  const done = vi.fn(); render(<Quiz onComplete={done} />); answer(/Não/); answer(new RegExp(gender));
  for (let i = 0; i < 5; i++) fireEvent.click(document.querySelector('.quiz-options button'));
  expect(done).toHaveBeenCalledTimes(1); expect(recommendedKind(done.mock.calls[0][0])).toBe('general');
  expect(done.mock.calls[0][0].gender).toBe(gender);
 });
 it('sends car owners through general questions and clears dependent answers after going back', () => {
  render(<Quiz onComplete={() => {}} />); answer(/Sim/); answer(/Moto/); answer(/Voltar/); answer(/Carro/);
  expect(screen.getByRole('heading', { name: 'Você é homem ou mulher?' })).toBeTruthy();
  expect(screen.queryByText('Quais produtos você já comprou para sua moto?')).toBeNull();
  expect(questionPath({ transport: 'Sim', vehicle: 'Carro', gender: 'Homem' })).toHaveLength(8);
 });
 it('makes none-of-the-above exclusive for multiple choices', () => {
  const done = vi.fn(); render(<Quiz onComplete={done} />); answer(/Sim/); answer(/Moto/); answer(/Capacete/); answer(/Ainda nenhum/);
  expect(screen.getByRole('button', { name: /Capacete/ }).getAttribute('aria-pressed')).toBe('false');
  answer(/Continuar/); answer(/Quero conhecer/); answer(/Outra moto/); expect(done.mock.calls[0][0].parts).toEqual(['Ainda nenhum']);
 });
 it('only resolves unique valid configured groups and only their own offers', () => {
  expect(findJourneyGroup(groups, 'moto')).toBe(groups[1]);
  expect(findJourneyGroup([...groups, { ...groups[1] }], 'moto')).toBeNull();
  expect(findJourneyGroup([{ name: 'MOTOBOYPROMO', url: 'javascript:alert(1)' }], 'moto')).toBeNull();
  expect(groupOffers(offers, groups, groups[1]).map(item => item.id)).toEqual(['m']);
  expect(groupOffers(offers, groups, null)).toEqual([]);
 });
 it('keeps perfume, clothing and computer/watch examples visible when their group actually has them', () => {
  const fitness = Array.from({ length: 10 }, (_, id) => ({ id, name: 'Macacão feminino fitness academia' }));
  expect(personalizedPreview([...fitness, offers[1]], { gender: 'Mulher', gym: 'Sim' })).toContain(offers[1]);
  const male = { name: 'Camisa masculina' };
  expect(personalizedPreview([...fitness, male, offers[2], offers[3]], { gender: 'Homem', pc: 'Sim' })).toEqual(expect.arrayContaining([male, offers[2], offers[3]]));
 });
 it('ranks existing products for the profile without inventing or adding offers', () => {
  expect(personalizedOffers(offers, { gender: 'Mulher' })[0].id).toBe('w');
  expect(personalizedOffers(offers, { gender: 'Homem', pc: 'Sim' })[0].id).toBe('p');
  expect(personalizedOffers(offers, { transport: 'Sim', vehicle: 'Moto', parts: ['Capacete'] })[0].id).toBe('m');
  expect(personalizedOffers([], { gender: 'Mulher' })).toEqual([]);
 });
 it('shows real motorcycle preview and lets the visitor explicitly choose the other group', async () => {
  const choose = vi.fn(); render(<Recommendation answers={{ transport: 'Sim', vehicle: 'Moto' }} onChoose={choose} onRestart={() => {}} />);
  await act(async () => {});
  expect(screen.getByText('Capacete para moto')).toBeTruthy(); expect(screen.queryByText('Perfume feminino')).toBeNull();
  expect(screen.getByRole('link', { name: /Já quero entrar/ }).getAttribute('href')).toBe(groups[1].url);
  answer(/Escolher este grupo/); expect(choose).toHaveBeenLastCalledWith('moto');
  answer(/Outra opção para explorar/); expect(choose).toHaveBeenLastCalledWith('general');
 });
 it('preserves chosen motorcycle group on refresh and never mixes general products into its catalog', async () => {
  window.history.replaceState(null, '', '/#loja?grupo=moto'); render(<App />); await act(async () => {});
  expect(document.querySelector('.shop-product').textContent).toContain('Capacete para moto');
  expect(screen.queryByText('Perfume feminino')).toBeNull();
  expect(document.querySelector('.mobile-group-cta a').getAttribute('href')).toBe(groups[1].url);
  expect(screen.getByRole('link', { name: /Explorar ofertas/ }).getAttribute('href')).toBe('#ofertas?grupo=moto');
 });
 it('does not use the other group when the recommended group is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url === '/api/content' ? { groups: [groups[0]], settings: {}, offers: [] } : { enabled: true, status: 'connected', offers } })));
  render(<Recommendation answers={{ transport: 'Sim', vehicle: 'Moto' }} onChoose={() => {}} onRestart={() => {}} />); await act(async () => {});
  expect(screen.queryByRole('link', { name: /Já quero entrar/ })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('indisponível');
  expect(document.querySelectorAll('.result-products button')).toHaveLength(0);
 });
});
