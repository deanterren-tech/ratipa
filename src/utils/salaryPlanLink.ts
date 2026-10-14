/**
 * Подстановка данных «Плана дохода» в форму зарплаты водителя.
 *
 * Почему отдельным модулем: правила подстановки — это ЧИСТЫЕ правила над записью
 * плана (`TripPlan` из `trips_dashboard`) и текущими значениями формы. Здесь нет
 * ни обращений к базе, ни ставок: модуль только отвечает на вопросы
 *  · какие поля плана можно подставить (даты старта/финиша и «Факт км»);
 *  · чего в плане не хватает (и как это назвать человеку);
 *  · что изменится при повторной подстановке («Обновить из плана дохода»).
 *
 * ВАЖНО про «Факт км»: подставляется ТОЛЬКО фактический пробег плана
 * (`factKm`). Плановый километраж (`totalKm`), сумма плеч маршрута и любые
 * производные значения не подставляются никогда — это разные величины.
 *
 * ВАЖНО про ноль и отсутствие: отсутствие значения — `undefined`/`null`/`''`/NaN;
 * явно введённый `0` — ЭТО ЗНАЧЕНИЕ (нулевой пробег допустим настолько, насколько
 * его допускает существующий расчёт зарплаты). Проверка «!value» здесь запрещена:
 * она считала бы 0 незаполненным.
 */
import type { TripPlan } from '../types';

/** Поле плана дохода, пригодное к подстановке. */
export type PlanFieldKey = 'dateStart' | 'dateEnd' | 'factKm';

/** Подпись отсутствующего в плане поля — ровно та, что показывается человеку. */
export const PLAN_FIELD_LABEL: Record<PlanFieldKey, string> = {
  dateStart: 'дата старта',
  dateEnd: 'дата финиша',
  factKm: '«Факт км»',
};

/** Текст уведомления об отсутствующем фактическом пробеге (дословно по заданию). */
export const PLAN_FACT_KM_MISSING_NOTICE =
  'В выбранном плане дохода не заполнен фактический пробег. Внесите «Факт км» в плане дохода или укажите его вручную';

/** Значение есть? Отличает пусто/NaN от явного нуля. */
export const planValuePresent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return false;
};

/** Факт км плана: число (0 — допустимое значение) или null, если не заполнен. */
export const planFactKmOf = (plan: TripPlan | null | undefined): number | null => {
  const raw = (plan as { factKm?: unknown } | null | undefined)?.factKm;
  if (!planValuePresent(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Дата плана (YYYY-MM-DD) или '' — строки не выдумываем. */
export const planDateOf = (plan: TripPlan | null | undefined, key: 'dateStart' | 'dateEnd'): string => {
  const raw = key === 'dateStart' ? plan?.dateStart : plan?.dateEnd;
  return planValuePresent(raw) ? String(raw).trim() : '';
};

/** Маршрут плана одной строкой: «Мозырь → Гомель → Стамбул». */
export const planRouteText = (plan: TripPlan | null | undefined): string => {
  const legs = (plan?.legs || []).filter(Boolean) as Array<{ from?: string; to?: string }>;
  if (!legs.length) return '';
  const points: string[] = [];
  legs.forEach((leg) => {
    const from = String(leg?.from || '').trim();
    const to = String(leg?.to || '').trim();
    if (from && points.length === 0) points.push(from);
    if (to) points.push(to);
  });
  return points.join(' → ');
};

/** Дата ДД/ММ/ГГГГ из YYYY-MM-DD (в портале даты пишутся через слеши). */
export const planDayRu = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '');

export interface PlanSubstitution {
  /** Значения, которые план реально даёт (отсутствующие полей здесь нет). */
  values: Partial<Record<PlanFieldKey, string | number>>;
  /** Поля, которых в плане нет — их нужно заполнить вручную. */
  missing: PlanFieldKey[];
}

/**
 * Что план может подставить: только даты старта/финиша и «Факт км».
 * Пустые поля плана попадают в `missing`, а не превращаются в нули/даты.
 */
export const buildPlanSubstitution = (plan: TripPlan | null | undefined): PlanSubstitution => {
  const values: PlanSubstitution['values'] = {};
  const missing: PlanFieldKey[] = [];

  const start = planDateOf(plan, 'dateStart');
  if (start) values.dateStart = start;
  else missing.push('dateStart');

  const end = planDateOf(plan, 'dateEnd');
  if (end) values.dateEnd = end;
  else missing.push('dateEnd');

  const factKm = planFactKmOf(plan);
  if (factKm !== null) values.factKm = factKm;
  else missing.push('factKm');

  return { values, missing };
};

/** Человекочитаемое «что подставлено» — для сообщения после подстановки. */
export const describeSubstituted = (values: PlanSubstitution['values']): string => {
  const parts: string[] = [];
  if (values.dateStart !== undefined && values.dateEnd !== undefined) {
    parts.push(`даты рейса ${planDayRu(String(values.dateStart))} – ${planDayRu(String(values.dateEnd))}`);
  } else {
    if (values.dateStart !== undefined) parts.push(`дата старта ${planDayRu(String(values.dateStart))}`);
    if (values.dateEnd !== undefined) parts.push(`дата финиша ${planDayRu(String(values.dateEnd))}`);
  }
  if (values.factKm !== undefined) {
    const n = Number(values.factKm);
    parts.push(`«Факт км» ${Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—'} км`);
  }
  return parts.join(', ');
};

/** «Осталось заполнить: дата старта, «Факт км»». */
export const describeMissing = (missing: PlanFieldKey[]): string =>
  missing.map((k) => PLAN_FIELD_LABEL[k]).join(', ');

export interface PlanSubstitutionPlanInput {
  dateStart: string;
  dateEnd: string;
  km: number | '';
}

export interface PlanSubstitutionPreviewRow {
  key: PlanFieldKey;
  label: string;
  /** Значение в форме сейчас (для показа «было»); '' — пусто. */
  currentLabel: string;
  /** Значение из плана (для показа «станет»). */
  nextLabel: string;
  /** Совпадает с текущим — замена не требуется. */
  same: boolean;
  /** В форме уже что-то введено (замена требует подтверждения). */
  filled: boolean;
}

/**
 * Предпросмотр подстановки: что изменится и что требует подтверждения.
 * Пустые поля формы заполняются молча, заполненные и отличающиеся — только по
 * подтверждению (см. форму зарплаты); здесь это лишь классифицируется.
 */
export const planSubstitutionPreview = (
  plan: TripPlan | null | undefined,
  current: PlanSubstitutionPlanInput,
): PlanSubstitutionPreviewRow[] => {
  const { values } = buildPlanSubstitution(plan);
  const rows: PlanSubstitutionPreviewRow[] = [];

  const push = (key: PlanFieldKey, label: string, currentRaw: string, nextRaw: string) => {
    if (nextRaw === '') return; // в плане пусто — подставлять нечего
    const filled = currentRaw.trim() !== '';
    rows.push({
      key,
      label,
      currentLabel: filled ? currentRaw : '— не заполнено —',
      nextLabel: nextRaw,
      same: filled && currentRaw.trim() === nextRaw.trim(),
      filled,
    });
  };

  push('dateStart', 'Дата старта', planDayRu(String(current.dateStart || '')), planDayRu(String(values.dateStart ?? '')));
  push('dateEnd', 'Дата финиша', planDayRu(String(current.dateEnd || '')), planDayRu(String(values.dateEnd ?? '')));
  const factKm = values.factKm;
  if (factKm !== undefined) {
    const currentKm = current.km === '' || current.km === null || current.km === undefined ? '' : String(current.km);
    const nextKm = String(factKm);
    const filled = currentKm.trim() !== '';
    rows.push({
      key: 'factKm',
      label: 'Общий пробег (Факт км)',
      currentLabel: filled ? currentKm : '— не заполнено —',
      nextLabel: nextKm,
      same: filled && currentKm.trim() === nextKm.trim(),
      filled,
    });
  }

  return rows;
};

/** Есть ли в предпросмотре реальные изменения (не «всё уже совпадает»). */
export const planPreviewHasChanges = (rows: PlanSubstitutionPreviewRow[]): boolean =>
  rows.some((r) => !r.same);

/** Короткая подпись источника: «TR A · 14/10/2026 – 28/10/2026 · факт 5 500 км». */
export const planSourceLabel = (plan: TripPlan | null | undefined): string => {
  if (!plan) return '';
  const parts: string[] = [];
  if (plan.carNumber) parts.push(String(plan.carNumber));
  const start = planDateOf(plan, 'dateStart');
  const end = planDateOf(plan, 'dateEnd');
  if (start || end) parts.push(`${planDayRu(start) || '—'} – ${planDayRu(end) || '—'}`);
  const route = planRouteText(plan);
  if (route) parts.push(route);
  const factKm = planFactKmOf(plan);
  parts.push(factKm === null ? '«Факт км» не заполнен' : `факт ${factKm.toLocaleString('ru-RU')} км`);
  return parts.join(' · ');
};

/** Водитель плана (если связь есть) — только для показа, без автоподстановки. */
export const planDriverLabel = (plan: TripPlan | null | undefined): string => {
  const name = plan?.driverName;
  return planValuePresent(name) ? String(name).trim() : '';
};
