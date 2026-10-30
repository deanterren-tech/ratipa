import assert from 'node:assert/strict';
import { isoFromTyped, maskDateDigits } from '../src/components/common/DateTextInput';

assert.equal(maskDateDigits('1'), '1');
assert.equal(maskDateDigits('140'), '14/0');
assert.equal(maskDateDigits('14071991'), '14/07/1991');
assert.equal(maskDateDigits('14.07.1991'), '14/07/1991', 'вставка с точками');
assert.equal(maskDateDigits('14/07/19912025'), '14/07/1991', 'лишнее отбрасывается');
assert.equal(isoFromTyped('14/07/1991'), '1991-07-14');
assert.equal(isoFromTyped('31/02/2030'), '', 'несуществующая дата');
assert.equal(isoFromTyped('14/07/19'), '', 'неполная дата не пишется');
assert.equal(isoFromTyped('29/02/2028'), '2028-02-29', 'високосный год');
assert.equal(isoFromTyped('29/02/2027'), '');
console.log('date-text-input: ok');
