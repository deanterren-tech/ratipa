/**
 * Повторяемая миграция данных водителей Ratipa Portal.
 *
 * ЧТО ДЕЛАЕТ (только однозначные случаи, проверенные аудитом:
 * scripts/audit-fleet-drivers.ts):
 *   A. Заполняет ПРОПУСКИ в реестре `drivers` из карточки собственного авто
 *      («Автопарк и Водители» = tractors со стабильным driverId): паспорт,
 *      личный №, телефоны, латинское ФИО, дата рождения (с проверкой правдоподобия).
 *      Источник должен быть единственным и не конфликтовать по ФИО с реестром.
 *   B. Дописывает пустые кэш-поля имени в карточках/сцепках (driverNameRu и т.п.)
 *      значением из реестра — реестр является источником истины.
 *   C. Освежает устаревшие сокращённые кэш-имена в `baza` (например «Шерамет С.»
 *      → «Шерамет Сергей Николаевич») ТОЛЬКО когда driverId указывает на того же
 *      человека; исходный текст сохраняется в driverRaw (история не переписывается).
 *   D. Слияние подтверждённых дублей водителей (перенос связей на основной id,
 *      пометка mergedFrom/mergedInto) — выполняется только если дубль доказан
 *      совпадением ДВУХ стабильных признаков (паспорт+личный №) и связями.
 *      По результатам аудита 15.10.2026 таких дублей НЕТ (см. отчёт).
 *
 * ЧЕГО НЕ ДЕЛАЕТ (неоднозначные случаи выводятся списком, но не меняются):
 *   · записи-заглушки «Шерамет», «Калинин» без стабильных признаков;
 *   · служебная запись «без В.» и назначения на неё;
 *   · конфликты «Чернявский ↔ реестр Бархатов» (один id — два человека);
 *   · карточка AP96977 (следы Пешко при driverId «без В.»);
 *   · висячие исторические driverId в salaryHistory и baza;
 *   · salaryHistory, ferryCouples, routedesk, documents, vehicleFleet — не трогаются.
 *
 * БЕЗОПАСНОСТЬ:
 *   · По умолчанию — только отчёт (ничего не пишется).
 *   · Запись — строго `--apply --yes`; перед записью каждая затрагиваемая запись
 *     целиком сохраняется в ~/.hermes/cache/scratch/fleet-data/backups/<stamp>/.
 *   · Перед записью все целевые значения заново сверяются с базой (гонки/правки
 *     из UI не затираются: изменившееся значение пропускается с предупреждением).
 *   · Повторяемость: условия пересчитываются из текущих данных; после применения
 *     повторный запуск не находит изменений (план пуст), дубли не создаются.
 *
 * ЗАПУСК:
 *   npx tsx scripts/migrate-fleet-drivers.ts                 # отчёт (dry-run)
 *   npx tsx scripts/migrate-fleet-drivers.ts --apply --yes   # применить (с бэкапом)
 *   npx tsx scripts/migrate-fleet-drivers.ts --json          # только машинный отчёт
 */

import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
const BASE_DIR = join(homedir(), '.hermes', 'cache', 'scratch', 'fleet-data');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

async function fetchAll(path: string): Promise<unknown> {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json();
}

// ---------- нормализация (та же логика, что в аудите) ----------
const norm = (x: string): string => x.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
const nameParts = (x: string): string[] => norm(x).split(' ').filter(Boolean);
function partCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  if (a.length >= 2 && b.length >= 2 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}
type NameVerdict = 'same' | 'compatible' | 'conflict' | 'one-empty';
function compareNames(a: string, b: string): NameVerdict {
  const A = nameParts(a);
  const B = nameParts(b);
  if (!A.length || !B.length) return 'one-empty';
  if (A.join(' ') === B.join(' ')) return 'same';
  if (!partCompatible(A[0], B[0])) return 'conflict';
  const firstOk = partCompatible(A[1] || '', B[1] || '');
  const middleOk = partCompatible(A[2] || '', B[2] || '');
  const firstMissing = !A[1] || !B[1];
  if (firstMissing && (!A[2] || !B[2] || middleOk)) return 'compatible';
  if (firstOk && (middleOk || !A[2] || !B[2])) return 'compatible';
  return 'conflict';
}
function phoneKey(x: string): string | null {
  const d = x.replace(/\D/g, '');
  if (d.length < 7) return null;
  return d.slice(-9);
}
/** Телефоны записи: массив phones[] + одиночные поля (phone / driverPhone). */
function phonesOf(rec: Obj, singleFields: string[]): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [];
  const seen = new Set<string>();
  arr(rec.phones).forEach((p, i) => {
    const n = s(asObj(p).number) || s(p);
    if (n) {
      out.push({ field: `phones[${i}]`, value: n });
      seen.add(n);
    }
  });
  for (const f of singleFields) {
    const n = s(rec[f]);
    if (n && !seen.has(n)) out.push({ field: f, value: n });
  }
  return out;
}
const canonicalName = (rec: Obj): string => s(rec.shortNameRu) || s(rec.name);
const isPlaceholder = (rec: Obj): boolean => /^без\b/i.test(s(rec.name)) || /^без\b/i.test(s(rec.lastNameRu));

// ---------- план ----------
interface PlanItem {
  op: 'fill-driver' | 'fill-card' | 'refresh-baza' | 'merge';
  record: string; // корневой путь записи (для бэкапа), напр. drivers/SHARAMETSIARHEI
  path: string; // листовой путь записи значения
  before: string; // ожидаемое текущее значение ('' = пусто/нет)
  after: string; // JSON-значение (строка или массив)
  note: string;
}

interface RefRow {
  id: string;
  rec: Obj;
}
const rows = (branch: unknown): RefRow[] => Object.entries(asObj(branch)).map(([k, v]) => ({ id: k, rec: asObj(v) }));

/** Проверка даты рождения: формат ДД.ММ.ГГГГ и возраст 16..90. */
function birthPlausible(v: string): boolean {
  const m = v.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return false;
  const year = Number(m[3]);
  const age = new Date().getFullYear() - year;
  return age >= 16 && age <= 90;
}

async function main() {
  if (!ONLY_JSON) console.log(`Режим: ${APPLY ? (YES ? 'ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ' : '--apply без --yes — запись запрещена') : 'предварительный отчёт (без записи)'}\nБаза: ${DB}\n`);

  const [driversRaw, tractorsRaw, couplingsRaw, bazaRaw, usersRaw, salaryRaw, tasksRaw] = await Promise.all([
    fetchAll('drivers'),
    fetchAll('tractors'),
    fetchAll('couplings'),
    fetchAll('baza'),
    fetchAll('users_list'),
    fetchAll('salaryHistory'),
    fetchAll('driverTasks'),
  ]);
  const drivers = rows(driversRaw);
  const tractors = rows(tractorsRaw);
  const couplings = rows(couplingsRaw);
  const baza = rows(bazaRaw);
  const users = rows(usersRaw);
  const driverById = new Map(drivers.map((d) => [d.id, d.rec]));
  const dispatcherIds = new Set(users.filter((u) => u.rec.isDispatcher === true).map((u) => u.id));

  if (!ONLY_JSON) {
    console.log(`Источники: drivers ${drivers.length}, tractors ${tractors.length}, couplings ${couplings.length}, baza ${baza.length}, users ${users.length}\n`);
  }

  const plan: PlanItem[] = [];
  const ambiguous: string[] = [];
  const conflicts: string[] = [];

  // ============ A. заполнение пропусков реестра из карточки собственного авто ============
  const FIELD_MAP: Array<{ driverField: string; cardField: string; label: string; guard?: (v: string) => boolean }> = [
    { driverField: 'passport', cardField: 'passportNumber', label: 'паспорт' },
    { driverField: 'passportStart', cardField: 'passportStart', label: 'паспорт выдан (дата)' },
    { driverField: 'passportEnd', cardField: 'passportEnd', label: 'паспорт действителен до' },
    { driverField: 'passportIssued', cardField: 'passportIssuedBy', label: 'паспорт выдан (орган)' },
    { driverField: 'personalId', cardField: 'personalId', label: 'личный №' },
    { driverField: 'nameLat', cardField: 'driverNameLat', label: 'латинское ФИО' },
    { driverField: 'licenseNumber', cardField: 'licenseNumber', label: 'вод. удостоверение' },
    { driverField: 'birthDate', cardField: 'birthDate', label: 'дата рождения', guard: birthPlausible },
  ];

  for (const d of drivers) {
    if (isPlaceholder(d.rec)) continue;
    const canonical = canonicalName(d.rec);
    if (!canonical) continue;
    const cards = tractors.filter((t) => s(t.rec.driverId) === d.id);
    if (!cards.length) continue;
    // Источник должен быть единственным и не конфликтовать по ФИО
    const clean = cards.filter((t) => {
      const verdicts = [s(t.rec.driverNameRu), s(t.rec.driverName)].filter(Boolean).map((n) => compareNames(n, canonical));
      return !verdicts.includes('conflict');
    });
    if (!clean.length) {
      ambiguous.push(`drivers/${d.id}: карточка(и) ${cards.map((t) => t.id).join(', ')} содержат ФИО, конфликтующее с реестром — пропущено`);
      continue;
    }
    for (const fm of FIELD_MAP) {
      const values = [...new Set(clean.map((t) => s(t.rec[fm.cardField])).filter(Boolean).filter((v) => !fm.guard || fm.guard(v)))];
      const source = clean.map((t) => t.id).join(', ');
      if (!values.length) continue;
      const cur = s(d.rec[fm.driverField]);
      if (cur) {
        if (!values.some((v) => norm(v) === norm(cur))) {
          conflicts.push(`drivers/${d.id}: ${fm.driverField} в реестре «${cur}» ↔ карточка ${source} «${values.join(' | ')}» — НЕ изменяется`);
        }
        continue;
      }
      if (values.length > 1) {
        conflicts.push(`drivers/${d.id}: ${fm.driverField}: карточки дают разные значения (${values.join(' | ')}) — НЕ изменяется`);
        continue;
      }
      plan.push({
        op: 'fill-driver',
        record: `drivers/${d.id}`,
        path: `drivers/${d.id}/${fm.driverField}`,
        before: '',
        after: JSON.stringify(values[0]),
        note: `${fm.label} из карточки ${source}`,
      });
    }
    // телефоны: только если в реестре ни одного
    if (!arr(d.rec.phones).length && !s(d.rec.phone)) {
      const all = clean.flatMap((t) => phonesOf(t.rec, ['driverPhone', 'phone']));
      const uniq = [...new Map(all.map((p) => [phoneKey(p.value) || p.value, p])).values()];
      if (uniq.length) {
        const phonesArr = uniq.map((p, i) => ({ id: i === 0 ? 'phone_1' : `phone_mig_${i + 1}`, isPrimary: i === 0, number: p.value }));
        plan.push({
          op: 'fill-driver',
          record: `drivers/${d.id}`,
          path: `drivers/${d.id}/phones`,
          before: '',
          after: JSON.stringify(phonesArr),
          note: `телефоны из карточки ${clean.map((t) => t.id).join(', ')}`,
        });
        plan.push({
          op: 'fill-driver',
          record: `drivers/${d.id}`,
          path: `drivers/${d.id}/phone`,
          before: '',
          after: JSON.stringify(phonesArr[0].number),
          note: `основной телефон из карточки ${clean.map((t) => t.id).join(', ')}`,
        });
      }
    }
  }

  // ============ B. пустые кэш-поля имени карточек/сцепок ← реестр ============
  const fillCardName = (branch: string, list: RefRow[], fields: string[]) => {
    for (const r of list) {
      const dId = s(r.rec.driverId);
      const d = dId ? driverById.get(dId) : undefined;
      if (!d) continue;
      const canonical = canonicalName(d);
      if (!canonical) continue;
      const filled = fields.map((f) => s(r.rec[f])).filter(Boolean);
      if (filled.some((v) => compareNames(v, canonical) === 'conflict')) continue;
      for (const f of fields) {
        if (s(r.rec[f])) continue;
        plan.push({
          op: 'fill-card',
          record: `${branch}/${r.id}`,
          path: `${branch}/${r.id}/${f}`,
          before: '',
          after: JSON.stringify(canonical),
          note: `пустое имя в ${branch}; водитель ${dId} в реестре`,
        });
      }
    }
  };
  fillCardName('tractors', tractors, ['driverName', 'driverNameRu']);
  fillCardName('couplings', couplings, ['driverName', 'driverNameRu']);

  // ============ C. устаревшие сокращённые кэш-имена в baza ============
  for (const b of baza) {
    const dId = s(b.rec.driverId);
    const d = dId ? driverById.get(dId) : undefined;
    if (!d) continue;
    const canonical = canonicalName(d);
    if (!canonical) continue;
    const vals = [s(b.rec.driverName), s(b.rec.driverShortNameRu)].filter(Boolean);
    if (vals.some((v) => compareNames(v, canonical) === 'conflict')) continue;
    for (const f of ['driverName', 'driverShortNameRu']) {
      const cur = s(b.rec[f]);
      if (!cur) {
        plan.push({
          op: 'refresh-baza',
          record: `baza/${b.id}`,
          path: `baza/${b.id}/${f}`,
          before: '',
          after: JSON.stringify(canonical),
          note: `пустое имя в baza (водитель ${dId}); driverRaw сохраняется`,
        });
        continue;
      }
      const verdict = compareNames(cur, canonical);
      if (verdict === 'compatible') {
        plan.push({
          op: 'refresh-baza',
          record: `baza/${b.id}`,
          path: `baza/${b.id}/${f}`,
          before: cur,
          after: JSON.stringify(canonical),
          note: 'сокращённая форма приведена к реестру; driverRaw не трогается',
        });
      }
    }
  }

  // ============ D. подтверждённые дубли (два стабильных признака) ============
  // Критерий: совпадают паспорт И личный № (оба непустые). Совпадение только
  // фамилии/телефона доказательством НЕ считается (правило владельца).
  interface MergeCandidate {
    winner: string;
    loser: string;
    refs: Array<{ branch: string; id: string; field: string }>;
  }
  const mergeCandidates: MergeCandidate[] = [];
  for (let i = 0; i < drivers.length; i++) {
    for (let j = i + 1; j < drivers.length; j++) {
      const a = drivers[i];
      const b = drivers[j];
      const ap = norm(s(a.rec.passport));
      const bp = norm(s(b.rec.passport));
      const ai = norm(s(a.rec.personalId));
      const bi = norm(s(b.rec.personalId));
      if (!ap || ap !== bp || !ai || ai !== bi) continue;
      // оба признака совпали — ищем ссылки на «слабый» id (например, без карточек)
      const refsOf = (id: string) => {
        const out: Array<{ branch: string; id: string; field: string }> = [];
        for (const c of couplings) if (s(c.rec.driverId) === id) out.push({ branch: 'couplings', id: c.id, field: 'driverId' });
        for (const t of tractors) if (s(t.rec.driverId) === id) out.push({ branch: 'tractors', id: t.id, field: 'driverId' });
        for (const bb of baza) if (s(bb.rec.driverId) === id) out.push({ branch: 'baza', id: bb.id, field: 'driverId' });
        return out;
      };
      const aRefs = refsOf(a.id);
      const bRefs = refsOf(b.id);
      const winner = aRefs.length >= bRefs.length ? a : b;
      const loser = winner === a ? b : a;
      mergeCandidates.push({ winner: winner.id, loser: loser.id, refs: refsOf(loser.id) });
    }
  }
  for (const m of mergeCandidates) {
    for (const ref of m.refs) {
      plan.push({
        op: 'merge',
        record: `${ref.branch}/${ref.id}`,
        path: `${ref.branch}/${ref.id}/${ref.field}`,
        before: m.loser,
        after: JSON.stringify(m.winner),
        note: `перенос связи дубля ${m.loser} → ${m.winner}`,
      });
    }
    plan.push({
      op: 'merge',
      record: `drivers/${m.winner}`,
      path: `drivers/${m.winner}/mergedFrom`,
      before: '',
      after: JSON.stringify(m.loser),
      note: 'след происхождения дубля',
    });
    plan.push({
      op: 'merge',
      record: `drivers/${m.loser}`,
      path: `drivers/${m.loser}/mergedInto`,
      before: '',
      after: JSON.stringify(m.winner),
      note: 'дубль помечен; запись не удаляется',
    });
  }

  // ============ НЕОДНОЗНАЧНЫЕ СЛУЧАИ (в план не входят) ============
  const consumerCounts = (id: string) => {
    let couplingsN = 0;
    let tractorsN = 0;
    let bazaN = 0;
    let salaryN = 0;
    for (const c of couplings) if (s(c.rec.driverId) === id) couplingsN++;
    for (const t of tractors) if (s(t.rec.driverId) === id) tractorsN++;
    for (const b of baza) if (s(b.rec.driverId) === id) bazaN++;
    const seen = new Set<string>();
    const root = asObj(salaryRaw);
    for (const [k, v] of Object.entries(root)) {
      if (k === 'flat' || k === 'months' || k === 'byDispatcher') continue;
      if (s(asObj(v).driverId) === id) { seen.add(k); salaryN++; }
    }
    for (const [k, v] of Object.entries(asObj(root.flat))) {
      if (s(asObj(v).driverId) === id && !seen.has(k)) { seen.add(k); salaryN++; }
    }
    return `сцепки:${couplingsN} карточки:${tractorsN} учёт:${bazaN} зарплаты:${salaryN}`;
  };
  for (const stubId of ['dr_1791975260584', 'dr_1791975506622']) {
    const d = driverById.get(stubId);
    if (d) ambiguous.push(`drivers/${stubId} «${s(d.name)}» — запись без стабильных признаков, ссылок нет (${consumerCounts(stubId)}); решение о слиянии/удалении принимает владелец`);
  }
  if (driverById.get('dr_1787831393161')) {
    ambiguous.push(`drivers/dr_1787831393161 «без В.» — служебная запись-заполнитель вместо «нет водителя»; назначения: ${consumerCounts('dr_1787831393161')}; перевод в «без водителя» требует отдельного подтверждения`);
  }
  const bazaById = new Map(baza.map((b) => [b.id, b.rec]));
  for (const [id, refId, name] of [
    ['-P-Nl7k_1oRNqpRmokNG', 'dr_1787121930284', 'Калинин'],
    ['-Oycbno-gvZqwA0iKh1q', 'CHARNIAUSKIULADZISLAU', 'Чернявский В.Н.'],
  ] as Array<[string, string, string]>) {
    const rec = bazaById.get(id);
    if (!rec) continue;
    const exists = driverById.has(refId);
    ambiguous.push(`baza/${id} (${name}) — driverId ${refId}: ${exists ? 'имя расходится с реестром (под одним id два человека) — конфликт, ждёт решения' : 'водитель отсутствует в реестре (старый id), ждёт решения'}`);
  }
  // потребители старых id (контроль перед будущими слияниями)
  const dangCouplings = new Set<string>();
  const dangTractors = new Set<string>();
  const dangBaza = new Set<string>();
  for (const c of couplings) {
    const dId = s(c.rec.driverId);
    if (dId && !driverById.has(dId)) dangCouplings.add(dId);
  }
  for (const t of tractors) {
    const dId = s(t.rec.driverId);
    if (dId && !driverById.has(dId)) dangTractors.add(dId);
  }
  for (const bb of baza) {
    const dId = s(bb.rec.driverId);
    if (dId && !driverById.has(dId)) dangBaza.add(dId);
  }
  if (dangCouplings.size || dangTractors.size || dangBaza.size) {
    ambiguous.push(`Висячие driverId: сцепки [${[...dangCouplings].join(', ') || '—'}]; карточки [${[...dangTractors].join(', ') || '—'}]; учёт [${[...dangBaza].join(', ')}]`);
  }
  const salaryDangling = new Set<string>();
  const salaryRecs: Obj[] = [];
  for (const [k, v] of Object.entries(asObj(salaryRaw))) {
    if (k === 'flat' || k === 'months' || k === 'byDispatcher') continue;
    salaryRecs.push(asObj(v));
  }
  for (const v of Object.values(asObj(asObj(salaryRaw).flat))) salaryRecs.push(asObj(v));
  for (const rec of salaryRecs) {
    const dId = s(rec.driverId);
    if (dId && !driverById.has(dId) && ('driver' in rec || 'driverId' in rec)) salaryDangling.add(dId);
  }
  if (salaryDangling.size) ambiguous.push(`Исторические driverId в salaryHistory (${salaryDangling.size} шт., например ${[...salaryDangling].slice(0, 5).join(', ')}) — история не переписывается`);
  // user-list sanity: назначенные диспетчеры существуют
  for (const t of tractors) {
    const dId = s(t.rec.dispatcherId);
    if (dId && !dispatcherIds.has(dId)) conflicts.push(`tractors/${t.id}: dispatcherId ${dId} не найден среди диспетчеров users_list`);
  }

  // ============ ВЫВОД ПЛАНА ============
  const byOp = (op: PlanItem['op']) => plan.filter((p) => p.op === op);
  if (!ONLY_JSON) {
    console.log('=== ПЛАН (однозначные изменения) ===');
    const labels: Record<PlanItem['op'], string> = {
      'fill-driver': 'A. Заполнить пропуски в реестре водителей',
      'fill-card': 'B. Дописать пустые кэш-имена карточек/сцепок',
      'refresh-baza': 'C. Привести сокращённые имена в «Учёте выезда» к реестру',
      merge: 'D. Слияние подтверждённых дублей',
    };
    for (const op of ['fill-driver', 'fill-card', 'refresh-baza', 'merge'] as PlanItem['op'][]) {
      const items = byOp(op);
      console.log(`\n${labels[op]}: ${items.length}`);
      for (const it of items) console.log(`  ${it.path}  ${it.before ? `«${it.before}» → ` : ''}${it.after}  (${it.note})`);
    }
    console.log(`\nИТОГО к записи: ${plan.length} значений в ${new Set(plan.map((p) => p.record)).size} записях`);
    console.log(`\n=== НЕОДНОЗНАЧНЫЕ СЛУЧАИ (НЕ меняются, ждут решения) ===`);
    for (const a of ambiguous) console.log(`  · ${a}`);
    if (conflicts.length) {
      console.log(`\n=== КОНФЛИКТЫ (данные противоречат, НЕ изменяются) ===`);
      for (const c of conflicts) console.log(`  ! ${c}`);
    }
  }

  // ============ ЗАПИСЬ ОТЧЁТА ============
  mkdirSync(BASE_DIR, { recursive: true });
  const planReport = {
    when: new Date().toISOString(),
    db: DB,
    mode: APPLY && YES ? 'apply' : 'dry-run',
    totals: { items: plan.length, records: new Set(plan.map((p) => p.record)).size, byOp: { fillDriver: byOp('fill-driver').length, fillCard: byOp('fill-card').length, refreshBaza: byOp('refresh-baza').length, merge: byOp('merge').length } },
    plan,
    ambiguous,
    conflicts,
    mergeCandidates,
  };
  const planPath = join(BASE_DIR, `migration-plan-${STAMP}.json`);
  writeFileSync(planPath, JSON.stringify(planReport, null, 2), 'utf8');
  writeFileSync(join(BASE_DIR, 'migration-plan.latest.json'), JSON.stringify(planReport, null, 2), 'utf8');
  if (!ONLY_JSON) console.log(`\nОтчёт-план: ${planPath}`);

  if (!APPLY) {
    if (!ONLY_JSON) console.log('Изменений не внесено. Для применения (после одобрения): npx tsx scripts/migrate-fleet-drivers.ts --apply --yes');
    return;
  }
  if (!YES) {
    console.error('\nОТКАЗ: для реальной записи нужен явный флаг --yes.');
    process.exitCode = 2;
    return;
  }
  if (!plan.length) {
    if (!ONLY_JSON) console.log('\nПлан пуст (всё уже применено) — повторный запуск ничего не меняет. ✓');
    return;
  }

  // ============ ПРИМЕНЕНИЕ ============
  // 1. Свежая сверка «до» (защита от правок из UI между расчётом и записью)
  const recordsToTouch = [...new Set(plan.map((p) => p.record))];
  const fresh = new Map<string, Obj>();
  for (const rec of recordsToTouch) {
    fresh.set(rec, asObj(await fetchAll(rec)));
  }
  const skipped: PlanItem[] = [];
  const updates: Record<string, unknown> = {};
  for (const it of plan) {
    const tree = fresh.get(it.record);
    if (!tree) {
      skipped.push(it);
      continue;
    }
    const leafParts = it.path.split('/').slice(2); // убираем branch/id
    let cur: unknown = tree;
    for (const part of leafParts) cur = asObj(cur)[part];
    const curStr = typeof cur === 'string' ? cur.trim() : '';
    if (curStr !== it.before) {
      skipped.push(it);
      continue;
    }
    updates[it.path] = JSON.parse(it.after);
  }
  if (skipped.length && !ONLY_JSON) {
    console.log(`\nПропущено (значение изменилось после расчёта плана): ${skipped.length}`);
    for (const it of skipped) console.log(`  ~ ${it.path} (ожидали «${it.before}»)`);
  }

  // 2. Полный бэкап всех затрагиваемых записей
  const backupDir = join(BASE_DIR, 'backups', STAMP);
  mkdirSync(backupDir, { recursive: true });
  const manifest: Record<string, unknown> = {};
  for (const [rec, tree] of fresh) {
    const file = rec.replace(/\//g, '__') + '.json';
    writeFileSync(join(backupDir, file), JSON.stringify(tree, null, 2), 'utf8');
    manifest[rec] = file;
  }
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({ when: new Date().toISOString(), db: DB, plan: planReport.plan, files: manifest }, null, 2), 'utf8');
  if (!ONLY_JSON) console.log(`Резервная копия: ${backupDir} (${Object.keys(manifest).length} записей полностью)`);

  if (!Object.keys(updates).length) {
    if (!ONLY_JSON) console.log('После сверки не осталось изменений — запись не требуется. ✓');
    return;
  }

  // 3. Одна multi-path запись (каждый путь — лист; вложенные поля не теряются)
  const res = await fetch(`${DB}/.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.error(`ОШИБКА записи: HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }
  if (!ONLY_JSON) console.log(`Записано путей: ${Object.keys(updates).length}`);

  // 4. Проверка чтением
  /** Семантическое сравнение (порядок ключей объектов не важен). */
  const deepEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a as Obj).sort();
      const kb = Object.keys(b as Obj).sort();
      if (ka.join(',') !== kb.join(',')) return false;
      return ka.every((k) => deepEqual((a as Obj)[k], (b as Obj)[k]));
    }
    return false;
  };
  const verifyFail: string[] = [];
  const verifyRecs = [...new Set(plan.filter((p) => updates[p.path] !== undefined).map((p) => p.record))];
  for (const rec of verifyRecs) {
    const tree = asObj(await fetchAll(rec));
    for (const it of plan.filter((p) => p.record === rec && updates[p.path] !== undefined)) {
      const leafParts = it.path.split('/').slice(2);
      let cur: unknown = tree;
      for (const part of leafParts) cur = asObj(cur)[part];
      const want = JSON.parse(it.after) as unknown;
      if (!deepEqual(cur, want)) verifyFail.push(`${it.path}: ожидали ${it.after}, получили ${JSON.stringify(cur)}`);
    }
  }
  if (verifyFail.length) {
    console.error('ПРОВЕРКА НЕ ПРОШЛА:');
    for (const v of verifyFail) console.error(`  ! ${v}`);
    process.exitCode = 1;
  } else if (!ONLY_JSON) {
    console.log(`Проверка чтением: все ${Object.keys(updates).length} значений на месте ✓`);
    console.log('Повторный запуск не создаст дублей: условия пересчитываются из текущих данных.');
  }
}

main().catch((e) => {
  console.error('Сбой миграции:', e);
  process.exitCode = 1;
});
