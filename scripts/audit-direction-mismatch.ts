/**
 * Аудит РАСХОЖДЕНИЙ направления между «Таймлайном рейсов» и «Планом дохода».
 *
 * READ-ONLY: ничего не записывает и не правит — только печатает списки.
 *
 * Как устроена связь (фактическая архитектура, проверено по коду и базе):
 *  - целые рейсы таймлайна строятся ИЗ записей `trips_dashboard` НА ЧТЕНИИ;
 *    ключ связанного рейса — `pd:<planId>`, направление у такой пары — ОДНО
 *    поле `direction` записи плана (отдельной копии на стороне таймлайна нет);
 *  - ручные рейсы таймлайна (`tripTimeline/trips/*`, ключ `tl:<id>`) живут
 *    отдельно; связь с планом у них может быть только явным полем
 *    (`planId`/`planKey`/`plan_id`) — по номеру машины связи НЕ угадываются.
 *
 * Что проверяется:
 *  1. РАСХОЖДЕНИЯ ФОРМАТА (основной список): в записи сохранён старый КОД
 *     («TR»/«CN»), тогда как каноническое значение — НАЗВАНИЕ справочника
 *     («Турция»/«Китай»). Таймлайн показывает разрешённое направление,
 *     «План дохода» в списке/вкладках раньше видел код как есть — это и есть
 *     расхождение «рейс ↔ план» в существующих данных. Печатается:
 *     id, машина, направление рейса (как его видит таймлайн), направление
 *     плана (как сохранено), каноническое значение.
 *  2. Ручные рейсы таймлайна: у каждого — либо сравнение с явно связанной
 *     записью плана, либо отдельный список «связь отсутствует» (не связываем).
 *  3. НЕОДНОЗНАЧНЫЕ случаи отдельным списком: направления нет на стороне плана
 *     (пусто/нет поля) либо сохранено значение, которого нет в справочнике.
 *
 * Запуск: npx tsx scripts/audit-direction-mismatch.ts [--json]
 */
import {
  directionLabelOf,
  directionOptionsFromDb,
  normalizeTripDirection,
} from '../src/components/modules/tripTimeline/lib/directionCatalog';
import { mergeDirections } from '../src/components/modules/tripTimeline/lib/directions';

const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';

const get = async (path: string): Promise<Record<string, unknown>> => {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`база недоступна: ${path} → HTTP ${res.status}`);
  return ((await res.json()) as Record<string, unknown>) || {};
};

interface PlanRow {
  id: string;
  carNumber: string;
  direction: string;
  archived: boolean;
  hidden: boolean;
}

interface MismatchRow {
  id: string;
  carNumber: string;
  tripDirection: string;
  planDirection: string;
  canonical: string;
}

interface AmbiguousRow {
  id: string;
  carNumber: string;
  direction: string;
  reason: string;
}

interface ManualRow {
  id: string;
  carNumber: string;
  direction: string;
  linkedPlanId: string | null;
  planDirection?: string;
  same?: boolean;
}

(async () => {
  const [dirRecords, tripsRaw, manualRaw] = await Promise.all([
    get('directories/directions'),
    get('trips_dashboard'),
    get('tripTimeline/trips'),
  ]);

  // Справочник направлений — записями (id/code/name) и массивом вариантов.
  const dirList: Array<Record<string, unknown>> = Array.isArray(dirRecords)
    ? (dirRecords as Array<Record<string, unknown>>)
    : (Object.values(dirRecords) as Array<Record<string, unknown>>);
  const options = directionOptionsFromDb(dirList);
  const defs = mergeDirections(dirList);
  const canonicalName = (raw: unknown): string => {
    const label = directionLabelOf(options, raw);
    if (!label) return '';
    // Название из справочника (в т.ч. подстановка кода CN/TR → название).
    const def = defs.find((d) => d.name.toLowerCase() === label.toLowerCase() || d.code === String(raw || '').toUpperCase());
    return def ? def.name : label;
  };

  const plans: PlanRow[] = Object.entries(tripsRaw).map(([id, v]) => {
    const rec = (v || {}) as Record<string, unknown>;
    return {
      id,
      carNumber: String(rec.carNumber || ''),
      direction: String(rec.direction ?? ''),
      archived: rec.isArchived === true || rec.isArchived === 'True',
      hidden: rec.hiddenFromTimeline === true,
    };
  });

  // ── 1. Основные расхождения: сохранён КОД, а не название справочника ──────
  const mismatches: MismatchRow[] = [];
  const ambiguous: AmbiguousRow[] = [];
  plans.forEach((p) => {
    const canonical = canonicalName(p.direction);
    if (!p.direction.trim()) {
      ambiguous.push({
        id: p.id,
        carNumber: p.carNumber,
        direction: p.direction,
        reason: 'направление не указано в записи плана (обе стороны покажут «—»)',
      });
      return;
    }
    if (!canonical) {
      ambiguous.push({
        id: p.id,
        carNumber: p.carNumber,
        direction: p.direction,
        reason: 'значения нет в справочнике directions — сопоставить нельзя',
      });
      return;
    }
    // Расхождение = сохранённое значение не равно каноническому названию:
    // таймлайн показывает разрешённое направление, план видит сохранённый код.
    if (p.direction.trim().toLowerCase() !== canonical.toLowerCase()) {
      mismatches.push({
        id: p.id,
        carNumber: p.carNumber,
        tripDirection: canonical,
        planDirection: p.direction,
        canonical,
      });
    }
  });

  // ── 2. Ручные рейсы таймлайна: явная связь или её отсутствие ──────────────
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const manual: ManualRow[] = [];
  const manualNoLink: ManualRow[] = [];
  Object.entries(manualRaw).forEach(([id, v]) => {
    const rec = (v || {}) as Record<string, unknown>;
    const rawLink = rec.planId ?? rec.planKey ?? rec.plan_id ?? null;
    const linkedPlanId = rawLink == null ? null : String(rawLink).replace(/^pd:/, '');
    const row: ManualRow = {
      id,
      carNumber: String(rec.carNumber || ''),
      direction: String(rec.direction ?? ''),
      linkedPlanId,
    };
    if (!linkedPlanId) {
      manualNoLink.push(row);
      return;
    }
    const linked = plansById.get(linkedPlanId);
    if (!linked) {
      manualNoLink.push({ ...row, linkedPlanId: null });
      return;
    }
    row.planDirection = linked.direction;
    row.same = normalizeTripDirection(row.direction, options) === normalizeTripDirection(linked.direction, options);
    manual.push(row);
  });
  const manualMismatch = manual.filter((m) => m.same === false);

  // ── Вывод ─────────────────────────────────────────────────────────────────
  const out = {
    checkedAt: new Date().toISOString(),
    directory: { count: options.length, names: options.map((o) => `${o.name} (${o.code})`) },
    counts: {
      planRecords: plans.length,
      mismatches: mismatches.length,
      ambiguous: ambiguous.length,
      manualTrips: manualNoLink.length + manual.length,
      manualLinked: manual.length,
      manualLinkedMismatches: manualMismatch.length,
    },
    mismatches,
    ambiguous,
    manualWithoutLink: manualNoLink,
    manualLinkedMismatches: manualMismatch,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const line = (r: { id: string; carNumber: string }, extra: string) =>
    ` • ${r.id} · ${r.carNumber || 'машина не указана'} · ${extra}`;
  console.log(`Справочник направлений: ${options.map((o) => `${o.name}=${o.code}`).join(', ') || 'ПУСТ'}`);
  console.log(`Записей плана дохода: ${plans.length}; ручных рейсов таймлайна: ${out.counts.manualTrips}`);
  console.log('');
  console.log(`1. Расхождения направления (сохранён код вместо названия): ${mismatches.length}`);
  mismatches.forEach((m) => console.log(line(m, `рейс=${m.tripDirection}; план=${m.planDirection} → канонично «${m.canonical}»`)));
  console.log('');
  console.log(`2. Неоднозначные (нет направления на стороне плана / значение вне справочника): ${ambiguous.length}`);
  ambiguous.forEach((a) => console.log(line(a, `direction=${JSON.stringify(a.direction)} — ${a.reason}`)));
  console.log('');
  console.log(`3. Ручные рейсы таймлайна без явной связи с планом: ${manualNoLink.length}`);
  manualNoLink.forEach((r) => console.log(line(r, `direction=${JSON.stringify(r.direction)} — связь отсутствует, по номеру машины не сопоставляем`)));
  if (manual.length) {
    console.log('');
    console.log(`4. Ручные рейсы с явной связью (расхождений: ${manualMismatch.length}):`);
    manual.forEach((m) => console.log(line(m, `рейс=${JSON.stringify(m.direction)}; план(${m.linkedPlanId})=${JSON.stringify(m.planDirection)}${m.same ? ' — совпадает' : ' — РАСХОЖДЕНИЕ'}`)));
  }
  console.log('');
  console.log('Ничего не перезаписано (read-only).');
})().catch((e) => {
  console.error('Аудит не выполнен:', (e as Error).message);
  process.exitCode = 1;
});
