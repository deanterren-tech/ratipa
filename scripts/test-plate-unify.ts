import assert from 'node:assert/strict';
import { buildRollback, buildUpdates, computeChanges } from './lib/plateUnifyCore';

const data: any = {
  tractors: {
    AO88077: { id: 'AO88077', carNumber: 'AO 8807-7' },
    'BB3325-7': { id: 'BB3325-7', carNumber: 'ВВ 3325-7', tractorId: 'BB3325-7' },
    'AK 3186-7 ': { id: 'AK31867', carNumber: 'AK 3186-7' },
    AK31867: { id: 'AK31867', carNumber: 'AK 3186-7' },
  },
  couplings: { 'BB3325-7': { id: 'BB3325-7', carNumber: 'ВВ 3325-7' } },
  baza: { b1: { carNumber: 'АО 8807-7 / А1086В7', couplingId: 'BB3325-7' } },
  trips_dashboard: { t1: { carNumber: 'АО8807-7' } },
  telemetry_navby_objects: { o1: { autoNumber: 'АО 8807-7' } },
  auditLogs: { l1: { car: 'АО 8807-7' } },
};
const changes = computeChanges(data, new Set(['telemetry_navby_objects']));
const built = buildUpdates(data, changes);
assert.equal(built.updates['baza/b1/carNumber'], 'AO 8807-7 / A 1086 B-7');
assert.equal(built.updates['trips_dashboard/t1/carNumber'], 'AO 8807-7');
assert.equal(built.updates['baza/b1/couplingId'], 'BB33257', 'ссылка на старый ключ переводится');
assert.equal(built.updates['tractors/BB3325-7'], null);
const moved: any = built.updates['tractors/BB33257'];
assert.equal(moved.id, 'BB33257');
assert.equal(moved.carNumber, 'BB 3325-7');
assert.equal(moved.tractorId, 'BB33257');
assert.ok(!('tractors/BB3325-7/id' in built.updates), 'вложенные пути переносимой записи не пишутся отдельно');
assert.equal(built.updates['couplings/BB33257'] !== undefined, true);
assert.equal(built.updates['tractors/AK 3186-7 '], null, 'полный двойник удаляется');
assert.equal(built.updates['tractors/AK31867'], undefined, 'основная запись не перезаписывается');
assert.ok(!Object.keys(built.updates).some((p) => p.startsWith('auditLogs') || p.startsWith('telemetry_navby_objects')), 'журналы и исключённые ветки не трогаются');
const rb = buildRollback(data, built.updates);
assert.equal(rb['tractors/BB33257'], null);
assert.equal((rb['tractors/BB3325-7'] as any).id, 'BB3325-7');
assert.equal(rb['baza/b1/couplingId'], 'BB3325-7');
// Двойник-огрызок (только диспетчер, уже есть в основной записи) удаляется без потерь
const stub: any = { tractors: { A042HY67: { id: 'A042HY67', carNumber: 'А042НУ67', dispatcherName: 'Юрий' }, 'А042НУ67': { dispatcherName: 'Юрий' } } };
const b2 = buildUpdates(stub, computeChanges(stub, new Set()));
assert.equal(b2.updates['tractors/А042НУ67'], null);
assert.equal(b2.conflicts.length, 0);
// Двойник с собственными данными — конфликт, не удаляется
const real: any = { tractors: { AO88077: { id: 'AO88077', carNumber: 'AO 8807-7' }, 'AO 8807-7 ': { id: 'AO88077', carNumber: 'AO 8807-7', phone: '1' } } };
const b3 = buildUpdates(real, computeChanges(real, new Set()));
assert.equal(b3.conflicts.length, 1);
assert.ok(!('tractors/AO 8807-7 ' in b3.updates));
console.log('plate-unify: ok');
