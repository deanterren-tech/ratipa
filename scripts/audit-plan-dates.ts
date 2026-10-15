/**
 * audit-plan-dates — READ-ONLY аудит плановых дат «Таймлайна рейсов» и
 * «Плана дохода» (часть 3 задания владельца). НИЧЕГО НЕ ПЕРЕЗАПИСЫВАЕТ:
 * только чтение базы (REST) и печать списков — решения принимает владелец.
 *
 * Что ищет:
 *  (а) записи плана, где dateStart есть, а dateEnd нет, но плановые даты
 *      ЭТАПОВ (tripTimeline/tripStages/<planId>) дают возвращение — СПИСОК:
 *      id, машина, старт, возвращение из этапов + ПРЕДЛОЖЕНИЕ (не применяется);
 *  (б) записи, где плановые границы по этапам ПРОТИВОречат полям
 *      dateStart/dateEnd (этапы вне окна записи) — отдельным списком;
 *  (в) «сироты» этапов: ветка tripStages/<id> без записи плана — списком;
 *  (г) записи, где возвращение раньше старта — списком;
 *  (д) легаси-оверрайды правок дат в tripTimeline/tripMeta (planStart/planEnd) —
 *      второе независимое значение дат; показываются, ничего не удаляется.
 *
 * Запуск: npm run audit:plan-dates   (или npx tsx scripts/audit-plan-dates.ts)
 */

const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';

const getJson = async (path: string): Promise<Record<string, Record<string, unknown>>> => {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const data = await res.json();
  return (data && typeof data === 'object' ? data : {}) as Record<string, Record<string, unknown>>;
};

/** Строгие ISO-даты данных → календарный номер дня (UTC) или null. */
const dayNum = (v: unknown): number | null => {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Math.round(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000);
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (ru) return Math.round(Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])) / 86400000);
  return null;
};
const fmt = (n: number | null): string => {
  if (n == null) return '—';
  const d = new Date(n * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
const iso = (n: number | null): string => (n == null ? '—' : new Date(n * 86400000).toISOString().slice(0, 10));

/** Плановые даты этапов рейса: мин/макс по plannedDate (пустые пропускаются). */
const stagePlannedBounds = (stagesRaw: Record<string, unknown> | undefined): { min: number | null; max: number | null; days: number[] } => {
  const days: number[] = [];
  Object.values(stagesRaw || {}).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    const n = dayNum((s as Record<string, unknown>).plannedDate);
    if (n != null) days.push(n);
  });
  days.sort((a, b) => a - b);
  return { min: days.length ? days[0] : null, max: days.length ? days[days.length - 1] : null, days };
};

(async () => {
  const [plan, stages, meta] = await Promise.all([
    getJson('trips_dashboard'),
    getJson('tripTimeline/tripStages'),
    getJson('tripTimeline/tripMeta'),
  ]);
  const planIds = new Set(Object.keys(plan));

  // (а) dateStart без dateEnd, а этапы дают возвращение.
  const noEnd: string[] = [];
  // (б) плановые границы по этапам противоречат полям записи.
  const contradict: string[] = [];
  // (г) возвращение раньше старта.
  const reversed: string[] = [];

  Object.entries(plan).forEach(([id, rec]) => {
    const r = rec || {};
    const car = String(r.carNumber || '—');
    const start = dayNum(r.dateStart);
    const end = dayNum(r.dateEnd);
    const s = stagePlannedBounds(stages[id]);
    if (start != null && end == null && s.max != null) {
      noEnd.push(
        `• ${id} · ${car} · старт ${fmt(start)} (${iso(start)}) · возвращение из этапов ${fmt(s.max)} (${iso(s.max)})` +
          `\n    предложение (НЕ применено): dateEnd = ${iso(s.max)} — заполняется только по решению владельца`,
      );
    }
    if (start != null && end != null && s.min != null && s.max != null) {
      const outside: string[] = [];
      if (s.min < start) outside.push(`этап ${fmt(s.min)} раньше старта ${fmt(start)}`);
      if (s.max > end) outside.push(`этап ${fmt(s.max)} позже возвращения ${fmt(end)}`);
      if (outside.length) {
        contradict.push(
          `• ${id} · ${car} · запись: ${fmt(start)} – ${fmt(end)} · этапы: ${fmt(s.min)} – ${fmt(s.max)} → ${outside.join('; ')}`,
        );
      }
    }
    if (start != null && end != null && end < start) {
      reversed.push(`• ${id} · ${car} · dateStart ${fmt(start)}, dateEnd ${fmt(end)} — возвращение РАНЬШЕ старта`);
    }
  });

  // (в) «сироты» этапов без записи плана.
  const orphans: string[] = [];
  Object.entries(stages).forEach(([id, sv]) => {
    if (planIds.has(id)) return;
    const s = stagePlannedBounds(sv);
    const count = Object.keys(sv || {}).length;
    const car = String((sv || {}).carNumber || (sv || {}).car || '');
    orphans.push(
      `• ${id} · этапов: ${count} · плановые даты: ${s.min != null || s.max != null ? `${fmt(s.min)} – ${fmt(s.max)}` : 'нет'}` +
        (car ? ` · машина в записи этапов: ${car}` : '') +
        ' — записи trips_dashboard/<id> нет',
    );
  });

  // (д) легаси-оверрайды дат в tripMeta (второе независимое значение).
  const legacy: string[] = [];
  Object.entries(meta).forEach(([key, rec]) => {
    const r = rec || {};
    const ps = dayNum(r.planStart);
    const pe = dayNum(r.planEnd);
    if (ps == null && pe == null) return;
    const baseId = key.replace(/^(pd|tl):/, '');
    const src = plan[baseId] || {};
    const recStart = dayNum(src.dateStart);
    const recEnd = dayNum(src.dateEnd);
    const differs = (ps != null && recStart != null && ps !== recStart) || (pe != null && recEnd != null && pe !== recEnd);
    legacy.push(
      `• ${key} · оверрайд: ${fmt(ps)} – ${fmt(pe)} · запись: ${fmt(recStart)} – ${fmt(recEnd)}${differs ? ' → РАСХОЖДЕНИЕ' : ''}` +
        ' (новые правки дат оверрайд не создают и очищают его той же операцией)',
    );
  });

  console.log('== Аудит плановых дат (read-only; ничего не изменено) ==');
  console.log(`записей плана: ${planIds.size} · веток этапов: ${Object.keys(stages).length} · веток tripMeta: ${Object.keys(meta).length}`);
  console.log(`\n(а) dateStart без dateEnd, возвращение есть в этапах: ${noEnd.length}`);
  noEnd.forEach((l) => console.log(l));
  console.log(`\n(б) плановые границы по этапам противоречат полям записи: ${contradict.length}`);
  contradict.forEach((l) => console.log(l));
  console.log(`\n(в) «сироты» этапов без записи плана: ${orphans.length}`);
  orphans.forEach((l) => console.log(l));
  console.log(`\n(г) возвращение раньше старта: ${reversed.length}`);
  reversed.forEach((l) => console.log(l));
  console.log(`\n(д) легаси-оверрайды дат в tripMeta: ${legacy.length}`);
  legacy.forEach((l) => console.log(l));
  console.log('\nИтог: ничего не перезаписано; списки — только для решения владельца.');
})().catch((err) => {
  console.error('Аудит не выполнен:', (err as Error)?.message || err);
  process.exit(1);
});
