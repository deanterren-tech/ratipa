import assert from 'node:assert/strict';
import { directoryUsageCount } from '../src/utils/directoryUsage';

const data = {
  tractors: { a: { brand: 'Mercedes', trailerBrand: 'KOGEL', rateGroupId: 'c2' }, b: { brand: 'MERCEDES-BENZ', rateGroupId: '' } },
  couplings: { c: { brand: 'DAF', trailerMake: 'MERSEDES / KOEGEL', rateGroupId: 'c2' } },
  trailers: { t: { brand: 'Koegel' }, u: {} },
  drivers: { d: { rateGroupId: 'dir_1' } },
  trips: [{ direction: 'Турция' }, { direction: 'Китай' }, {}],
};
// марки считаются по написанию-синониму
assert.equal(directoryUsageCount('vehicleBrands', { key: 'MERCEDES-BENZ' }, data), 2);
assert.equal(directoryUsageCount('vehicleBrands', { key: 'DAF' }, data), 1);
assert.equal(directoryUsageCount('vehicleBrands', { key: 'VOLVO' }, data), 0);
// у прицепа берётся последняя часть «тягач / прицеп», у тягача — первая
assert.equal(directoryUsageCount('trailerBrands', { key: 'KOEGEL' }, data), 3);
assert.equal(directoryUsageCount('trailerBrands', { key: 'MERSEDES___KOEGEL', name: 'MERSEDES / KOEGEL' }, data), 0);
// группы ставок — по rateGroupId, пустое значение не считается
assert.equal(directoryUsageCount('rateGroups', { id: 'c2' }, data), 2);
assert.equal(directoryUsageCount('rateGroups', { id: 'dir_1' }, data), 1);
assert.equal(directoryUsageCount('rateGroups', { id: '' }, data), 0);
// направления — по названию в рейсах
assert.equal(directoryUsageCount('directions', { label: 'Турция' }, data), 1);
assert.equal(directoryUsageCount('directions', { name: 'Казахстан' }, data), 0);
// пустые данные не падают
assert.equal(directoryUsageCount('rateGroups', { id: 'c2' }, {}), 0);
console.log('directory-usage: ok');
