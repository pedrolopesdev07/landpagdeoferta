import { normalizeText, validGroup, offerGroup } from './lib.js';

export const QUESTIONS = {
  transport: { title: 'Você tem algum transporte?', note: 'Vamos começar pelo seu dia a dia.', options: ['Sim', 'Não'] },
  vehicle: { title: 'Carro ou moto?', note: 'Isso ajuda a encontrar os achados certos.', options: ['Carro', 'Moto'] },
  parts: { title: 'Quais produtos você já comprou para sua moto?', note: 'Pode marcar mais de uma opção.', multi: true, options: ['Seta', 'Escapamento', 'Farol', 'Adesivo', 'Capacete', 'Ainda nenhum'] },
  vonixx: { title: 'Você gosta dos produtos Vonixx?', note: 'Cuidado e brilho também entram na seleção.', options: ['Sim, gosto muito', 'Quero conhecer', 'Não é minha prioridade'] },
  model: { title: 'Qual é a sua moto?', note: 'Última pergunta! Seu grupo está quase pronto.', options: ['Mottu', '160', '150', 'Fazer', 'Outra moto'] },
  gender: { title: 'Você é homem ou mulher?', note: 'Vamos personalizar os destaques para você.', options: ['Homem', 'Mulher', 'Prefiro não informar'] },
  gaming: { title: 'Você gosta de jogar?', options: ['Sim, adoro', 'De vez em quando', 'Não muito'] },
  gym: { title: 'Você faz academia?', options: ['Sim', 'Quero começar', 'Não'] },
  pc: { title: 'Você tem PC?', options: ['Sim', 'Quero montar um', 'Não'] },
  clothes: { title: 'Você gosta de comprar roupa?', options: ['Sim, sempre olho as novidades', 'Quando encontro uma boa oferta', 'Não é minha prioridade'] },
  money: { title: 'Você gosta de fazer dinheiro?', options: ['Sim! E economizar também', 'Quero aproveitar melhor meu dinheiro'] },
  perfume: { title: 'Você gosta de perfume?', options: ['Sim, amo', 'Quero descobrir novos', 'Não é minha prioridade'] },
  outings: { title: 'Você gosta de sair?', options: ['Sim, adoro um passeio', 'Prefiro curtir em casa', 'Um pouco dos dois'] },
  color: { title: 'Qual é a sua cor favorita?', options: ['Preto', 'Rosa', 'Azul', 'Vermelho', 'Outra cor'] },
};
export function questionPath(answers) {
  const path = ['transport'];
  if (!answers.transport) return path;
  if (answers.transport === 'Sim') {
    path.push('vehicle');
    if (!answers.vehicle) return path;
    if (answers.vehicle === 'Moto') return [...path, 'parts', 'vonixx', 'model'];
  }
  path.push('gender');
  if (!answers.gender) return path;
  if (answers.gender === 'Mulher') return [...path, 'perfume', 'clothes', 'gym', 'outings', 'color'];
  return [...path, 'gaming', 'gym', 'pc', 'clothes', 'money'];
}
export const recommendedKind = answers => answers.transport === 'Sim' && answers.vehicle === 'Moto' ? 'moto' : 'general';
export function findJourneyGroup(groups, kind) {
  const matches = groups.filter(group => {
    const name = normalizeText(group.name || '').replace(/[^a-z0-9]/g, '');
    return validGroup(group.url) && (kind === 'moto' ? name.includes('motoboypromo') : name.includes('clicaaqui'));
  });
  return matches.length === 1 ? matches[0] : null;
}
export function groupOffers(offers, groups, group) {
  if (!group || !validGroup(group.url)) return [];
  return offers.filter(offer => offerGroup(offer, groups)?.url === group.url).map(offer => ({ ...offer, group_name: group.name, group_url: group.url }));
}
export function personalizedOffers(offers, answers = {}) {
  let terms;
  if (recommendedKind(answers) === 'moto') {
    terms = [...(answers.parts || []).filter(value => value !== 'Ainda nenhum'), answers.model === 'Outra moto' ? '' : answers.model, /Sim/.test(answers.vonixx || '') ? 'vonixx' : ''].filter(Boolean);
  } else if (answers.gender === 'Mulher') {
    terms = ['perfume', 'feminin', 'vestido', 'blusa', 'saia', 'macacao', 'legging', 'top fitness'];
    if (answers.gym === 'Sim') terms.push('academia', 'fitness');
  } else if (answers.gender === 'Homem') {
    terms = ['masculin', 'cueca', 'relogio'];
    if (answers.pc !== 'Não') terms.push('computador', 'processador', 'placa', 'ssd', 'memoria', 'teclado', 'mouse');
    if (answers.gaming !== 'Não muito') terms.push('gamer', 'controle', 'headset');
    if (answers.gym === 'Sim') terms.push('academia', 'treino');
  } else terms = [];
  const score = offer => terms.reduce((total, term) => total + (normalizeText(`${offer.name} ${offer.category || ''}`).includes(normalizeText(term)) ? 1 : 0), 0);
  return offers.map((offer, index) => ({ offer, index, score: score(offer) })).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.offer);
}
