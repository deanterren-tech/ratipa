import assert from 'node:assert/strict';
import { countQuickFlags, passesQuickFilter, quickFlagsOfItems } from '../src/components/modules/tripTimeline/lib/quickFilters';

const seg = (state: 'ok' | 'soon' | 'late' | 'none') => ({ a: 1, b: 2, state, reason: '' });
const TODAY = 100;

// идущий рейс с красным концом — просрочка
let f = quickFlagsOfItems([{ kind: 'fact', open: true, status: [seg('ok'), seg('late')] }], TODAY);
assert.deepEqual(f, { late: true, soon: false, noFact: false });
// красный в прошлом, но дальше зелёный — не просрочка
f = quickFlagsOfItems([{ kind: 'fact', open: true, status: [seg('late'), seg('ok')] }], TODAY);
assert.deepEqual(f, { late: false, soon: false, noFact: false });
// оранжевый конец — срок подходит
f = quickFlagsOfItems([{ kind: 'fact', open: true, status: [seg('soon')] }], TODAY);
assert.equal(f.soon, true);
// завершённый рейс не считается
f = quickFlagsOfItems([{ kind: 'fact', open: false, status: [seg('late')] }], TODAY);
assert.equal(f.late, false);
// без факта: старт прошёл — ещё и просрочено; в будущем — только «без факта»
f = quickFlagsOfItems([{ kind: 'factNone', a: 90 }], TODAY);
assert.deepEqual(f, { late: true, soon: false, noFact: true });
f = quickFlagsOfItems([{ kind: 'factNone', a: 120 }], TODAY);
assert.deepEqual(f, { late: false, soon: false, noFact: true });
// события игнорируются
f = quickFlagsOfItems([{ kind: 'event' }], TODAY);
assert.deepEqual(f, { late: false, soon: false, noFact: false });

const all = [
  { late: true, soon: false, noFact: false },
  { late: false, soon: true, noFact: true },
  { late: false, soon: false, noFact: false },
];
assert.deepEqual(countQuickFlags(all), { late: 1, soon: 1, noFact: 1 });
assert.equal(passesQuickFilter(all[2], []), true);
assert.equal(passesQuickFilter(all[2], ['late']), false);
assert.equal(passesQuickFilter(all[1], ['late', 'soon']), true);
console.log('quick-filters: ok');
