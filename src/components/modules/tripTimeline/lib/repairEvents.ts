/**
 * События на базе периода «Учёта выезда» — ЧИСТАЯ логика (без React и базы):
 * разбор вложенной ветки `baza/<id>/events`, типы событий, порядок внесения
 * (seq), проверка дат по границам периода, правила предложения сдвига срока
 * готовности и многострочная раскладка меток событий на полосе таймлайна
 * (с переносом на следующую строку).
 *
 * Хранение (RTDB, НЕ Firestore): события — ВЛОЖЕННАЯ ветка записи периода
 * `baza/<periodId>/events/<eventId>` с полями
 *   id, date (YYYY-MM-DD), type (ключ типа), text, amount,
 *   seq (порядковый номер внесения в рамках периода, целое ≥ 1),
 *   author, createdAt
 *   (+ updatedAt/updatedBy при правке, shiftedReadyFrom/To — если из события
 *   выполнялся явный сдвиг срока готовности).
 * Отсутствие ветки = пустая лента: старые периоды работают как раньше.
 * Старые записи без seq НЕ теряются: порядок читается по createdAt (фолбэк),
 * ничего в базе из-за чтения не переписывается.
 */
import { DAY_MS, dayNum } from './timeline';

/** Событие периода (разобранное представление записи ветки события). */
export interface RepairEvent {
  id: string;
  /** YYYY-MM-DD или '' (дата не указана — событие не ставится на полосу). */
  dateIso: string;
  /** Номер календарного дня (UTC), null — даты нет. */
  day: number | null;
  type: string;
  text: string;
  amount: number | null;
  /**
   * Порядковый номер внесения в рамках периода (целое ≥ 1):
   * «раньше внесено — выше в списке и левее на полосе». null — старая запись
   * без seq (порядок читается по createdAt, поле в базе не переписывается).
   */
  seq: number | null;
  author: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Явный сдвиг срока готовности ИЗ этого события (обе даты — YYYY-MM-DD). */
  shiftedReadyFrom?: string;
  shiftedReadyTo?: string;
}

/**
 * Типы событий на базе: стабильные ключи + подписи интерфейса (ровно десять).
 * Ключи diag/wait-part/part-arrived/work/done/other существовали и раньше —
 * уже сохранённые записи продолжают читаться с теми же подписями.
 */
export const REPAIR_EVENT_TYPES = [
  { key: 'diag', label: 'Диагностика' },
  { key: 'wait-part', label: 'Ждём запчасть' },
  { key: 'part-arrived', label: 'Запчасть приехала' },
  { key: 'work', label: 'Работы идут' },
  { key: 'done', label: 'Сдана с ремонта' },
  { key: 'to', label: 'ТО' },
  { key: 'wash', label: 'Мойка' },
  { key: 'no-driver', label: 'Простой без водителя' },
  { key: 'docs', label: 'Документы' },
  { key: 'other', label: 'Другое' },
] as const;

export type RepairEventTypeKey = (typeof REPAIR_EVENT_TYPES)[number]['key'];

/**
 * Старые/альтернативные ключи типов → канонический ключ. Маппинг применяется
 * ТОЛЬКО при чтении подписи/цвета: записи со старыми ключами не переписываются
 * и не теряются, незнакомый ключ показывается как есть.
 */
export const LEGACY_EVENT_TYPE_KEYS: Record<string, string> = {
  diagnostika: 'diag',
  diagnostics: 'diag',
  'wait-parts': 'wait-part',
  waiting: 'wait-part',
  'parts-arrived': 'part-arrived',
  'repair-work': 'work',
  'repair-done': 'done',
  maintenance: 'to',
  washing: 'wash',
  'no-driver-idle': 'no-driver',
  documents: 'docs',
};

/** Канонический ключ типа: известные старые ключи приводятся к текущим. */
export const canonicalEventType = (type: string): string => {
  const key = String(type || '');
  return LEGACY_EVENT_TYPE_KEYS[key] || key;
};

/** Ключ типа «ждём запчасть» — из него предлагается сдвиг срока готовности. */
export const WAIT_PART_TYPE: string = 'wait-part';

/** Подпись типа события; незнакомый ключ показывается как есть (не теряем). */
export const repairEventLabel = (type: string): string => {
  const key = canonicalEventType(type);
  const found = REPAIR_EVENT_TYPES.find((t) => t.key === key);
  return found ? found.label : String(type || 'Событие');
};

/**
 * Цвет точки события над полосой (существующая палитра портала: синий —
 * диагностика, янтарный — ожидание, бирюзовый — запчасть, оранжевый — работы,
 * зелёный — сдача, фиолетовый — ТО, циан — мойка, бордовый — простой без
 * водителя, оливковый — документы, серый — прочее). Точка — вторичный признак;
 * текст события всегда в подсказке по наведению.
 */
export const REPAIR_EVENT_DOT: Record<string, string> = {
  diag: '#2563EB',
  'wait-part': '#B45309',
  'part-arrived': '#0E7490',
  work: '#EA580C',
  done: '#1D6B50',
  to: '#6D28D9',
  wash: '#06B6D4',
  'no-driver': '#9F1239',
  docs: '#4D7C0F',
  other: '#6B7280',
};

export const repairEventDotColor = (type: string): string => REPAIR_EVENT_DOT[canonicalEventType(type)] || '#6B7280';

// ---------------------------------------------------------------------------
// Порядок внесения (seq) и сортировка (дата, seq)
// ---------------------------------------------------------------------------

/** Валидный seq события: целое ≥ 1. */
export const isValidEventSeq = (v: unknown): boolean => {
  if (v === null || v === undefined || String(v).trim() === '') return false;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1;
};

/**
 * Фолбэк-номера записей без seq: 1..n по порядку внесения (createdAt, затем id).
 * Старые записи считаются внесёнными раньше нумерованных (их rank ≤ числа
 * «внесённых» событий), поэтому сортировка «дата, seq» не переставляет ленту
 * относительно того, что уже видел пользователь.
 */
const legacySeqRanks = (events: RepairEvent[]): Map<string, number> => {
  const map = new Map<string, number>();
  events
    .filter((e) => !isValidEventSeq(e.seq))
    .slice()
    .sort(
      (a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .forEach((e, i) => map.set(e.id, i + 1));
  return map;
};

/** Эффективные номера внесения событий (id → seq); старым — фолбэк по createdAt. */
export const eventSeqRanks = (events: RepairEvent[]): Map<string, number> => {
  const ranks = legacySeqRanks(events);
  const out = new Map<string, number>();
  events.forEach((e) =>
    out.set(e.id, isValidEventSeq(e.seq) ? Math.floor(Number(e.seq)) : ranks.get(e.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return out;
};

/** Порядок ленты/точек: (дата, seq) — раньше внесено выше и левее. */
export const orderEvents = (events: RepairEvent[]): RepairEvent[] => {
  const ranks = eventSeqRanks(events);
  return [...events].sort((a, b) => {
    const da = a.day ?? Number.POSITIVE_INFINITY;
    const db = b.day ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    const ra = ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    const c = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (c !== 0) return c;
    return String(a.id).localeCompare(String(b.id));
  });
};

/**
 * Следующий seq периода: max(эффективный seq) + 1, где у старых записей без seq
 * номер берётся по фолбэку (createdAt/порядок). Пустая лента → 1.
 */
export const nextEventSeq = (events: RepairEvent[]): number => {
  const ranks = eventSeqRanks(events);
  let max = 0;
  events.forEach((e) => {
    const v = ranks.get(e.id) ?? 0;
    if (Number.isFinite(v) && v > max) max = v;
  });
  return max + 1;
};

/** Разбор ветки событий записи (незнакомые поля/типы не отбрасываются). */
export const parseRepairEvents = (raw: unknown): RepairEvent[] => {
  const list =
    raw && typeof raw === 'object'
      ? Array.isArray(raw)
        ? raw
        : Object.values(raw as Record<string, unknown>)
      : [];
  const out: RepairEvent[] = [];
  (list as Array<Record<string, unknown>>).forEach((e) => {
    if (!e || typeof e !== 'object') return;
    const dateIso = String(e.date || '').slice(0, 10);
    const amountRaw = e.amount;
    const amountNum = Number(amountRaw);
    out.push({
      id: String(e.id || ''),
      dateIso,
      day: dayNum(dateIso),
      type: String(e.type || 'other'),
      text: String(e.text || ''),
      amount:
        amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== '' && Number.isFinite(amountNum)
          ? amountNum
          : null,
      seq: isValidEventSeq(e.seq) ? Math.floor(Number(e.seq)) : null,
      author: String(e.author || ''),
      createdAt: String(e.createdAt || ''),
      updatedAt: e.updatedAt ? String(e.updatedAt) : undefined,
      updatedBy: e.updatedBy ? String(e.updatedBy) : undefined,
      shiftedReadyFrom: e.shiftedReadyFrom ? String(e.shiftedReadyFrom) : undefined,
      shiftedReadyTo: e.shiftedReadyTo ? String(e.shiftedReadyTo) : undefined,
    });
  });
  return orderEvents(out.filter((e) => e.id));
};

// ---------------------------------------------------------------------------
// Границы дат периода (валидация события)
// ---------------------------------------------------------------------------

/** Единое сообщение для даты вне периода (валидация формы и предупреждения). */
export const EVENT_DATE_OUT_OF_RANGE = 'Дата вне периода на базе';

/** Границы допустимых дат события по периоду: включительно lo..hi. */
export interface EventDateLimits {
  /** Дата приезда на базу; null — приезд не указан, нижней границы нет. */
  lo: number | null;
  /** Дата выезда; если выезд не указан — сегодняшняя дата. null — не задано. */
  hi: number | null;
}

/**
 * Границы дат события по периоду: от ДАТЫ ПРИЕЗДА до ДАТЫ ВЫЕЗДА включительно;
 * если выезд не указан — до сегодняшней даты. Без даты приезда нижней границы
 * нет (проверка верхней не отменяется).
 */
export const eventDateLimits = (arrivalIso: string, departureIso: string, todayIso: string): EventDateLimits => {
  const lo = dayNum(arrivalIso);
  const hi = dayNum(departureIso) ?? dayNum(todayIso);
  return { lo, hi };
};

/** Дата события внутри границ периода (обе границы включительно). */
export const isEventDateAllowed = (dateIso: string, limits: EventDateLimits): boolean => {
  const d = dayNum(dateIso);
  if (d == null) return false;
  if (limits.lo != null && d < limits.lo) return false;
  if (limits.hi != null && d > limits.hi) return false;
  return true;
};

/**
 * События С ДАТОЙ вне диапазона (для предупреждений при смене дат периода).
 * Записи без даты в список не попадают: они не ставятся на полосу и не
 * удаляются; их просто не к чему относить.
 */
export const eventsOutOfRange = (events: RepairEvent[], limits: EventDateLimits): RepairEvent[] =>
  events.filter((e) => e.day != null && !isEventDateAllowed(e.dateIso, limits));

// ---------------------------------------------------------------------------
// Сдвиг срока готовности из «Ждём запчасть»
// ---------------------------------------------------------------------------

/** Шаг сдвига срока готовности из события «Ждём запчасть», календарных дней. */
export const SHIFT_DAYS_FOR_WAIT = 7;

/**
 * Предложение сдвига срока готовности из события «Ждём запчасть».
 * ПРАВИЛО (не автоматическое — кнопка явная): базовая дата — самая поздняя из
 * «срок готовности, дата события, сегодня»; новая = база + 7 дней. Когда срока
 * готовности ещё нет — он назначается (fromIso ''). Ничего не двигается само.
 */
export const proposedReadyShift = (
  readyIso: string,
  eventIso: string,
  todayIso: string,
): { fromIso: string; toIso: string; days: number; toDay: number } | null => {
  const readyDay = dayNum(readyIso);
  const eventDay = dayNum(eventIso);
  const todayDay = dayNum(todayIso);
  const baseCandidates = [readyDay, eventDay, todayDay].filter((d): d is number => d != null);
  if (!baseCandidates.length) return null;
  const base = Math.max(...baseCandidates);
  const toDay = base + SHIFT_DAYS_FOR_WAIT;
  return { fromIso: readyIso || '', toIso: isoOfDay(toDay), days: SHIFT_DAYS_FOR_WAIT, toDay };
};

/** Номер дня → YYYY-MM-DD (локальная реализация, чтобы модуль оставался чистым). */
export const isoOfDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Событие «ждём запчасть», из которого ещё НЕ выполнялся сдвиг и которое имеет
 * смысл предложить: берётся САМОЕ ПОЗДНЕЕ такое событие (по дате, затем
 * внесению). null — предлагать нечего.
 */
export const pendingWaitEvent = (events: RepairEvent[]): RepairEvent | null => {
  const candidates = events.filter((e) => e.type === WAIT_PART_TYPE && !e.shiftedReadyTo);
  if (!candidates.length) return null;
  return candidates[candidates.length - 1];
};

// ---------------------------------------------------------------------------
// Раскладка меток событий на полосе (многострочная, с переносом)
// ---------------------------------------------------------------------------

/**
 * Метка события на базе — компактная плашка ТОГО ЖЕ размера по высоте, что у
 * одиночной метки события рейса на полотне (9 px, слой TL_Z.mark): у рейса это
 * точка-ромб, у события базы — плашка с началом текста (полный текст — в
 * подсказке). Цвет — BASE_EVENT_COLORS (lib/visuals). Начало текста — само
 * событие; у старых записей без текста показывается бывший тип.
 */
export interface EventChip {
  /** Ключ для React (id первого события метки). */
  key: string;
  /** День события (номер календарного дня). */
  day: number;
  /** Левая X-координата метки внутри полосы (px). */
  x: number;
  /** Ширина метки (px): задаётся явно из текста — раскладка и отрисовка совпадают. */
  width: number;
  /**
   * Строка раскладки: 0 — первая (на полосе, как раньше точки);
   * 1.. — следующая строка НИЖЕ полосы (перенос; слой метки растёт).
   */
  line: number;
  /** События метки; при свёртке хвоста дня — несколько (extra > 0). */
  items: RepairEvent[];
  /** Сколько событий дня свёрнуто в счётчик «+N» (0 — метка без счётчика). */
  extra: number;
}

/** Высота метки события базы (px) — как у одиночной метки события рейса. */
export const EVENT_CHIP_H = 9;
/** Вертикальный шаг строк раскладки (px): высота метки + 1 px зазор. */
export const EVENT_CHIP_ROW_STEP = 10;
/** Горизонтальный зазор между метками (px). */
export const EVENT_CHIP_GAP = 2;
/** Отступ первой строки от верхнего края полосы (px). */
export const EVENT_CHIP_TOP = 1;
/** Число строк раскладки по умолчанию (дальше переносить некуда — хвост в «+N»). */
export const EVENT_CHIP_LINES = 2;
/** Минимальная и максимальная ширина метки (px). */
export const EVENT_CHIP_MIN_W = 14;
export const EVENT_CHIP_MAX_W = 120;
/** Оценка средней ширины символа метки при шрифте 7 px (px). */
export const EVENT_CHIP_CHAR_W = 4.2;
/** Горизонтальные внутренние отступы метки (px). */
export const EVENT_CHIP_PAD = 6;

/** Подпись события для метки: сам текст, у старых записей без текста — бывший тип. */
export const eventMarkText = (e: RepairEvent): string => (e.text ? e.text : repairEventLabel(e.type));

/** Дата события в формате метки (дд/мм) — как в подписях полос таймлайна. */
export const eventMarkDate = (e: RepairEvent): string =>
  e.dateIso ? e.dateIso.split('-').reverse().slice(0, 2).join('/') : '';

/**
 * Подпись метки события базы: начало текста (у старых записей без текста —
 * подпись бывшего типа) и дата: «Мойка · 13/10». Иконку (гаечный ключ) рисует
 * сама метка — её ширина учтена отдельно (EVENT_CHIP_ICON_W).
 */
export const eventMarkLabel = (e: RepairEvent): string => {
  const t = eventMarkText(e);
  const d = eventMarkDate(e);
  return d ? `${t} · ${d}` : t;
};

/**
 * Размер метки события базы = ромб 9×9, как у события рейса (ширина в раскладке
 * тоже 9: маркер не растягивается по тексту — текст живёт в подсказке).
 */
export const EVENT_CHIP_DOT = 9;

/** Ширина метки по её тексту (та же формула применяется в отрисовке). */
export const eventMarkWidth = (text: string): number => {
  const raw = String(text ?? '');
  const w = EVENT_CHIP_PAD + Math.ceil(raw.length * EVENT_CHIP_CHAR_W);
  return Math.max(EVENT_CHIP_MIN_W, Math.min(EVENT_CHIP_MAX_W, w));
};

/**
 * Ширина метки события в раскладке: постоянный размер ромба (без DOM).
 * Подпись с датой (eventMarkLabel) нужна только подсказке — по ней метка
 * больше не растягивается.
 */
export const eventChipWidthOf = (_e: RepairEvent): number => EVENT_CHIP_DOT;

/** Занятая зона строки раскладки (полуинтервал [a, b), px внутри полосы). */
interface BusyZone {
  a: number;
  b: number;
}

/** Первая свободная позиция x ≥ from на строке: [x, x+w) не пересекает занятые
 *  зоны (с горизонтальным зазором EVENT_CHIP_GAP по обе стороны). */
const firstFreeX = (busy: BusyZone[], from: number, w: number): number => {
  let x = from;
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < busy.length; i += 1) {
      const z = busy[i];
      if (x < z.b + EVENT_CHIP_GAP && x + w + EVENT_CHIP_GAP > z.a) {
        x = z.b + EVENT_CHIP_GAP;
        moved = true;
      }
    }
  }
  return x;
};

/**
 * Раскладка меток событий полосы: каждая метка — на дне своего события;
 * события одного дня идут СЛЕВА НАПРАВО по seq («раньше внесено — левее»).
 * Когда метка не помещается в своей позиции строки (место занято другой
 * меткой), она ПЕРЕНОСИТСЯ на следующую строку; на новой строке — снова от
 * левого края дня, снова слева направо. Строк не больше maxLines; если и там
 * «своя» позиция занята, метка встаёт в первую свободную позицию последней
 * строки — событие не теряется и метки не накладываются друг на друга.
 * xOf(day) — позиция левого края дня относительно полосы, dayW — ширина дня
 * (раскладка не пересекает метки между собой: ни в строке, ни между строками).
 */
export const layoutEventDots = (
  events: RepairEvent[],
  clipA: number,
  clipB: number,
  xOf: (day: number) => number,
  dayW: number,
  opts?: { maxLines?: number; widthOf?: (e: RepairEvent) => number },
): EventChip[] => {
  const widthOf = opts?.widthOf || eventChipWidthOf;
  const maxLines = Math.max(1, Math.floor(opts?.maxLines ?? EVENT_CHIP_LINES));
  void dayW; // ширина дня участвует через xOf; параметр сохранён для совместимости вызова
  const byDay = new Map<number, RepairEvent[]>();
  events.forEach((e) => {
    if (e.day == null || e.day < clipA || e.day > clipB) return;
    const arr = byDay.get(e.day);
    if (arr) arr.push(e);
    else byDay.set(e.day, [e]);
  });
  const busy: BusyZone[][] = Array.from({ length: maxLines }, () => []);
  const chips: EventChip[] = [];
  Array.from(byDay.keys())
    .sort((a, b) => a - b)
    .forEach((day) => {
      // Порядок меток одного дня — по seq (старым записям — фолбэк createdAt).
      const items = orderEvents(byDay.get(day) as RepairEvent[]);
      const dayStart = xOf(day) + 1;
      const dayCursor: number[] = Array.from({ length: maxLines }, () => dayStart);
      items.forEach((e) => {
        const w = widthOf(e);
        let line = -1;
        for (let L = 0; L < maxLines; L += 1) {
          if (firstFreeX(busy[L], dayCursor[L], w) === dayCursor[L]) {
            line = L;
            break;
          }
        }
        let x: number;
        if (line < 0) {
          // Все строки заняты в «своей» позиции — ставим в первую свободную
          // позицию последней строки: метка не пропадает и не накладывается.
          line = maxLines - 1;
          x = firstFreeX(busy[line], dayCursor[line], w);
        } else {
          x = dayCursor[line];
        }
        busy[line].push({ a: x, b: x + w });
        busy[line].sort((p, q) => p.a - q.a);
        dayCursor[line] = x + w + EVENT_CHIP_GAP;
        chips.push({ key: e.id, day, x, width: w, line, items: [e], extra: 0 });
      });
    });
  return chips;
};

/**
 * Дата события по умолчанию для формы: СЕГОДНЯ, но всегда в границах периода
 * (сегодня вне границ — ближайшая граница): форма открывается с допустимой
 * датой, а не с заведомо отклоняемой.
 */
export const defaultEventDate = (limits: EventDateLimits, todayIso: string): string => {
  const t = dayNum(todayIso);
  if (t == null) return todayIso;
  if (limits.hi != null && t > limits.hi) return isoOfDay(limits.hi);
  if (limits.lo != null && t < limits.lo) return isoOfDay(limits.lo);
  return todayIso;
};
