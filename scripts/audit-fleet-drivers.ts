/**
 * Аудит источников данных о водителях Ratipa Portal — ТОЛЬКО ЧТЕНИЕ.
 *
 * Что проверяет:
 *  1. Все найденные источники водителей/телефонов/назначений и их размеры.
 *  2. Одинаковые id с разными значениями (реестр ↔ сцепки/карточки/учёт/зарплаты).
 *  3. Разные id, которые могут быть одним человеком (ФИО, телефон) — факты, без выводов.
 *  4. Телефоны: где встречается каждый номер, номера вне реестра, номера у двух водителей.
 *  5. Записи реестра/списков без связей и «висячие» ссылки (driverId не из реестра).
 *  6. Назначения на несуществующих водителей.
 *  7. Согласованность связей автомобиль ↔ водитель ↔ диспетчер.
 *  8. Именованные записи владельца: «Шерамет», «Калинин», «без В.».
 *  9. Кандидаты на заполнение пропусков реестра из «Автопарк и Водители» (tractors).
 *
 * Никаких записей не делает. Пишет JSON-отчёт и печатает сводку.
 * Запуск: npx tsx scripts/audit-fleet-drivers.ts
 */

import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const OUT_DIR = join(homedir(), '.hermes', 'cache', 'scratch', 'fleet-data');
const ONLY_JSON = process.argv.slice(2).includes('--json-only');

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

async function rest<T = unknown>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${DB}/${path}.json`);
    if (!r.ok) {
      console.log(`  ! ${path}: HTTP ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.log(`  ! ${path}: ${String(e).slice(0, 100)}`);
    return null;
  }
}

interface Row {
  id: string;
  rec: Obj;
}
const rows = (branch: unknown): Row[] => Object.entries(asObj(branch)).map(([k, v]) => ({ id: k, rec: asObj(v) }));
/** Запись из аргумента: принимает и строку таблицы (Row), и саму запись — аудит не зависит от формы вызова. */
const recOf = (x: unknown): Obj | undefined => {
  if (!x || typeof x !== 'object') return undefined;
  const inner = (x as { rec?: unknown }).rec;
  if (inner && typeof inner === 'object') return inner as Obj;
  return x as Obj;
};

// ---------- нормализация ----------

const norm = (x: string): string =>
  x
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Части ФИО: [Фамилия, Имя, Отчество] — порядок записей в базе. */
function nameParts(x: string): string[] {
  const t = norm(x).split(' ').filter(Boolean);
  return t;
}

/** Совместимость двух «частей» имени: равны, одна — начало другой, или одна — инициал. */
function partCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  if (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

type NameVerdict = 'same' | 'compatible' | 'conflict' | 'one-empty';
/** Сравнение двух ФИО «Фамилия Имя Отчество» (или сокращённых форм). */
function compareNames(a: string, b: string): NameVerdict {
  const A = nameParts(a);
  const B = nameParts(b);
  if (!A.length || !B.length) return 'one-empty';
  if (A.join(' ') === B.join(' ')) return 'same';
  if (!partCompatible(A[0], B[0])) return 'conflict';
  const firstOk = partCompatible(A[1] || '', B[1] || '');
  const middleOk = partCompatible(A[2] || '', B[2] || '');
  const firstMissing = !A[1] || !B[1];
  // «Шерамет» (только фамилия) против «Шерамет Сергей Николаевич» — совместимо
  if (firstMissing && (!A[2] || !B[2] || middleOk)) return 'compatible';
  if (firstOk && (middleOk || !A[2] || !B[2])) return 'compatible';
  return 'conflict';
}

/** Нормализация телефона: только цифры; ключ — последние 9 цифр. */
function phoneKey(x: string): string | null {
  const digits = x.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

/** Нормализация госномера: убрать пробелы/дефисы, кириллицу → латиницу, uppercase. */
const CYR2LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
};
function normPlate(x: string): string {
  return x
    .toUpperCase()
    .replace(/[^A-ZА-Я0-9]/gi, '')
    .split('')
    .map((ch) => CYR2LAT[ch] ?? ch)
    .join('');
}

const digitsOf = (x: string) => x.replace(/\D/g, '');

// ---------- сбор данных ----------

interface SalarySource {
  id: string;
  path: string;
  rec: Obj;
}
function collectSalary(root: Obj | null): { records: Map<string, SalarySource>; flatCount: number; monthsCount: number; byDispatcherCount: number } {
  const records = new Map<string, SalarySource>();
  const r = asObj(root);
  for (const [k, v] of Object.entries(r)) {
    if (k === 'flat' || k === 'months' || k === 'byDispatcher') continue;
    const rec = asObj(v);
    if ('driver' in rec || 'driverId' in rec) records.set(k, { id: k, path: `salaryHistory/${k}`, rec });
  }
  let flatCount = 0;
  for (const [k, v] of Object.entries(asObj(r.flat))) {
    flatCount++;
    const rec = asObj(v);
    const id = s(rec.id) || k;
    if (!records.has(id)) records.set(id, { id, path: `salaryHistory/flat/${k}`, rec });
  }
  let monthsCount = 0;
  for (const month of Object.values(asObj(r.months))) for (const _ of Object.values(asObj(month))) monthsCount++;
  let byDispatcherCount = 0;
  for (const disp of Object.values(asObj(r.byDispatcher))) for (const _ of Object.values(asObj(disp))) byDispatcherCount++;
  return { records, flatCount, monthsCount, byDispatcherCount };
}

interface PhoneEntry {
  owner: string; // id записи-владельца
  ownerName: string;
  section: 'drivers' | 'tractors';
  field: string; // phone | phones[0] | driverPhone ...
  value: string;
}

function phonesOf(input: unknown, opts: { singleFields: string[] }): Array<{ field: string; value: string }> {
  const rec = recOf(input);
  if (!rec) return [];
  const out: Array<{ field: string; value: string }> = [];
  const seen = new Set<string>();
  for (const f of ['phones']) {
    arr(rec[f]).forEach((p, i) => {
      const n = s(asObj(p).number) || s(p);
      if (n) {
        out.push({ field: `${f}[${i}]`, value: n });
        seen.add(n);
      }
    });
  }
  for (const f of opts.singleFields) {
    const n = s(rec[f]);
    if (n && !seen.has(n)) out.push({ field: f, value: n });
  }
  return out;
}

// ---------- main ----------

async function main() {
  console.log(`Аудит водителей Ratipa Portal (чтение, без записи)\nБаза: ${DB}\n`);
  const [
    driversRaw, tractorsRaw, trailersRaw, couplingsRaw, usersRaw, bazaRaw, salaryRaw,
    ferryRaw, driverTasksRaw, documentsRaw, routedeskRaw, vehicleFleetRaw, bazaCarsRaw,
  ] = await Promise.all([
    rest('drivers'), rest('tractors'), rest('trailers'), rest('couplings'), rest('users_list'),
    rest('baza'), rest('salaryHistory'), rest('ferryCouples'), rest('driverTasks'),
    rest('documents'), rest('routedesk'), rest('vehicleFleet'), rest('baza_cars'),
  ]);

  const drivers = rows(driversRaw);
  const tractors = rows(tractorsRaw);
  const couplings = rows(couplingsRaw);
  const trailers = rows(trailersRaw);
  const users = rows(usersRaw);
  const baza = rows(bazaRaw);
  const salary = collectSalary(salaryRaw as Obj | null);
  const ferries = rows(ferryRaw);
  const tasks = rows(driverTasksRaw);
  const routedesk = asObj(routedeskRaw);
  const routedeskDrivers = arr(asObj(routedesk.references).drivers).map((r) => asObj(r));
  const vehicleFleet = rows(vehicleFleetRaw);
  const bazaCars = rows(bazaCarsRaw);

  const driverById = new Map(drivers.map((d) => [d.id, d.rec]));
  const dispatcherUsers = users.filter((u) => u.rec.isDispatcher === true);
  const dispatcherIds = new Set(dispatcherUsers.map((u) => u.id));
  const userNameById = new Map(users.map((u) => [u.id, s(u.rec.name)]));

  const report: Record<string, unknown> = {
    when: new Date().toISOString(),
    db: DB,
    sources: {
      drivers: drivers.length,
      tractors: tractors.length,
      trailers: trailers.length,
      couplings: couplings.length,
      users_list: users.length,
      users_dispatchers: dispatcherUsers.length,
      baza: baza.length,
      salaryHistory_unique_records: salary.records.size,
      salaryHistory_copies: { flat: salary.flatCount, months: salary.monthsCount, byDispatcher: salary.byDispatcherCount },
      ferryCouples: ferries.length,
      driverTasks: tasks.length,
      documents: rows(documentsRaw).length,
      routedesk_reference_drivers: routedeskDrivers.length,
      vehicleFleet: vehicleFleet.length,
      baza_cars: bazaCars.length,
    },
  };

  if (!ONLY_JSON) {
    console.log('=== ИСТОЧНИКИ ===');
    for (const [k, v] of Object.entries(report.sources as Record<string, unknown>)) {
      console.log(`  ${k.padEnd(30)} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }

  // ---------- 1. заполненность полей реестра ----------
  const DRIVER_FIELDS = ['name', 'shortNameRu', 'lastNameRu', 'firstNameRu', 'middleNameRu', 'nameLat', 'phone', 'phones', 'license', 'licenseNumber', 'passport', 'passportStart', 'passportEnd', 'passportIssued', 'personalId', 'birthDate', 'dispatcherId', 'rateGroupId'];
  const fillMatrix: Record<string, number> = {};
  for (const f of DRIVER_FIELDS) fillMatrix[f] = 0;
  for (const d of drivers) {
    for (const f of DRIVER_FIELDS) {
      const v = d.rec[f];
      const filled = Array.isArray(v) ? v.length > 0 : s(v) !== '';
      if (filled) fillMatrix[f]++;
    }
  }
  report.drivers_fill_matrix = fillMatrix;
  if (!ONLY_JSON) {
    console.log('\n=== ЗАПОЛНЕННОСТЬ ПОЛЕЙ РЕЕСТРА (drivers, всего ' + drivers.length + ') ===');
    for (const f of DRIVER_FIELDS) console.log(`  ${f.padEnd(18)} ${String(fillMatrix[f]).padStart(3)}/${drivers.length}`);
  }

  // ---------- 2. подозрительные/служебные записи реестра ----------
  const stubLike = drivers.filter((d) => {
    const hasAny = s(d.rec.phone) || arr(d.rec.phones).length || s(d.rec.passport) || s(d.rec.license) || s(d.rec.licenseNumber) || s(d.rec.birthDate) || s(d.rec.personalId) || s(d.rec.dispatcherId);
    return !hasAny;
  });
  const placeholder = drivers.filter((d) => /^без\b/i.test(s(d.rec.name)) || /^без\b/i.test(s(d.rec.lastNameRu)));
  report.registry_stub_like = stubLike.map((d) => ({ id: d.id, name: s(d.rec.name), shortNameRu: s(d.rec.shortNameRu) }));
  report.registry_placeholder = placeholder.map((d) => ({ id: d.id, name: s(d.rec.name) }));

  // ---------- 3. одинаковый id — расходящиеся значения ----------
  interface Divergence {
    branch: string;
    id: string;
    driverId: string;
    field: string;
    value: string;
    expected: string;
    kind: 'conflict' | 'short-form' | 'empty';
  }
  const divergences: Divergence[] = [];
  const canonicalName = (input: unknown) => {
    const rec = recOf(input);
    return rec ? s(rec.shortNameRu) || s(rec.name) : '';
  };

  const nameCheck = (branch: string, id: string, driverId: string, field: string, value: string, canonical: string, out: Divergence[]) => {
    if (!driverId || !canonical) return;
    if (!value) {
      out.push({ branch, id, driverId, field, value: '(пусто)', expected: canonical, kind: 'empty' });
      return;
    }
    const v = compareNames(value, canonical);
    if (v === 'conflict') out.push({ branch, id, driverId, field, value, expected: canonical, kind: 'conflict' });
    else if (v === 'compatible') out.push({ branch, id, driverId, field, value, expected: canonical, kind: 'short-form' });
  };

  for (const c of couplings) {
    const dId = s(c.rec.driverId);
    const d = driverById.get(dId);
    if (!dId || !d) continue;
    const canonical = canonicalName(d.rec);
    nameCheck('couplings', c.id, dId, 'driverName', s(c.rec.driverName), canonical, divergences);
    nameCheck('couplings', c.id, dId, 'driverNameRu', s(c.rec.driverNameRu), canonical, divergences);
  }

  const fieldDivergences: Array<{ branch: string; id: string; driverId: string; field: string; value: string; expected: string }> = [];
  for (const t of tractors) {
    const dId = s(t.rec.driverId);
    const d = driverById.get(dId);
    if (!dId || !d) continue;
    const canonical = canonicalName(d.rec);
    nameCheck('tractors', t.id, dId, 'driverName', s(t.rec.driverName), canonical, divergences);
    nameCheck('tractors', t.id, dId, 'driverNameRu', s(t.rec.driverNameRu), canonical, divergences);
    nameCheck('tractors', t.id, dId, 'driverNameLat', s(t.rec.driverNameLat), s(d.nameLat), divergences);
    const pairs: Array<[string, string]> = [
      ['passportNumber', s(d.passport)],
      ['personalId', s(d.personalId)],
      ['passportStart', s(d.passportStart)],
      ['passportEnd', s(d.passportEnd)],
      ['passportIssuedBy', s(d.passportIssued)],
      ['birthDate', s(d.birthDate)],
    ];
    for (const [f, expected] of pairs) {
      const v = s(t.rec[f]);
      if (expected && v && norm(v) !== norm(expected)) fieldDivergences.push({ branch: 'tractors', id: t.id, driverId: dId, field: f, value: v, expected });
      if (!expected && v) fieldDivergences.push({ branch: 'tractors', id: t.id, driverId: dId, field: f, value: v, expected: '(в реестре пусто)' });
    }
    // телефоны: наборы
    const tPhones = new Set(phonesOf(t.rec, { singleFields: ['driverPhone', 'phone'] }).map((p) => phoneKey(p.value)).filter((x): x is string => !!x));
    const dPhones = new Set(phonesOf(d.rec, { singleFields: ['phone'] }).map((p) => phoneKey(p.value)).filter((x): x is string => !!x));
    if (tPhones.size && dPhones.size) {
      const onlyT = [...tPhones].filter((x) => !dPhones.has(x));
      const onlyD = [...dPhones].filter((x) => !tPhones.has(x));
      if (onlyT.length && onlyD.length) fieldDivergences.push({ branch: 'tractors', id: t.id, driverId: dId, field: 'phones', value: `только в карточке: ${onlyT.join(',')}`, expected: `только в реестре: ${onlyD.join(',')}` });
    }
  }

  for (const b of baza) {
    const dId = s(b.rec.driverId);
    const d = dId ? driverById.get(dId) : undefined;
    if (!d) continue;
    const canonical = canonicalName(d.rec);
    nameCheck('baza', b.id, dId, 'driverName', s(b.rec.driverName), canonical, divergences);
    nameCheck('baza', b.id, dId, 'driverShortNameRu', s(b.rec.driverShortNameRu), canonical, divergences);
  }

  for (const rec of salary.records.values()) {
    const dId = s(rec.rec.driverId);
    const d = dId ? driverById.get(dId) : undefined;
    if (!d) continue;
    nameCheck(rec.path, rec.id, dId, 'driver', s(rec.rec.driver), canonicalName(d.rec), divergences);
  }

  report.same_id_name_divergences = divergences;
  report.same_id_field_divergences = fieldDivergences;
  if (!ONLY_JSON) {
    console.log('\n=== ОДИНАКОВЫЙ ID — РАСХОЖДЕНИЯ ИМЁН (реестр — эталон) ===');
    if (!divergences.length) console.log('  нет');
    for (const d of divergences) console.log(`  [${d.kind}] ${d.branch}/${d.id}: ${d.field} = «${d.value}» ↔ реестр «${d.expected}» (${d.driverId})`);
    console.log('\n=== ОДИНАКОВЫЙ ID — РАСХОЖДЕНИЯ ПОЛЕЙ (карточки авто ↔ реестр) ===');
    if (!fieldDivergences.length) console.log('  нет');
    for (const d of fieldDivergences) console.log(`  tractors/${d.id} (${d.driverId}): ${d.field}: «${d.value}» ↔ «${d.expected}»`);
  }

  // ---------- 4. разные id — возможно один человек ----------
  const persons: Array<{ a: Row; b: Row; sharedPhone: string | null; nameVerdict: NameVerdict }> = [];
  const phoneOwners = new Map<string, Array<{ id: string; name: string }>>();
  for (const d of drivers) {
    const name = canonicalName(d.rec);
    for (const p of phonesOf(d.rec, { singleFields: ['phone'] })) {
      const key = phoneKey(p.value);
      if (!key) continue;
      phoneOwners.set(key, [...(phoneOwners.get(key) || []), { id: d.id, name }]);
    }
  }
  for (let i = 0; i < drivers.length; i++) {
    for (let j = i + 1; j < drivers.length; j++) {
      const a = drivers[i];
      const b = drivers[j];
      const an = canonicalName(a.rec);
      const bn = canonicalName(b.rec);
      if (!an || !bn) continue;
      const verdict = compareNames(an, bn);
      const aPhones = new Set(phonesOf(a.rec, { singleFields: ['phone'] }).map((p) => phoneKey(p.value)).filter((x): x is string => !!x));
      const bPhones = phonesOf(b.rec, { singleFields: ['phone'] }).map((p) => phoneKey(p.value)).filter((x): x is string => !!x);
      const shared = bPhones.find((x) => aPhones.has(x)) || null;
      if (verdict === 'same' || (verdict === 'compatible' && nameParts(an)[0] === nameParts(bn)[0]) || (verdict === 'conflict' && shared)) {
        // Общий телефон при разных фамилиях — тоже кандидат «проверить», но с пометкой конфликта имён
        persons.push({ a, b, sharedPhone: shared, nameVerdict: verdict });
      }
    }
  }
  report.possible_same_person_pairs = persons.map((p) => ({
    a: { id: p.a.id, name: canonicalName(p.a.rec) },
    b: { id: p.b.id, name: canonicalName(p.b.rec) },
    sharedPhone: p.sharedPhone,
    nameVerdict: p.nameVerdict,
  }));
  if (!ONLY_JSON) {
    console.log('\n=== РАЗНЫЕ ID — ВОЗМОЖНО ОДИН ЧЕЛОВЕК (только факты, НЕ объединять автоматически) ===');
    if (!persons.length) console.log('  нет');
    for (const p of persons) {
      console.log(`  «${canonicalName(p.a.rec)}» (${p.a.id}) ↔ «${canonicalName(p.b.rec)}» (${p.b.id})${p.sharedPhone ? ` — общий телефон (…${p.sharedPhone})` : ''} [имена: ${p.nameVerdict}${p.nameVerdict === 'conflict' ? ' — фамилии разные, автоматически НЕ объединять' : ''}]`);
    }
  }

  // ---------- 5. телефоны ----------
  const phoneEntries: PhoneEntry[] = [];
  for (const d of drivers) {
    for (const p of phonesOf(d.rec, { singleFields: ['phone'] })) {
      phoneEntries.push({ owner: d.id, ownerName: canonicalName(d.rec), section: 'drivers', field: p.field, value: p.value });
    }
  }
  for (const t of tractors) {
    for (const p of phonesOf(t.rec, { singleFields: ['driverPhone', 'phone'] })) {
      phoneEntries.push({ owner: t.id, ownerName: s(t.rec.driverNameRu) || s(t.rec.driverName), section: 'tractors', field: p.field, value: p.value });
    }
  }
  const byPhone = new Map<string, PhoneEntry[]>();
  for (const e of phoneEntries) {
    const key = phoneKey(e.value) || `raw:${e.value}`;
    byPhone.set(key, [...(byPhone.get(key) || []), e]);
  }
  const uniqOwners = (list: PhoneEntry[]) => new Map(list.map((e) => [`${e.section}:${e.owner}`, e]));
  const sharedPhones: Array<{ phone: string; owners: string[]; sections: string[] }> = [];
  const tractorOnly: Array<{ phone: string; owners: string[] }> = [];
  const driverOnly: Array<{ phone: string; owners: string[] }> = [];
  const multiDriver: Array<{ phone: string; owners: string[] }> = [];
  for (const [key, list] of byPhone) {
    const owners = uniqOwners(list);
    const sections = [...new Set([...owners.values()].map((e) => e.section))];
    const driverOwners = [...new Set([...owners.values()].filter((e) => e.section === 'drivers').map((e) => `${e.ownerName} (${e.owner})`))];
    const label = list[0].value;
    if (owners.size > 1) sharedPhones.push({ phone: label, owners: [...owners.values()].map((e) => `${e.section}/${e.owner}`), sections });
    if (sections.length === 1 && sections[0] === 'tractors') tractorOnly.push({ phone: label, owners: [...owners.values()].map((e) => e.owner) });
    if (sections.length === 1 && sections[0] === 'drivers') driverOnly.push({ phone: label, owners: [...owners.values()].map((e) => `${e.ownerName} (${e.owner})`) });
    if (driverOwners.length > 1) multiDriver.push({ phone: label, owners: driverOwners });
  }
  // расхождения внутри записи: одиночное поле не входит в phones[]
  const withinRecord: Array<{ path: string; field: string; value: string; phones: string[] }> = [];
  for (const d of drivers) {
    const list = arr(d.rec.phones).map((p) => s(asObj(p).number) || s(p)).filter(Boolean);
    const single = s(d.rec.phone);
    if (single && list.length && !list.includes(single)) withinRecord.push({ path: `drivers/${d.id}`, field: 'phone', value: single, phones: list });
  }
  // Номер из карточки авто принадлежит ДРУГОМУ водителю реестра (устаревший след)
  const driverPhoneToDrivers = new Map<string, Array<{ id: string; name: string }>>();
  for (const d of drivers) {
    for (const p of phonesOf(d.rec, { singleFields: ['phone'] })) {
      const k = phoneKey(p.value);
      if (!k) continue;
      driverPhoneToDrivers.set(k, [...(driverPhoneToDrivers.get(k) || []), { id: d.id, name: canonicalName(d.rec) }]);
    }
  }
  const tractorPhoneOfOtherDriver: Array<{ tractor: string; driverId: string; phone: string; belongsTo: string[] }> = [];
  for (const t of tractors) {
    const dId = s(t.rec.driverId);
    for (const p of phonesOf(t.rec, { singleFields: ['driverPhone', 'phone'] })) {
      const k = phoneKey(p.value);
      if (!k) continue;
      const owners = driverPhoneToDrivers.get(k) || [];
      if (owners.length && !owners.some((o) => o.id === dId)) {
        tractorPhoneOfOtherDriver.push({ tractor: t.id, driverId: dId || '(пусто)', phone: p.value, belongsTo: owners.map((o) => `${o.name} (${o.id})`) });
      }
    }
  }
  report.phones = {
    total_entries: phoneEntries.length,
    unique_phones: byPhone.size,
    shared_multiple_owners: sharedPhones,
    only_in_tractors: tractorOnly,
    only_in_drivers: driverOnly,
    same_number_two_drivers: multiDriver,
    single_field_not_in_phones_array: withinRecord,
    tractor_phone_of_other_driver: tractorPhoneOfOtherDriver,
  };
  if (!ONLY_JSON) {
    console.log('\n=== ТЕЛЕФОНЫ ===');
    console.log(`  всего номеров (уникальных): ${byPhone.size}; записей с номером: ${phoneEntries.length}`);
    console.log(`  встречаются у нескольких владельцев: ${sharedPhones.length}; только в карточках авто: ${tractorOnly.length}; только в реестре водителей: ${driverOnly.length}`);
    console.log(`  один номер у 2+ РАЗНЫХ водителей: ${multiDriver.length}`);
    for (const m of multiDriver) console.log(`    ! ${m.phone} — ${m.owners.join(', ')}`);
    console.log('  номера только в карточках авто (вне реестра водителей):');
    for (const t of tractorOnly) console.log(`    · ${t.phone} — ${t.owners.join(', ')}`);
    console.log('  одиночное поле phone не входит в phones[] (внутреннее расхождение):');
    for (const w of withinRecord) console.log(`    · ${w.path}: ${w.value} (в phones[]: ${w.phones.join(', ')})`);
    console.log('  номера только в реестре (нет ни в одной карточке авто):');
    for (const o of driverOnly) console.log(`    · ${o.phone} — ${o.owners.join(', ')}`);
    console.log(`  номер карточки авто принадлежит другому водителю: ${tractorPhoneOfOtherDriver.length}`);
    for (const o of tractorPhoneOfOtherDriver) console.log(`    ! tractors/${o.tractor} (driverId=${o.driverId}): ${o.phone} → ${o.belongsTo.join(', ')}`);
  }

  // ---------- 6. выпадающие списки и «висячие» ссылки ----------
  interface RefCheck {
    id: string;
    name?: string;
    ok: boolean;
    note?: string;
  }
  const collisionCheck = (list: Row[], field: 'driverId', nameFields: string[]): RefCheck[] => {
    const out: RefCheck[] = [];
    for (const r of list) {
      const dId = s(r.rec[field]);
      if (!dId) continue;
      const name = nameFields.map((f) => s(r.rec[f])).find(Boolean) || '';
      if (!driverById.has(dId)) out.push({ id: r.id, name, ok: false, note: `${dId} отсутствует в реестре` });
    }
    return out;
  };
  const dangling = {
    couplings: collisionCheck(couplings, 'driverId', ['driverName', 'driverNameRu']),
    tractors: collisionCheck(tractors, 'driverId', ['driverNameRu', 'driverName']),
    baza: collisionCheck(baza, 'driverId', ['driverName', 'driverRaw']),
    salaryHistory: collisionCheck([...salary.records.values()].map((r) => ({ id: r.id, rec: r.rec })), 'driverId', ['driver']),
    driverTasks: collisionCheck(tasks, 'driverId', ['driverName']),
  };
  report.dangling_driver_ids = dangling;
  if (!ONLY_JSON) {
    console.log('\n=== НАЗНАЧЕНИЯ НА ОТСУТСТВУЮЩИХ ВОДИТЕЛЕЙ (driverId не из реестра) ===');
    for (const [branch, list] of Object.entries(dangling)) {
      console.log(`  ${branch}: ${list.length}`);
      for (const x of list.slice(0, 60)) console.log(`    · ${x.id} «${x.name}» — ${x.note}`);
      if (list.length > 60) console.log(`    … ещё ${list.length - 60}`);
    }
  }

  // реестр без ссылок (записи, которые нигде не используются)
  const usedIds = new Set<string>();
  for (const c of couplings) if (driverById.has(s(c.rec.driverId))) usedIds.add(s(c.rec.driverId));
  for (const t of tractors) if (driverById.has(s(t.rec.driverId))) usedIds.add(s(t.rec.driverId));
  for (const b of baza) if (driverById.has(s(b.rec.driverId))) usedIds.add(s(b.rec.driverId));
  for (const r of salary.records.values()) if (driverById.has(s(r.rec.driverId))) usedIds.add(s(r.rec.driverId));
  const unreferencedRegistry = drivers.filter((d) => !usedIds.has(d.id)).map((d) => ({ id: d.id, name: canonicalName(d.rec) }));
  report.registry_unreferenced = unreferencedRegistry;
  report.routedesk_reference_drivers = routedeskDrivers.map((r) => ({ id: s(r.id), name: s(r.name), inRegistry: driverById.has(s(r.id)) }));
  if (!ONLY_JSON) {
    console.log('\n=== РЕЕСТР, НА КОТОРЫЙ НИКТО НЕ ССЫЛАЕТСЯ ===');
    if (!unreferencedRegistry.length) console.log('  нет');
    for (const d of unreferencedRegistry) console.log(`  · ${d.id} «${d.name}»`);
    console.log('\n=== ОТДЕЛЬНЫЙ СПИСОК ВОДИТЕЛЕЙ В routedesk.references (демо-данные) ===');
    for (const r of report.routedesk_reference_drivers as Array<{ id: string; name: string; inRegistry: boolean }>) {
      console.log(`  · ${r.id} «${r.name}»${r.inRegistry ? '' : ' — НЕТ в реестре'}`);
    }
  }

  // ---------- 7. связи автомобиль ↔ водитель ↔ диспетчер ----------
  const issues: string[] = [];
  const tractorById = new Map(tractors.map((t) => [t.id, t]));
  const tractorByPlate = new Map<string, Row[]>();
  for (const t of tractors) {
    const plate = normPlate(s(t.rec.carNumber));
    if (!plate) continue;
    tractorByPlate.set(plate, [...(tractorByPlate.get(plate) || []), t]);
  }
  for (const c of couplings) {
    const tId = s(c.rec.tractorId) || c.id;
    const t = tractorById.get(tId) || tractorByPlate.get(normPlate(s(c.rec.carNumber)))?.[0];
    if (!t) {
      issues.push(`couplings/${c.id}: нет карточки авто (tractorId=${tId})`);
      continue;
    }
    if (s(t.rec.driverId) !== s(c.rec.driverId)) issues.push(`couplings/${c.id}: driverId сцепки «${s(c.rec.driverId)}» ≠ карточки авто «${s(t.rec.driverId)}»`);
    if (s(t.rec.dispatcherId) && s(c.rec.dispatcherId) && s(t.rec.dispatcherId) !== s(c.rec.dispatcherId)) issues.push(`couplings/${c.id}: dispatcherId сцепки «${s(c.rec.dispatcherId)}» ≠ карточки авто «${s(t.rec.dispatcherId)}»`);
    const dispNames = [s(c.rec.dispatcherName) || s(c.rec.dispatcher), s(t.rec.dispatcherName) || s(t.rec.dispatcher)].filter(Boolean);
    if (dispNames.length === 2 && dispNames[0] !== dispNames[1]) issues.push(`couplings/${c.id}: имя диспетчера «${dispNames[0]}» ≠ «${dispNames[1]}»`);
    for (const [where, dId, dName] of [
      ['сцепка', s(c.rec.dispatcherId), s(c.rec.dispatcherName)],
      ['карточка', s(t.rec.dispatcherId), s(t.rec.dispatcherName)],
    ] as Array<[string, string, string]>) {
      if (dId && !dispatcherIds.has(dId)) issues.push(`couplings/${c.id} (${where}): диспетчер «${dName}» (${dId}) не найден среди учётных записей с isDispatcher`);
      if (dId && userNameById.has(dId) && dName && userNameById.get(dId) !== dName) issues.push(`couplings/${c.id} (${where}): имя диспетчера «${dName}» ≠ учётной записи «${userNameById.get(dId)}»`);
    }
  }
  // дубли карточек по госномеру (кириллица/латиница, пробелы)
  const plateDupes: Array<{ plate: string; records: string[] }> = [];
  for (const [plate, list] of tractorByPlate) if (list.length > 1) plateDupes.push({ plate, records: list.map((t) => t.id) });
  // водители с двумя авто
  const driverCars = new Map<string, string[]>();
  for (const t of tractors) {
    const dId = s(t.rec.driverId);
    if (!dId) continue;
    driverCars.set(dId, [...(driverCars.get(dId) || []), t.id]);
  }
  const multiCar = [...driverCars.entries()].filter(([, list]) => list.length > 1);
  report.link_issues = issues;
  report.duplicate_tractor_plates = plateDupes;
  report.drivers_with_multiple_tractors = multiCar.map(([dId, list]) => ({ driverId: dId, name: canonicalName(driverById.get(dId) || {}), tractors: list }));
  if (!ONLY_JSON) {
    console.log('\n=== СВЯЗИ АВТОМОБИЛЬ ↔ ВОДИТЕЛЬ ↔ ДИСПЕТЧЕР ===');
    if (!issues.length) console.log('  расхождений нет');
    for (const i of issues) console.log(`  ! ${i}`);
    console.log(`  дубли карточек авто по госномеру (латиница/кириллица, пробелы): ${plateDupes.length}`);
    for (const p of plateDupes) console.log(`    · ${p.plate}: ${p.records.join(', ')}`);
    console.log(`  водителей с несколькими карточками авто: ${multiCar.length}`);
    for (const m of report.drivers_with_multiple_tractors as Array<{ driverId: string; name: string; tractors: string[] }>) console.log(`    · ${m.name} (${m.driverId}): ${m.tractors.join(', ')}`);
  }

  // ---------- 8. именованные записи ----------
  const namedCases: Array<{ title: string; ids: string[]; re: RegExp; out: Array<{ path: string; fields: Record<string, string> }> }> = [
    { title: 'Шерамет', ids: ['SHARAMETSIARHEI', 'dr_1791975260584', 'dr_1783410276084'], re: /шерамет/i, out: [] },
    { title: 'Калинин', ids: ['drv_1787140087040', 'dr_1791975506622', 'dr_1787121930284'], re: /калинин/i, out: [] },
    { title: 'без В.', ids: ['dr_1787831393161'], re: /^без в\.?$/i, out: [] },
  ];
  const scanBranch = (branchName: string, list: Row[], fields: string[]) => {
    for (const r of list) {
      const vals = fields.map((f) => s(r.rec[f]));
      const dId = s(r.rec.driverId);
      for (const c of namedCases) {
        const hit = c.ids.includes(dId) || c.ids.includes(r.id) || vals.some((v) => v && c.re.test(v));
        if (!hit) continue;
        const picked: Record<string, string> = {};
        for (const f of fields) if (s(r.rec[f])) picked[f] = s(r.rec[f]);
        picked['_driverId'] = dId;
        c.out.push({ path: `${branchName}/${r.id}`, fields: picked });
      }
    }
  };
  scanBranch('drivers', drivers, ['name', 'shortNameRu', 'lastNameRu', 'firstNameRu', 'middleNameRu', 'nameLat', 'phone', 'license', 'passport', 'personalId', 'birthDate', 'dispatcherName', 'dispatcherId', 'comment']);
  scanBranch('couplings', couplings, ['driverName', 'driverNameRu', 'carNumber', 'dispatcherName']);
  scanBranch('tractors', tractors, ['driverName', 'driverNameRu', 'driverNameLat', 'carNumber', 'passportNumber', 'personalId', 'birthDate', 'driverPhone']);
  scanBranch('baza', baza, ['driverName', 'driverRaw', 'driverShortNameRu', 'carNumber', 'status']);
  scanBranch('salaryHistory', [...salary.records.values()].map((r) => ({ id: r.id, rec: r.rec })), ['driver', 'car', 'datetime', 'logist']);
  scanBranch('ferryCouples', ferries, ['driver1', 'driver2', 'stateNumber']);
  scanBranch('driverTasks', tasks, ['driverName', 'carNumber']);
  report.named_cases = namedCases.map((c) => ({ title: c.title, hits: c.out }));
  if (!ONLY_JSON) {
    console.log('\n=== ИМЕНОВАННЫЕ ЗАПИСИ ===');
    for (const c of namedCases) {
      console.log(`\n  --- ${c.title} (${c.out.length} ссылок) ---`);
      for (const h of c.out) {
        const f = Object.entries(h.fields).filter(([k]) => k !== '_driverId').map(([k, v]) => `${k}=«${v}»`).join('  ');
        console.log(`   ${h.path}  [driverId=${h.fields._driverId || '—'}]`);
        if (f) console.log(`     ${f}`);
      }
    }
  }

  // ---------- 9. кандидаты на заполнение пропусков из карточек авто ----------
  interface FillCandidate {
    driverId: string;
    driverName: string;
    field: string;
    value: string;
    source: string;
  }
  interface FillConflict {
    driverId: string;
    field: string;
    registryValue: string;
    source: string;
    sourceValue: string;
  }
  const fillCandidates: FillCandidate[] = [];
  const fillConflicts: FillConflict[] = [];
  const skippedSources: Array<{ driverId: string; tractor: string; reason: string }> = [];
  const dst = drivers.filter((d) => !/^без\b/i.test(s(d.rec.name)));
  for (const d of dst) {
    const sources = tractors.filter((t) => s(t.rec.driverId) === d.id);
    if (!sources.length) continue;
    const canonical = canonicalName(d.rec);
    const clean = sources.filter((t) => {
      const verdicts = [s(t.rec.driverNameRu), s(t.rec.driverName)].filter(Boolean).map((n) => compareNames(n, canonical));
      const bad = verdicts.includes('conflict');
      if (bad) skippedSources.push({ driverId: d.id, tractor: t.id, reason: 'ФИО в карточке конфликтует с реестром' });
      return !bad;
    });
    if (!clean.length) continue;
    const pick = (f: string) => clean.map((t) => s(t.rec[f])).filter(Boolean);
    const pickUniq = (f: string) => [...new Set(pick(f))];
    const fill = (field: string, values: string[], source: string) => {
      if (!values.length) return;
      if (s(d.rec[field])) {
        if (!values.some((v) => norm(v) === norm(s(d.rec[field])))) {
          fillConflicts.push({ driverId: d.id, field, registryValue: s(d.rec[field]), source, sourceValue: values.join(' | ') });
        }
        return;
      }
      fillCandidates.push({ driverId: d.id, driverName: canonical, field, value: values.join(' | '), source });
    };
    fill('passport', pickUniq('passportNumber'), 'passportNumber');
    fill('passportStart', pickUniq('passportStart'), 'passportStart');
    fill('passportEnd', pickUniq('passportEnd'), 'passportEnd');
    fill('passportIssued', pickUniq('passportIssuedBy'), 'passportIssuedBy');
    fill('personalId', pickUniq('personalId'), 'personalId');
    fill('nameLat', pickUniq('driverNameLat'), 'driverNameLat');
    fill('licenseNumber', pickUniq('licenseNumber'), 'licenseNumber');
    // дата рождения — с проверкой правдоподобия (16..90 лет)
    const births = pickUniq('birthDate').filter((v) => {
      const m = v.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (!m) return false;
      const year = Number(m[3]);
      const age = new Date().getFullYear() - year;
      return age >= 16 && age <= 90;
    });
    fill('birthDate', births, 'birthDate');
    // телефоны: объединить телефоны карточки, если в реестре ни одного
    if (!arr(d.rec.phones).length && !s(d.rec.phone)) {
      const tPhones = clean.flatMap((t) => phonesOf(t.rec, { singleFields: ['driverPhone', 'phone'] }).map((p) => ({ v: p.value, f: p.field })));
      const uniq = [...new Map(tPhones.map((p) => [phoneKey(p.v) || p.v, p])).values()];
      for (const p of uniq) fillCandidates.push({ driverId: d.id, driverName: canonical, field: 'phones[]', value: p.v, source: `cards (${uniq.map((x) => x.f).join(', ')})` });
      const primary = tPhones.find((p) => p.f === 'phones[0]')?.v || tPhones[0]?.v;
      if (primary) fillCandidates.push({ driverId: d.id, driverName: canonical, field: 'phone', value: primary, source: 'cards' });
    }
  }
  report.fill_candidates = fillCandidates;
  report.fill_conflicts = fillConflicts;
  report.fill_skipped_sources = skippedSources;

  // ---------- 9b. обратное заполнение: пустые кэш-поля карточек/учёта ← реестр ----------
  interface ReverseFill {
    branch: string;
    id: string;
    driverId: string;
    field: string;
    value: string;
  }
  const reverseFills: ReverseFill[] = [];
  const checkReverse = (branch: string, list: Row[], fields: string[]) => {
    for (const r of list) {
      const dId = s(r.rec.driverId);
      const d = dId ? driverById.get(dId) : undefined;
      if (!d) continue;
      const canonical = canonicalName(d.rec);
      if (!canonical) continue;
      const filled = fields.map((f) => s(r.rec[f])).filter(Boolean);
      const conflict = filled.some((v) => compareNames(v, canonical) === 'conflict');
      for (const f of fields) {
        const cur = s(r.rec[f]);
        if (cur || conflict) continue;
        reverseFills.push({ branch, id: r.id, driverId: dId, field: f, value: canonical });
      }
    }
  };
  checkReverse('tractors', tractors, ['driverName', 'driverNameRu']);
  checkReverse('couplings', couplings, ['driverName', 'driverNameRu']);
  checkReverse('baza', baza, ['driverName', 'driverShortNameRu']);
  report.reverse_fill_candidates = reverseFills;

  if (!ONLY_JSON) {
    console.log('\n=== КАНДИДАТЫ НА ЗАПОЛНЕНИЕ ПРОПУСКОВ РЕЕСТРА (из карточек авто) ===');
    if (!fillCandidates.length) console.log('  нет');
    for (const c of fillCandidates) console.log(`  + ${c.driverName} (${c.driverId}): ${c.field} = «${c.value}»  ← ${c.source}`);
    console.log('  КОНФЛИКТЫ (в реестре уже есть другое значение — не трогаем):');
    if (!fillConflicts.length) console.log('    нет');
    for (const c of fillConflicts) console.log(`    ! ${c.driverId}: ${c.field} реестр «${c.registryValue}» ↔ карточка «${c.sourceValue}»`);
    if (skippedSources.length) {
      console.log('  ПРОПУЩЕННЫЕ ИСТОЧНИКИ (ФИО карточки конфликтует с реестром):');
      for (const x of skippedSources) console.log(`    ! tractors/${x.tractor} (${x.driverId}): ${x.reason}`);
    }
    console.log('  ОБРАТНОЕ ЗАПОЛНЕНИЕ (пустые кэш-поля карточек/учёта ← реестр):');
    if (!reverseFills.length) console.log('    нет');
    for (const c of reverseFills) console.log(`    + ${c.branch}/${c.id} (${c.driverId}): ${c.field} = «${c.value}»`);
  }

  // ---------- запись отчёта ----------
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(OUT_DIR, `audit-fleet-drivers-${stamp}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(OUT_DIR, 'audit-fleet-drivers.latest.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nОтчёт: ${path}`);
}

main().catch((e) => {
  console.error('Сбой аудита:', e);
  process.exitCode = 1;
});
