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
export const stageRouteCmp = (a: TimelineStage, b: TimelineStage): number =>
  stageRouteCmpSeq(a, stageSeqOf(a, 0), b, stageSeqOf(b, 0));

/**
 * Тот же компаратор «дата, затем seq», но с ЗАРАНЕЕ вычисленным seq (для
 * сортировки списка, где миграционный seq считается по позиции элемента).
 */
export const stageRouteCmpSeq = (a: TimelineStage, seqA: number, b: TimelineStage, seqB: number): number => {
  const pa = dayNum(a.plannedDate);
  const pb = dayNum(b.plannedDate);
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return 1;
  if (pa != null && pb == null) return -1;
  const fa = dayNum(a.actualDate);
  const fb = dayNum(b.actualDate);
  if (pa == null && pb == null && fa != null && fb != null && fa !== fb) return fa - fb;
  return seqA - seqB || String(a.id).localeCompare(String(b.id));
};

/**
 * ЕДИНЫЙ ПОРЯДОК СПИСКА ЭТАПОВ (одна и та же сортировка «дата, затем seq» для
 * таблицы окна рейса, полосы, заливок, «в этот день также», мини-таймлайна,
 * отчётов и выгрузок): «как строки сверху вниз в окне — так и слева направо
 * на полосе в пределах одного дня». Сырой порядок массива (порядок ключей в
 * базе) на отображение не влияет: seq у старых записей читается миграционно
 * (seq → order → позиция), затем довесок — id (детерминированно).
 * Возвращает НОВЫЙ массив; исходный не мутируется.
 */
export const sortStagesRoute = (stages: TimelineStage[] | null | undefined): TimelineStage[] => {
  const list = (stages || []).filter((s) => s && typeof s === 'object');
  return list
    .map((s, i) => ({ s, seq: stageSeqOf(s, i) }))
    .sort((a, b) => stageRouteCmpSeq(a.s, a.seq, b.s, b.seq))
    .map((x) => x.s);
};

/** Служебная строка плана (фолбэк-этап «Загрузка» без данных) — не этап рейса. */
export const isServiceStageId = (id: unknown): boolean => String(id ?? '').endsWith('-fallback-load');

/**
 * Перенумерация seq/order 1..N по ПОРЯДКУ СПИСКА — «порядок строк окна рейса».
 * Возвращает НОВЫЙ массив (порядок входа сохраняется).
 */
export const renumberStageSeq = (stages: TimelineStage[] | null | undefined): TimelineStage[] =>
  (stages || []).filter((s) => s && typeof s === 'object').map((s, i) => ({ ...s, seq: i + 1, order: i + 1 }));

/** Вид пары соседних строк при перестановке: оба без даты / один день / разные дни. */
export type StageMoveKind = 'empty-tail' | 'same-day' | 'cross-day';

/**
 * Вид перестановки пары «перемещаемый этап ↔ сосед по списку отображения»:
 *  · 'empty-tail' — оба этапа без плановой даты (порядок в хвосте без дат);
 *  · 'same-day'   — обе плановые даты внесены и СОВПАДАЮТ (порядок внутри дня);
 *  · 'cross-day'  — обе даты внесены и РАЗНЫЕ (этапы разных дней);
 *  · null — пара «с датой ↔ без даты»: местами не переставляется.
 */
export const stageMoveKindOf = (
  moved: TimelineStage | null | undefined,
  neighbor: TimelineStage | null | undefined,
): StageMoveKind | null => {
  const mDay = dayNum(moved?.plannedDate);
  const nDay = dayNum(neighbor?.plannedDate);
  if (mDay == null && nDay == null) return 'empty-tail';
  if (mDay != null && nDay != null) return mDay === nDay ? 'same-day' : 'cross-day';
  return null;
};

/**
 * Перестановка строки на соседнюю позицию в СПИСКЕ ОТОБРАЖЕНИЯ (dir: −1 выше,
 * +1 ниже). Возвращает НОВЫЙ список или null, когда перестановка невозможна
 * (край списка / пара «с датой ↔ без даты»).
 *  · 'same-day' и 'empty-tail' — строки меняются местами, даты не трогаются;
 *  · 'cross-day' — у пары меняются местами ПЛАНОВЫЕ ДАТЫ (строка встаёт на день
 *    соседа — так она «встаёт ровно туда, куда её поставил пользователь», и
 *    полоса повторяет это слева направо); право на такую перестановку решает
 *    resolveStageMove (только администратор).
 * В обоих случаях seq/order перенумеровываются 1..N по новому порядку списка.
 */
export const moveStageInList = (
  stages: TimelineStage[] | null | undefined,
  movedId: string,
  dir: -1 | 1,
): TimelineStage[] | null => {
  const list = (stages || []).filter((s) => s && typeof s === 'object');
  const idx = list.findIndex((s) => String(s.id) === String(movedId));
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= list.length) return null;
  const moved = list[idx];
  const other = list[to];
  const kind = stageMoveKindOf(moved, other);
  if (!kind) return null;
  const next = [...list];
  if (kind === 'cross-day') {
    // Пара разных дней: этапы обмениваются датами (позиции — как при свапе).
    next[to] = { ...moved, plannedDate: other.plannedDate ?? '' };
    next[idx] = { ...other, plannedDate: moved.plannedDate ?? '' };
  } else {
    next[idx] = other;
    next[to] = moved;
  }
  return renumberStageSeq(next);
};

/**
 * Обмен местами ДВУХ этапов одного дня (кнопка «Поменять местами» при нарушении
 * шаблона): этапы обмениваются номерами seq, затем seq/order перенумеровываются
 * 1..N по новому порядку отображения. Даты не меняются. Нет пары в списке —
 * список возвращается как есть.
 */
export const swapStageOrderInList = (
  stages: TimelineStage[] | null | undefined,
  idA: string,
  idB: string,
): TimelineStage[] => {
  const list = (stages || []).filter((s) => s && typeof s === 'object');
  const ia = list.findIndex((s) => String(s.id) === String(idA));
  const ib = list.findIndex((s) => String(s.id) === String(idB));
  if (ia < 0 || ib < 0 || ia === ib) return list;
  const next = [...list];
  const sa = stageSeqOf(next[ia], ia);
  const sb = stageSeqOf(next[ib], ib);
  next[ia] = { ...next[ia], seq: sb, order: sb };
  next[ib] = { ...next[ib], seq: sa, order: sa };
  return renumberStageSeq(sortStagesRoute(next));
};

/** Нарушение хронологии: этап с БОЛЬШИМ seq имеет БОЛЕЕ РАННЮЮ дату. */
export interface StageOrderConflict {
  /** Этап с меньшим seq (идёт раньше в маршруте). */
  a: TimelineStage;
  /** Этап с большим seq (идёт позже), но с более ранней датой. */
  b: TimelineStage;
  /** Дни (номера) плановых дат пары: dayA > dayB. */
  dayA: number;
  dayB: number;
}

/**
 * ЖЁСТКИЙ контроль хронологии (блокирует сохранение): «дата этапа с БОЛЬШИМ seq
 * не может быть раньше даты этапа с меньшим seq». Возвращает ВСЕ пары-
 * нарушения (a — раньше по seq, b — позже по seq, но с более ранней датой);
 * пустой список — хронология чистая. Этапы без плановой даты и служебные
 * строки плана в проверку не входят (сравнивать нечего).
 */
export const stageOrderConflicts = (stages: TimelineStage[] | null | undefined): StageOrderConflict[] => {
  const ordered = (stages || [])
    .filter((s) => s && typeof s === 'object' && !isServiceStageId(s.id))
    .map((s, i) => ({ s, seq: stageSeqOf(s, i), day: dayNum(s.plannedDate) }))
    .filter((x): x is { s: TimelineStage; seq: number; day: number } => x.day != null)
    .sort((x, y) => x.seq - y.seq || String(x.s.id).localeCompare(String(y.s.id)));
  const out: StageOrderConflict[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (ordered[i].day > ordered[j].day) {
        out.push({ a: ordered[i].s, b: ordered[j].s, dayA: ordered[i].day, dayB: ordered[j].day });
      }
    }
  }
  return out;
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
