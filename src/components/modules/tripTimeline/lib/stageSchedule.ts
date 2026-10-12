/**
 * Плановый график этапов с запасом (буфером) — ЧИСТАЯ логика без React и базы.
 *
 * Модель:
 *  - у этапа есть `seq` (порядок в маршруте; у старых рейсов отсутствует —
 *    читается из `order`, затем из позиции в массиве; БЕЗ перезаписи данных)
 *    и `bufferDays` (запас, целое ≥ 0; отсутствие = 0);
 *  - цепочка — этапы с плановой датой, отсортированные «сначала дата, затем
 *    seq по возрастанию» (раньше внесён — левее);
 *  - эффективная плановая дата этапа = его плановая дата + СУММА запасов по
 *    цепочке, включая собственный запас (запас накапливается: каждый этап
 *    сдвигает себя и всех последующих);
 *  - итоги рейса: «план без запаса» (введённые даты), «суммарный запас»
 *    (Σ bufferDays), «итого» = план + суммарный запас, «плановое возвращение» =
 *    последняя плановая дата + суммарный запас.
 *
 * Отдельной «нормативной длительности» между этапами в модели НЕТ (даты
 * вводятся вручную; в справочнике типов её тоже нет) — поэтому формула
 * «дата предыдущего этапа + длительность + запас» сводится к «введённая дата +
 * накопленный запас»: разница дат соседних этапов и есть фактическая
 * длительность перехода, запас добавляется поверх неё. Это осознанное
 * согласование спеки с данными — см. отчёт.
 *
 * Статусы факта относительно плана С запасом:
 *  - факт ≤ план                    → «в срок» (зелёный, как раньше);
 *  - план < факт ≤ план + запас     → «в пределах запаса» (жёлтый);
 *  - факт > план + запас            → «за пределами запаса» (красный);
 *  - факта нет: дата с запасом прошла → «срок с запасом прошёл» (просрочка
 *    ожидания), иначе — «запланировано».
 * Критический срок этапа считается от даты С ЗАПАСОМ (effectiveDay).
 */
import type { TimelineStage } from '../../../../types';

/** Внутренний «номер дня» (UTC) — модуль остаётся чистым, без импорта React-слоя. */
const DAY_MS = 86400000;
const dayNum = (s?: string | null): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
};
const dayStr = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Порядок этапа в маршруте: seq → order → позиция в массиве (миграционный порядок). */
export const stageSeqOf = (s: TimelineStage, index: number): number => {
  const seq = Number(s?.seq);
  if (Number.isFinite(seq) && seq > 0) return Math.floor(seq);
  const ord = Number(s?.order);
  if (Number.isFinite(ord) && ord > 0) return Math.floor(ord);
  return index + 1;
};

/** Есть ли у этапа собственный seq в данных (целое > 0). */
export const hasStageSeq = (s: TimelineStage | undefined): boolean => {
  const seq = Number(s?.seq);
  return Number.isFinite(seq) && seq > 0;
};

/** Запас этапа, дней: целое ≥ 0 (отсутствие/мусор = 0). */
export const stageBufferOf = (s: TimelineStage): number => {
  const v = Number(s?.bufferDays);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

/** Ключ сортировки маршрута: сначала дата (без даты — в конец), затем seq. */
export const stageRouteCmp = (a: TimelineStage, b: TimelineStage): number => {
  const pa = dayNum(a.plannedDate);
  const pb = dayNum(b.plannedDate);
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return 1;
  if (pa != null && pb == null) return -1;
  const fa = dayNum(a.actualDate);
  const fb = dayNum(b.actualDate);
  if (pa == null && pb == null && fa != null && fb != null && fa !== fb) return fa - fb;
  return stageSeqOf(a, 0) - stageSeqOf(b, 0) || String(a.id).localeCompare(String(b.id));
};

export interface StageChainItem {
  stageId: string;
  seq: number;
  bufferDays: number;
  /** Накопленный запас по цепочке, включая собственный. */
  cumBufferDays: number;
  /** Введённая плановая дата (номер дня и ISO). */
  plannedDay: number;
  plannedIso: string;
  /** Плановая дата с запасом (та же функция, что и «критический срок»). */
  effectiveDay: number;
  effectiveIso: string;
  isCritical: boolean;
}

export interface StageSchedule {
  chain: StageChainItem[];
  byId: Map<string, StageChainItem>;
  planStartDay: number | null;
  planEndDay: number | null;
  planEndIso: string | null;
  /** Σ запасов этапов (только этапы с датой входят в цепочку). */
  totalBufferDays: number;
  /** «Плановое возвращение» с запасом: последняя дата цепочки + суммарный запас. */
  effectiveEndDay: number | null;
  effectiveEndIso: string | null;
}

/** Плановый график этапов: цепочка дат с накопленным запасом и итоги рейса. */
export const buildStageSchedule = (stages: TimelineStage[] | undefined): StageSchedule => {
  const list = (stages || []).filter((s) => s && typeof s === 'object');
  // seq присваивается по позиции в ИСХОДНОМ массиве (миграционный порядок),
  // затем цепочка сортируется «дата, затем seq».
  const withSeq = list.map((s, i) => ({ s, seq: stageSeqOf(s, i) }));
  const dated = withSeq
    .map((x) => ({ ...x, day: dayNum(x.s.plannedDate) }))
    .filter((x): x is { s: TimelineStage; seq: number; day: number } => x.day != null)
    .sort((a, b) => a.day - b.day || a.seq - b.seq || String(a.s.id).localeCompare(String(b.s.id)));

  const chain: StageChainItem[] = [];
  let cum = 0;
  dated.forEach(({ s, seq, day }) => {
    const bufferDays = stageBufferOf(s);
    cum += bufferDays;
    chain.push({
      stageId: s.id,
      seq,
      bufferDays,
      cumBufferDays: cum,
      plannedDay: day,
      plannedIso: dayStr(day),
      effectiveDay: day + cum,
      effectiveIso: dayStr(day + cum),
      isCritical: !!s.isCritical,
    });
  });

  const byId = new Map(chain.map((c) => [c.stageId, c]));
  const planStartDay = chain.length ? chain[0].plannedDay : null;
  const planEndDay = chain.length ? chain[chain.length - 1].plannedDay : null;
  const totalBufferDays = cum;
  const effectiveEndDay = planEndDay != null ? planEndDay + totalBufferDays : null;
  return {
    chain,
    byId,
    planStartDay,
    planEndDay,
    planEndIso: planEndDay != null ? dayStr(planEndDay) : null,
    totalBufferDays,
    effectiveEndDay,
    effectiveEndIso: effectiveEndDay != null ? dayStr(effectiveEndDay) : null,
  };
};

/** Плановая дата этапа С ЗАПАСОМ (вне цепочки — просто плановая дата). */
export const stageEffectiveDayOf = (schedule: StageSchedule, s: TimelineStage): number | null => {
  const item = schedule.byId.get(s.id);
  if (item) return item.effectiveDay;
  return dayNum(s.plannedDate);
};

export type StageBufferState =
  | 'no-plan'
  | 'nodata'
  | 'planned'
  | 'planned-overdue'
  | 'ontime'
  | 'within'
  | 'beyond';

export interface StageBufferStateInfo {
  code: StageBufferState;
  /** Короткая подпись состояния (для таблицы карточки). */
  label: string;
  /** Разница факт − план (дней, без запаса); null — сравнить нечего. */
  devDays: number | null;
  /** Разница факт − план-с-запасом; null — сравнить нечего. */
  bufferDevDays: number | null;
}

/**
 * Состояние этапа с учётом запаса: факт в пределах запаса — жёлтый
 * ('within'), за пределами — красный ('beyond'); «крит. срок» считается от
 * даты с запасом. Для рейсов без запасов поведение прежнее (0 запас).
 */
export const stageBufferStateOf = (s: TimelineStage, schedule: StageSchedule, today: number): StageBufferStateInfo => {
  const p = dayNum(s.plannedDate);
  const f = dayNum(s.actualDate);
  const pe = stageEffectiveDayOf(schedule, s);
  if (p == null) {
    return {
      code: f != null ? 'nodata' : 'no-plan',
      label: f != null ? 'факт без плановой даты — недостаточно данных' : 'плановая дата не указана',
      devDays: null,
      bufferDevDays: null,
    };
  }
  if (f == null) {
    const eff = pe ?? p;
    return eff < today
      ? { code: 'planned-overdue', label: 'срок с запасом прошёл, факт не указан', devDays: null, bufferDevDays: null }
      : { code: 'planned', label: 'запланировано, факт не указан', devDays: null, bufferDevDays: null };
  }
  const dev = f - p;
  const eff = pe ?? p;
  const bdev = f - eff;
  if (dev <= 0) return { code: 'ontime', label: dev === 0 ? 'по плану' : `раньше плана на ${-dev} дн`, devDays: dev, bufferDevDays: bdev };
  if (bdev <= 0) {
    return {
      code: 'within',
      label: `позже плана на ${dev} дн — в пределах запаса (${-bdev} дн в запасе)`,
      devDays: dev,
      bufferDevDays: bdev,
    };
  }
  return {
    code: 'beyond',
    label: `за пределами запаса: позже плана на ${dev} дн, запас исчерпан ${bdev} дн назад`,
    devDays: dev,
    bufferDevDays: bdev,
  };
};

/** Цвет состояния (единая семантика для таблицы и подсказок). */
export const stageBufferStateTone = (code: StageBufferState): 'emerald' | 'amber' | 'rose' | 'grey' => {
  if (code === 'ontime') return 'emerald';
  if (code === 'within') return 'amber';
  if (code === 'beyond' || code === 'planned-overdue') return 'rose';
  return 'grey';
};
