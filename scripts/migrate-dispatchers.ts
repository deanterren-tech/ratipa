/**
 * Миграция: связать записи диспетчеров с учётными записями портала.
 *
 * Что делает
 *  - Собирает учётные записи из `users_list` (имя и фамилия — из профиля).
 *  - Находит во всех разделах записи, где указан диспетчер (`dispatcher`,
 *    `dispatcherName`, `logist`), включая архивные и вложенные структуры.
 *  - Сопоставляет текстовое имя со СТАБИЛЬНЫМ идентификатором пользователя
 *    и записывает его в парное поле `<поле>Id` (`dispatcherId`, `logistId`).
 *    Текстовые поля не переписываются: на них построены сравнения в разделах,
 *    поэтому миграция безопасна и обратима.
 *  - Там, где в записи уже есть поле отображаемого имени (`dispatcherName`),
 *    подставляет имя и фамилию из учётной записи.
 *
 * Правила безопасности
 *  - По умолчанию — режим предварительной проверки (`--dry-run`): ничего не
 *    меняется, печатается отчёт и сохраняется файл отчёта.
 *  - Изменения только по `--apply`, перед ними пишется резервная копия всех
 *    затронутых путей со старыми значениями.
 *  - Идемпотентно: повторный запуск после применения ничего не меняет.
 *  - Если имени соответствует несколько учётных записей или ни одной —
 *    запись НЕ меняется и попадает в список на ручную проверку.
 *  - Служебные значения («Общая», «Все диспетчеры», «Бот») и записи без
 *    диспетчера пропускаются. Индекс `salaryHistory/byDispatcher/**`
 *    не трогается: его ключи — это имена, а не записи.
 *
 * Запуск
 *   npx tsx scripts/migrate-dispatchers.ts            # проверка (dry-run)
 *   npx tsx scripts/migrate-dispatchers.ts --apply    # применить изменения
 *   npx tsx scripts/migrate-dispatchers.ts --json     # только машинный отчёт
 */

import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const ONLY_JSON = ARGS.includes('--json');
/** Префикс для репетиции: `--prefix=__rehearsal` читает и пишет копию разделов. */
const PREFIX = (ARGS.find((a) => a.startsWith('--prefix=')) || '').split('=')[1] || '';
const ns = (path: string) => (PREFIX ? `${PREFIX}_${path}` : path);
const OUT_DIR = join(homedir(), 'ratipa-dispatcher-migration');

/** Разделы и поля, в которых встречается диспетчер. */
const TARGETS: Array<{ path: string; fields: string[]; note?: string }> = [
  { path: 'tractors', fields: ['dispatcher', 'dispatcherName'], note: 'тягачи' },
  { path: 'trailers', fields: ['dispatcher', 'dispatcherName'], note: 'прицепы' },
  { path: 'drivers', fields: ['dispatcher', 'dispatcherName'], note: 'данные по водителям' },
  { path: 'couplings', fields: ['dispatcher', 'dispatcherName'], note: 'справочник сцепок' },
  { path: 'ferryCouples', fields: ['dispatcher'], note: 'паромы' },
  { path: 'trips', fields: ['dispatcher', 'logist'], note: 'рейсы' },
  { path: 'trips_dashboard', fields: ['dispatcher', 'logist'], note: 'сводка рейсов' },
  { path: 'tripsdashboard', fields: ['dispatcher', 'logist'], note: 'сводка рейсов (старая)' },
  { path: 'current_trips', fields: ['dispatcher'], note: 'текущие рейсы' },
  { path: 'planDohod', fields: ['dispatcher', 'logist'], note: 'план дохода' },
  { path: 'ratipa_income_plan', fields: ['dispatcher', 'logist'], note: 'план дохода (список)' },
  { path: 'ratipa_loading_plan', fields: ['dispatcher'], note: 'план загрузок' },
  { path: 'calculationsHistory', fields: ['logist'], note: 'история калькуляций' },
  { path: 'salaryHistory', fields: ['logist'], note: 'история зарплат' },
  { path: 'dozvolsHistoryV4', fields: ['logist'], note: 'история дозволов' },
  { path: 'dozvolsHistoryV2', fields: ['logist'], note: 'история дозволов (старая)' },
  { path: 'dozvolsDocumentsHistoryV1', fields: ['logist'], note: 'история документов дозволов' },
  { path: 'ratipa_dozvols_list', fields: ['dispatcher'], note: 'дозволы (список)' },
  { path: 'routedesk', fields: ['dispatcher', 'dispatcherName'], note: 'RouteDesk: задания и рейсы' },
  { path: 'baza', fields: ['dispatcher', 'dispatcherName'], note: 'база машин' },
  { path: 'archive', fields: ['dispatcher', 'dispatcherName', 'logist'], note: 'архив' },
];

/** Служебные значения — это не люди. */
const SPECIAL = new Set(['общая', 'все диспетчеры', 'бот', 'system', 'система', '—', '-', '']);

/** Явные сокращения: применяются только после проверки и печатаются отдельно. */
const ALIASES: Record<string, string> = {
  слава: 'Вячеслав', // «Слава» — сокращение от Вячеслав
  sergei: 'Сергей', // латинская запись того же имени
};

interface Account { uid: string; firstName: string; lastName: string; fullName: string; role?: string }

const normalize = (s: string) =>
  String(s || '')
    .replace(/[A-Za-z]/g, (ch) => {
      const look: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
      return look[ch.toUpperCase()] || ch.toLowerCase();
    })
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Вторая нормализация — без подмены латинских букв похожими кириллическими.
 * Нужна для записей вроде «Sergei»: первая нормализация даёт смешанную строку,
 * а здесь получается «sergei» — её и ищут сокращения и транслитерации.
 */
const normalizeLatin = (s: string) =>
  String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();

const firstWord = (s: string) => normalize(s).split(' ')[0] || '';

/** Все варианты написания одного и того же значения. */
const variants = (s: string) => Array.from(new Set([normalize(s), normalizeLatin(s)]));

async function fetchAll(path: string): Promise<any> {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json();
}

/** Учётные записи: имя и фамилия берутся из отдельных полей, иначе из общего «name». */
function buildAccounts(usersList: any): { accounts: Account[]; byId: Map<string, Account>; byFull: Map<string, Account[]>; byFirst: Map<string, Account[]> } {
  const accounts: Account[] = [];
  for (const [uid, raw] of Object.entries<any>(usersList || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const firstName = String(raw.firstName || parts[0] || '').trim();
    const lastName = String(raw.lastName || (parts.length > 1 ? parts.slice(1).join(' ') : '')).trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (!fullName) continue; // служебная запись без имени
    accounts.push({ uid, firstName, lastName, fullName, role: raw.role });
  }
  const byId = new Map(accounts.map((a) => [a.uid, a]));
  const push = (map: Map<string, Account[]>, key: string, acc: Account) => {
    if (!key) return;
    map.set(key, [...(map.get(key) || []), acc]);
  };
  const byFull = new Map<string, Account[]>();
  const byFirst = new Map<string, Account[]>();
  for (const a of accounts) {
    push(byFull, normalize(a.fullName), a);
    push(byFirst, firstWord(a.firstName), a);
  }
  return { accounts, byId, byFull, byFirst };
}

interface Finding {
  path: string; // полный путь до поля в базе
  collection: string;
  field: string;
  value: string;
  /** Текущие значения полей записи — для идемпотентного сравнения. */
  current?: Record<string, string>;
  action: 'link' | 'already' | 'ambiguous' | 'unmatched' | 'special';
  uid?: string;
  fullName?: string;
  reason?: string;
  newValue?: string;
}

function resolve(value: string, acc: ReturnType<typeof buildAccounts>): { uid?: string; fullName?: string; action: Finding['action']; reason?: string } {
  const raw = String(value || '').trim();
  if (!raw) return { action: 'special', reason: 'пусто' };
  if (SPECIAL.has(raw.toLowerCase())) return { action: 'special', reason: 'служебное значение' };
  if (acc.byId.has(raw)) return { uid: raw, fullName: acc.byId.get(raw)!.fullName, action: 'already' };
  const full = variants(raw).map((v) => acc.byFull.get(v) || []).find((list) => list.length) || [];
  if (full.length === 1) return { uid: full[0].uid, fullName: full[0].fullName, action: 'link' };
  if (full.length > 1) return { action: 'ambiguous', reason: `полное имя подходит ${full.length} учётным записям` };
  const alias = variants(raw).map((v) => ALIASES[v]).find(Boolean);
  const byAliasFirst = alias ? acc.byFirst.get(firstWord(alias)) || [] : [];
  if (byAliasFirst.length === 1) return { uid: byAliasFirst[0].uid, fullName: byAliasFirst[0].fullName, action: 'link', reason: `сокращение «${raw}» → «${alias}»` };
  if (byAliasFirst.length > 1) return { action: 'ambiguous', reason: `сокращение «${raw}» подходит ${byAliasFirst.length} учётным записям` };
  const first = acc.byFirst.get(firstWord(raw)) || [];
  if (first.length === 1) return { uid: first[0].uid, fullName: first[0].fullName, action: 'link' };
  if (first.length > 1) return { action: 'ambiguous', reason: `имя «${raw}» подходит ${first.length} учётным записям: ${first.map((a) => a.fullName).join(', ')}` };
  return { action: 'unmatched', reason: 'подходящая учётная запись не найдена' };
}

/** Обход записи: возвращает пути до полей диспетчера. */
function walk(node: any, path: string, fields: string[], collection: string, out: Array<{ path: string; field: string; value: string; current: Record<string, string> }>, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}/${i}`, fields, collection, out, depth + 1));
    return;
  }
  for (const [key, value] of Object.entries<any>(node)) {
    const childPath = `${path}/${key}`;
    // индекс по именам — не записи, его ключи менять нельзя
    if (childPath.includes('/byDispatcher/')) continue;
    if (fields.includes(key) && typeof value === 'string' && value.trim()) {
      // Текущие значения полей этой же записи: нужны, чтобы второй запуск
      // ничего не менял (сравнение «как должно быть» с «как есть»).
      const current: Record<string, string> = {};
      for (const f of [...fields, 'dispatcher', 'dispatcherName', 'logist']) {
        const v = node[f];
        if (typeof v === 'string') current[f] = v.trim();
        const idv = node[`${f}Id`];
        if (typeof idv === 'string') current[`${f}Id`] = idv.trim();
      }
      out.push({ path: childPath, field: key, value: value.trim(), current });
    }
    if (value && typeof value === 'object') walk(value, childPath, fields, collection, out, depth + 1);
  }
}

async function main() {
  if (!ONLY_JSON) console.log(`Режим: ${APPLY ? 'ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ' : 'предварительная проверка (ничего не меняется)'}\nБаза: ${DB}\n`);

  const usersList = await fetchAll(ns('users_list'));
  const acc = buildAccounts(usersList);
  if (!ONLY_JSON) {
    console.log(`Учётные записи: ${acc.accounts.length}`);
    for (const a of acc.accounts) console.log(`   ${a.uid.padEnd(14)} ${a.fullName}${a.role ? `  (${a.role})` : ''}`);
    console.log('');
  }

  const findings: Finding[] = [];
  const perCollection: Record<string, { link: number; already: number; ambiguous: number; unmatched: number; special: number; total: number }> = {};

  for (const target of TARGETS) {
    let data: any;
    try {
      data = await fetchAll(ns(target.path));
    } catch (e) {
      findings.push({ path: target.path, collection: target.path, field: '-', value: '', action: 'unmatched', reason: `раздел недоступен: ${String(e).slice(0, 80)}` });
      continue;
    }
    if (!data) continue;
    const leaves: Array<{ path: string; field: string; value: string; current: Record<string, string> }> = [];
    walk(data, ns(target.path), target.fields, target.path, leaves);
    const stat = (perCollection[target.path] = { link: 0, already: 0, ambiguous: 0, unmatched: 0, special: 0, total: leaves.length });
    for (const leaf of leaves) {
      const r = resolve(leaf.value, acc);
      // Уже привязано: идентификатор в записи совпадает с найденной учётной записью
      const idField = leaf.field === 'dispatcherName' ? 'dispatcherId' : `${leaf.field}Id`;
      if (r.uid && leaf.current?.[idField] === r.uid) {
        r.action = 'already';
        r.reason = 'уже привязано';
      }
      stat.total += 1;
      if (r.action === 'link') stat.link += 1;
      else if (r.action === 'already') stat.already += 1;
      else if (r.action === 'ambiguous') stat.ambiguous += 1;
      else if (r.action === 'unmatched') stat.unmatched += 1;
      else stat.special += 1;
      findings.push({
        ...leaf,
        collection: target.path,
        action: r.action,
        uid: r.uid,
        fullName: r.fullName,
        reason: r.reason,
        newValue: r.uid,
      });
    }
  }

  // Кто на что сопоставился — сводка по значениям
  const mapping = new Map<string, { uid?: string; fullName?: string; count: number; action: Finding['action']; reason?: string }>();
  for (const f of findings) {
    const key = `${f.field}:${f.value}`;
    const cur = mapping.get(key);
    if (cur) cur.count += 1;
    else mapping.set(key, { uid: f.uid, fullName: f.fullName, count: 1, action: f.action, reason: f.reason });
  }

  const toUpdate = findings.filter((f) => f.action === 'link');
  const ambiguous = findings.filter((f) => f.action === 'ambiguous');
  const unmatched = findings.filter((f) => f.action === 'unmatched');
  const already = findings.filter((f) => f.action === 'already');
  const special = findings.filter((f) => f.action === 'special');

  if (!ONLY_JSON) {
    console.log('=== Найденные соответствия ===');
    for (const [key, m] of [...mapping.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const label = m.action === 'link' ? `→ ${m.fullName} (${m.uid})` : m.action === 'already' ? '→ уже привязано' : m.action === 'special' ? `пропуск: ${m.reason}` : `РУЧНАЯ ПРОВЕРКА: ${m.reason}`;
      console.log(`   ${key.padEnd(46)} записей: ${String(m.count).padStart(5)}  ${label}${m.reason && m.action === 'link' ? `  [${m.reason}]` : ''}`);
    }
    console.log('\n=== По разделам ===');
    for (const [path, s] of Object.entries(perCollection)) {
      console.log(`   ${path.padEnd(28)} всего ${String(s.total).padStart(5)} | привязать ${String(s.link).padStart(5)} | уже привязано ${String(s.already).padStart(5)} | ручная проверка ${String(s.ambiguous).padStart(3)} | не найдено ${String(s.unmatched).padStart(4)} | служебные ${String(s.special).padStart(4)}`);
    }
    console.log('\n=== Итого ===');
    console.log(`   записей с диспетчером: ${findings.length}`);
    console.log(`   будет привязано:        ${toUpdate.length}`);
    console.log(`   уже привязано:          ${already.length}`);
    console.log(`   ручная проверка:        ${ambiguous.length}`);
    console.log(`   не сопоставлено:        ${unmatched.length}`);
    console.log(`   служебные (пропуск):    ${special.length}`);
    if (unmatched.length) {
      console.log('\n=== Не сопоставлены (остаются без изменений) ===');
      const byValue = new Map<string, number>();
      for (const f of unmatched) byValue.set(f.value, (byValue.get(f.value) || 0) + 1);
      for (const [v, n] of [...byValue.entries()].sort((a, b) => b[1] - a[1])) console.log(`   «${v}» — ${n} записей`);
    }
  }

  // Файлы отчёта и резервной копии
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    when: new Date().toISOString(),
    db: DB,
    mode: APPLY ? 'apply' : 'dry-run',
    accounts: acc.accounts.map((a) => ({ uid: a.uid, fullName: a.fullName, role: a.role })),
    totals: {
      records: findings.length,
      toLink: toUpdate.length,
      alreadyLinked: already.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
      special: special.length,
    },
    perCollection,
    mapping: [...mapping.entries()].map(([key, m]) => ({ key, ...m })),
    planned: toUpdate.map((f) => ({ path: f.path, field: f.field, value: f.value, uid: f.uid, fullName: f.fullName })),
    manualReview: [...ambiguous, ...unmatched].map((f) => ({ path: f.path, field: f.field, value: f.value, action: f.action, reason: f.reason })),
  };
  const reportPath = join(OUT_DIR, `report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  if (!ONLY_JSON) console.log(`\nОтчёт: ${reportPath}`);

  if (!APPLY) {
    if (!ONLY_JSON) console.log('Изменений не внесено. Для применения: npx tsx scripts/migrate-dispatchers.ts --apply');
    return;
  }

  // --- Применение: резервная копия → запись → журнал ---
  const desired: Record<string, string> = {};
  const currentOf: Record<string, string | undefined> = {};
  const plan: Finding[] = [...toUpdate, ...already];
  for (const f of plan) {
    const base = f.path.slice(0, f.path.lastIndexOf('/'));
    const cur = f.current || {};
    // Поле-идентификатор всегда одно на запись: dispatcherId (для dispatcher
    // и dispatcherName) или logistId. Отдельного «dispatcherNameId» не создаём.
    const idField = f.field === 'dispatcherName' ? 'dispatcherId' : `${f.field}Id`;
    desired[`${base}/${idField}`] = f.uid!;
    currentOf[`${base}/${idField}`] = cur[idField];
    if (f.field === 'dispatcher' || f.field === 'dispatcherName') {
      desired[`${base}/dispatcherName`] = f.fullName!;
      currentOf[`${base}/dispatcherName`] = cur['dispatcherName'];
      if (f.field === 'dispatcher') {
        desired[`${base}/dispatcher`] = f.fullName!;
        currentOf[`${base}/dispatcher`] = cur['dispatcher'];
      }
    }
  }

  const updates: Record<string, string> = {};
  const backup: Record<string, { before: string; after: string }> = {};
  for (const [path, want] of Object.entries(desired)) {
    const has = currentOf[path];
    if (has === want) continue; // уже так — ничего не пишем (идемпотентность)
    updates[path] = want;
    backup[path] = { before: has === undefined ? '(нет)' : has, after: want };
  }

  const backupPath = join(OUT_DIR, `backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
  if (!ONLY_JSON) console.log(`Резервная копия: ${backupPath} (${Object.keys(backup).length} значений)`);

  const res = await fetch(`${DB}/.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const ok = res.ok;
  const log = {
    when: new Date().toISOString(),
    db: DB,
    updated: ok ? Object.keys(updates).length : 0,
    httpStatus: res.status,
    skipped: [...ambiguous, ...unmatched].map((f) => ({ path: f.path, value: f.value, reason: f.reason })),
    notTouched: special.map((f) => ({ path: f.path, value: f.value })),
    backup: backupPath,
    report: reportPath,
  };
  const logPath = join(OUT_DIR, `migrate-${stamp}.log.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
  if (!ONLY_JSON) {
    console.log(ok ? `\nГотово: обновлено путей — ${Object.keys(updates).length}` : `\nОШИБКА записи: HTTP ${res.status}`);
    console.log(`Журнал: ${logPath}`);
  }
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Сбой миграции:', e);
  process.exitCode = 1;
});
