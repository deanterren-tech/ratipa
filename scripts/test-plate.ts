import assert from 'node:assert/strict';
import { formatPlate, plateKey, samePlate } from '../src/utils/plate';

assert.equal(plateKey('АО 8807-7'), 'AO88077');
assert.equal(plateKey('AO 8807-7 / А 1086 В-7'), 'AO88077');
assert.equal(plateKey('А042НУ67'), 'A042HY67');
assert.equal(plateKey(null), '');
assert.equal(formatPlate('АО8807-7'), 'AO 8807-7');
assert.equal(formatPlate('ao 8807 - 7'), 'AO 8807-7');
assert.equal(formatPlate('А042НУ67'), 'A042HY67');
assert.equal(formatPlate('АО 8807-7 / А 1086 В-7'), 'AO 8807-7 / A 1086 B-7');
assert.equal(formatPlate('ВТ4977 50'), 'ВТ4977 50');
assert.ok(samePlate('AO 8807-7', 'АО88077'));
assert.ok(!samePlate('', ''));
console.log('plate: ok');
