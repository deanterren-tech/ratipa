import assert from 'node:assert/strict';
import { findSamePair, groupByPair, lookupDistance, pairKey } from '../src/utils/distancePairs';

const list = [
  { id: 'a', from: 'Минск', to: 'Брест', fromCityId: 'minsk', toCityId: 'brest', distance: 350 },
  { id: 'b', from: 'брест ', to: 'МИНСК', distance: 369 },
  { id: 'c', from: 'Минск', to: 'Москва', distance: 710 },
  { id: 'd', from: 'Ёлки', to: 'Минск', distance: 10 },
];
// направление и регистр не важны
assert.equal(pairKey({ from: 'Минск', to: 'Брест' }), pairKey({ from: 'брест', to: 'минск' }));
assert.equal(lookupDistance(list, 'Брест', 'Минск')?.id, 'a');
assert.equal(lookupDistance(list, 'елки', 'минск')?.id, 'd');
assert.equal(lookupDistance(list, 'Минск', ''), null);
assert.equal(lookupDistance(list, 'Минск', 'Рига'), null);
// новая запись той же пары находит существующую (запись с городами и запись только с названиями)
assert.equal(findSamePair(list, { id: 'new', from: 'Брест', to: 'Минск', distance: 360 })?.id, 'a');
assert.equal(findSamePair(list, { id: 'a', from: 'Минск', to: 'Брест' })?.id, 'b');
assert.equal(findSamePair(list, { id: 'new', from: 'Минск', to: 'Рига' }), null);
// группировка для плана объединения
const groups = groupByPair(list);
assert.equal(groups.length, 3);
const mb = groups.find((g) => g.records.some((r) => r.id === 'a'))!;
assert.deepEqual(mb.records.map((r) => r.id), ['a', 'b']);
assert.equal(mb.conflict, true);
assert.equal(groups.find((g) => g.records[0].id === 'c')!.conflict, false);
console.log('distance-pairs: ok');
