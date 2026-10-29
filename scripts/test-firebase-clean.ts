import assert from 'node:assert/strict';
import { sanitizeFirebaseObject } from '../src/utils/firebaseClean';

// запись расстояния без погранпереходов (так падало сохранение из «Плана дохода»)
assert.deepEqual(
  sanitizeFirebaseObject({ id: 'dist_1', from: 'Минск', to: 'Брест', distance: 350, checkpoints: undefined }),
  { id: 'dist_1', from: 'Минск', to: 'Брест', distance: 350 },
);
assert.deepEqual(sanitizeFirebaseObject({ a: { b: undefined, c: 0, d: null, e: '' } }), { a: { c: 0, d: null, e: '' } });
assert.deepEqual(sanitizeFirebaseObject([1, undefined, { x: undefined }]), [1, null, {}]);
assert.equal(sanitizeFirebaseObject(undefined), null);
assert.equal(sanitizeFirebaseObject('x'), 'x');
console.log('firebase-clean: ok');
