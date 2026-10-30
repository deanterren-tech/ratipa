import assert from 'node:assert/strict';
import { membershipUpdates, plateKey, rateGroupsWithVehicles } from '../src/utils/rateGroupsSingle';

const tractors = [
  { id: 'AC02467', carNumber: 'AC 0246-7', rateGroupId: 'c2' },
  { id: 'AE60527', carNumber: 'АЕ 6052-7', rateGroupId: '' },
  { id: 'X1', carNumber: 'X 1', rateGroupId: 'g3' },
];
const couplings = [{ id: 'AC02467', carNumber: 'AC 0246-7 / A 1635 E-7', rateGroupId: 'c2' }];
assert.equal(plateKey('АЕ 6052-7 / А 2453 Е-7'), 'AE60527');

const groups = rateGroupsWithVehicles(
  [{ id: 'c2', name: 'Группа 0.125', rate: 0.125 }, { id: 'g3', name: 'G3', rate: '0.145', perDiemRate: 35 }, { name: 'без id' }],
  tractors,
  couplings,
);
assert.equal(groups.length, 2);
// тягач и его сцепка — одна машина
assert.deepEqual(groups[0], { id: 'c2', name: 'Группа 0.125', rate: 0.125, perDiemRate: undefined, vehicles: ['AC 0246-7'], comment: '' });
assert.equal(groups[1].rate, 0.145);
assert.equal(groups[1].perDiemRate, 35);

// добавить АЕ 6052-7 в c2 и убрать AC 0246-7
const r = membershipUpdates('c2', ['AE 6052-7', 'ZZ 9999-9'], { tractors, couplings });
assert.deepEqual(r.updates, {
  'tractors/AC02467/rateGroupId': '',
  'tractors/AE60527/rateGroupId': 'c2',
  'couplings/AC02467/rateGroupId': '',
});
assert.deepEqual(r.unknownPlates, ['ZZ 9999-9']);
// без изменений — пустая карта
assert.deepEqual(membershipUpdates('c2', ['AC 0246-7'], { tractors, couplings }).updates, {});
console.log('rate-groups-single: ok');
