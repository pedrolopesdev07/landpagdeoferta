import { affiliateLink, safeLink, validGroup } from '../src/lib.js';

export class InputError extends Error {}

export function parseObject(bytes) {
  let raw;
  let value;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(raw);
  } catch { throw new InputError('JSON inválido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Objeto JSON obrigatório.');
  // JSON.parse validates grammar. This pass only detects duplicate object keys,
  // including keys represented by different Unicode escapes, and limits nesting.
  const stack = [];
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '{' || character === '[') {
      stack.push({ object: character === '{', keys: new Set(), expectingKey: true });
      if (stack.length > 32) throw new InputError('JSON acima do limite de profundidade.');
    } else if (character === '}' || character === ']') {
      stack.pop();
    } else if (character === ',') {
      if (stack.at(-1)?.object) stack.at(-1).expectingKey = true;
    } else if (character === '"') {
      const start = index;
      for (index++; index < raw.length; index++) {
        if (raw[index] === '\\') index++;
        else if (raw[index] === '"') break;
      }
      const frame = stack.at(-1);
      if (frame?.object && frame.expectingKey) {
        const key = JSON.parse(raw.slice(start, index + 1));
        if (frame.keys.has(key)) throw new InputError('Campo JSON repetido.');
        frame.keys.add(key);
        frame.expectingKey = false;
      }
    }
  }
  return value;
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new InputError('Campos inválidos ou desconhecidos.');
  }
  return { ...value };
}

function text(value, max = 1000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new InputError('Texto inválido.');
  return value;
}

function list(value, max) {
  if (!Array.isArray(value) || value.length > max) throw new InputError('Quantidade de itens inválida.');
  return value;
}

export const isUpload = value => typeof value === 'string' && /^\/uploads\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/i.test(value);

export function cleanContent(value) {
  const content = fields(value, ['settings', 'groups', 'offers', 'reviews']);
  const settings = fields(content.settings, ['name', 'headline', 'description']);
  for (const key of ['name', 'headline', 'description']) text(settings[key], 500, true);
  const groups = list(content.groups, 100).map(value => {
    const group = fields(value, ['id', 'name', 'description', 'category', 'icon', 'color', 'url', 'photo_url', 'member_count', 'capacity', 'featured']);
    for (const key of ['name', 'description', 'category', 'icon', 'color', 'url']) text(group[key], 1000, ['name', 'category'].includes(key));
    if (!['peach', 'lavender', 'sage', 'rose', 'yellow', 'blue'].includes(group.color)) throw new InputError('Cor inválida.');
    if (group.url && !validGroup(group.url)) throw new InputError('Convite do WhatsApp inválido.');
    if (group.photo_url && !isUpload(group.photo_url) && !safeLink(group.photo_url)) throw new InputError('Foto inválida.');
    if (group.photo_url !== undefined) text(group.photo_url, 2000);
    const { member_count: members, capacity } = group;
    if (members != null && (!Number.isInteger(members) || members < 0 || members > 1000000)) throw new InputError('Participantes inválidos.');
    if (capacity != null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000000)) throw new InputError('Capacidade inválida.');
    if (members != null && capacity != null && members > capacity) throw new InputError('Participantes acima da capacidade.');
    if (group.id !== undefined) text(group.id, 200, true);
    if (group.featured !== undefined && typeof group.featured !== 'boolean') throw new InputError('Destaque inválido.');
    return group;
  });
  const { offers: manualOffers = [], reviews: manualReviews = [] } = content;
  const offers = list(manualOffers, 50).map(value => {
    const offer = fields(value, ['id', 'name', 'old', 'price', 'discount', 'icon', 'image', 'url', 'category', 'marketplace', 'group_id', 'group_name', 'group_url', 'alt', 'expires_at', 'published_at', 'source']);
    text(offer.name, 1000, true);
    for (const item of Object.values(offer)) text(item);
    if (offer.url && !affiliateLink(offer.url)) throw new InputError('Use um link da Shopee ou Mercado Livre.');
    if (offer.image && !isUpload(offer.image)) throw new InputError('Use uma imagem enviada pelo painel.');
    if (offer.group_url && !validGroup(offer.group_url)) throw new InputError('Convite da oferta inválido.');
    return offer;
  });
  const reviews = list(manualReviews, 50).map(value => {
    const review = fields(value, ['name', 'comment', 'rating']);
    text(review.name, 1000, true);
    text(review.comment, 1000, true);
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) throw new InputError('Nota inválida.');
    return review;
  });
  return { settings, groups, offers, reviews };
}

export function cleanSnapshot(value, now) {
  const snapshot = fields(value, ['version', 'sequence', 'offers']);
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) throw new InputError('Versão inválida.');
  const seen = new Set();
  const offers = list(snapshot.offers, 100).map(value => {
    const offer = fields(value, ['id', 'name', 'price', 'old', 'discount', 'image', 'url', 'icon', 'category', 'marketplace', 'group_name', 'group_id', 'published_at', 'expires_at', 'source', 'audience']);
    for (const item of Object.values(offer)) text(item, 4000);
    if (offer.audience !== undefined && !['masculino', 'feminino', 'unissex', 'nao_identificado'].includes(offer.audience)) throw new InputError('Público inválido.');
    text(offer.id, 200, true);
    text(offer.name, 500, true);
    if (seen.has(offer.id) || !affiliateLink(offer.url)) throw new InputError('Oferta inválida ou duplicada.');
    seen.add(offer.id);
    if (offer.image && !safeLink(offer.image)) throw new InputError('Imagem inválida.');
    const published = Date.parse(offer.published_at);
    const expires = Date.parse(offer.expires_at);
    const maxAge = offer.marketplace === 'shopee' ? 7 * 86400000 : 86400000;
    if (!Number.isFinite(published) || !Number.isFinite(expires) || published > now + 300000 || expires <= published || expires > published + maxAge + 1000) throw new InputError('Validade inválida.');
    return offer;
  }).filter(offer => Date.parse(offer.expires_at) > now);
  return { sequence: snapshot.sequence, offers };
}
