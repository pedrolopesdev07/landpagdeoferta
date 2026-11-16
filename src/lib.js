import affiliateDomains from '../marketplace_domains.json';

export const BRAND = 'lopesdapromoção';
export const DEFAULT_SETTINGS = {
  name: BRAND,
  headline: 'O próximo achado está logo abaixo.',
  description: 'Arraste a tela e veja as ofertas que estão rolando no grupo agora. Gostou de alguma? O link está a um toque.',
};
export function safeLink(value) {
  try {
    if (typeof value !== 'string' || value.length > 4000 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : '';
  } catch { return ''; }
}
export function affiliateLink(value) {
  const link = safeLink(value);
  if (!link) return '';
  const host = new URL(link).hostname;
  return affiliateDomains.some(domain => host === domain || host.endsWith('.' + domain)) ? link : '';
}
export function validGroup(value) {
  const link = safeLink(value);
  return !!link && new URL(link).hostname === 'chat.whatsapp.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(new URL(link).pathname);
}
export function visibleOffers(offers, now = Date.now(), limit = 30) {
  const seen = new Set();
  const valid = (offers || []).filter(offer => {
    const key = offer.id || offer.url || offer.name;
    if (seen.has(key) || (offer.expires_at && new Date(offer.expires_at).getTime() <= now)) return false;
    seen.add(key);
    return true;
  });
  return limit === null ? valid : valid.slice(0, limit);
}
export const normalizeText = value => String(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function offerGroup(offer, groups = []) {
  if (validGroup(offer.group_url)) return { name: offer.group_name || 'Grupo de ofertas', url: offer.group_url };
  const nameKey = value => normalizeText(value || '').replace(/[^\p{L}\p{N}]/gu, '');
  const destination = nameKey(offer.group_name);
  const matches = groups.filter(group => validGroup(group.url) && (
    (offer.group_id && group.id === offer.group_id) || (destination && nameKey(group.name) === destination)
  ));
  return matches.length === 1 ? matches[0] : null;
}
export function groupOccupancy(group) {
  const { member_count: members, capacity } = group;
  if (!Number.isInteger(members) || !Number.isInteger(capacity) || members < 0 || capacity <= 0 || members > capacity) return null;
  const percent = Math.round(members / capacity * 100);
  return { members, capacity, percent, remaining: capacity - members, remainingPercent: 100 - percent };
}
