import { describe, it, expect } from 'vitest';
import { productAudience, audienceOffers, personalizedPreview } from './quiz.js';
describe('quiz audience filtering', () => {
 const items = [
  { name: 'Camisa masculina' }, { name: 'Perfume feminino' },
  { name: 'Tenis unissex' }, { name: 'Mouse rosa' }, { name: 'Vestido azul' },
 ];
 it('classifies explicit audience and garments without using color', () => {
  expect(items.map(productAudience)).toEqual(['masculino', 'feminino', 'unissex', 'nao_identificado', 'feminino']);
  expect(productAudience({ name: 'Camisa', category: 'Moda feminina' })).toBe('feminino');
 });
 it('keeps only the selected audience and unisex products', () => {
  expect(audienceOffers(items, { gender: 'Homem' })).toEqual([items[0], items[2]]);
  expect(audienceOffers(items, { gender: 'Mulher' })).toEqual([items[1], items[2], items[4]]);
  expect(audienceOffers(items, { gender: 'Prefiro nao informar' })).toEqual(items);
 });
 it('never fills an empty preview with products of the opposite audience', () => {
  expect(personalizedPreview([items[1], items[4]], { gender: 'Homem' })).toEqual([]);
  expect(personalizedPreview([items[0]], { gender: 'Mulher' })).toEqual([]);
 });
});
