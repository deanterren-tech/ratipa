/**
 * События ремонта периода «Учёта выезда» — ЧИСТАЯ логика (без React и базы):
 * разбор вложенной ветки `baza/<id>/events`, типы событий, правила предложения
 * сдвига срока готовности и раскладка точек над полосой на таймлайне.
 *
 * Хранение (RTDB, НЕ Firestore): события — ВЛОЖЕННАЯ ветка записи периода
 * `baza/<periodId>/events/<eventId>` с полями
 *   id, date (YYYY-MM-DD), type (ключ типа), text, amount, author, createdAt
 *   (+ updatedAt/updatedBy при правке, shiftedReadyFrom/To — если из события
 *   выполнялся явный сдвиг срока готовности).
 * Отсутствие ветки = пустая лента: старые периоды работают как раньше.
 */
import { DAY_MS, dayNum } from './timeline';

/** Событие ремонта (разобранное представление записи ветки события). */
export interface RepairEvent {
  id: string;
  /** YYYY-MM-DD или '' (дата не указана — событие не ставится на полосу). */
  dateIso: string;
  /** Номер календарного дня (UTC), null — даты нет. */
  day: number | null;
  type: string;
  text: string;
  amount: number | null;
  author: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Явный сдвиг срока готовности ИЗ этого события (обе даты — YYYY-MM-DD). */
  shiftedReadyFrom?: string;
  shiftedReadyTo?: string;
}

/** Типы событий ремонта: стабильные ключи + подписи интерфейса. */
export const REPAIR_EVENT_TYPES = [
  { key: 'diag', label: 'Диагностика' },
  { key: 'wait-part', label: 'Ждём запчасть' },
  { key: 'part-arrived', label: 'Запчасть приехала' },
  { key: 'work', label: 'Работы идут' },
  { key: 'done', label: 'Сдана с ремонта' },
  { key: 'other', label: 'Другое' },
] as const;

export type RepairEventTypeKey = (typeof REPAIR_EVENT_TYPES)[number]['key'];

/** Ключ типа «ждём запчасть» — из него предлагается сдвиг срока готовности. */
export const WAIT_PART_TYPE: string = 'wait-part';

/** Подпись типа события; незнакомый ключ показывается как есть (не теряем). */
export const repairEventLabel = (type: string): string => {
  const found = REPAIR_EVENT_TYPES.find((t) => t.key === type);
  return found ? found.label : String(type || 'Событие');
};

/**
 * Цвет точки события над полосой (существующая палитра портала: синий —
 * диагностика, янтарный — ожидание, бирюзовый — запчасть, оранжевый — работы,
 * зелёный — сдача, серый — прочее). Точка — вторичный признак; текст события
 * всегда в подсказке по наведению.
 */
export const REPAIR_EVENT_DOT: Record<string, string> = {
  diag: '#2563EB',
  'wait-part': '#B45309',
  'part-arrived': '#0E7490',
  work: '#EA580C',
  done: '#1D6B50',
  other: '#6B7280',
};

export const repairEventDotColor = (type: string): string => REPAIR_EVENT_DOT[type] || '#6B7280';

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
      author: String(e.author || ''),
      createdAt: String(e.createdAt || ''),
      updatedAt: e.updatedAt ? String(e.updatedAt) : undefined,
      updatedBy: e.updatedBy ? String(e.updatedBy) : undefined,
      shiftedReadyFrom: e.shiftedReadyFrom ? String(e.shiftedReadyFrom) : undefined,
      shiftedReadyTo: e.shiftedReadyTo ? String(e.shiftedReadyTo) : undefined,
    });
  });
  return out
    .filter((e) => e.id)
    .sort((a, b) => (a.day ?? Number.POSITIVE_INFINITY) - (b.day ?? Number.POSITIVE_INFINITY) || a.createdAt.localeCompare(b.createdAt));
};

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

/** Точка события над полосой: одна на событие; события одного дня — рядом. */
export interface EventDot {
  /** Ключ для React (по первому событию точки). */
  key: string;
  day: number;
  /** Относительная X-координата центра точки внутри полосы (px). */
  x: number;
  /** События точки (у «слитой» точки — несколько, лишние уходят в подсказку). */
  items: RepairEvent[];
  /** Сколько событий дня не поместилось в отдельные точки (0 — все видны). */
  extra: number;
}

/** Максимум отдельных точек на один день (остальные — в подсказке «+N»). */
export const MAX_DOTS_PER_DAY = 3;
/** Горизонтальный шаг между точками одного дня, px. */
export const DOT_STEP = 9;

/**
 * Раскладка точек событий над полосой в пределах её видимого отрезка:
 * точки ставятся в центр дня события; события одного дня — рядом (шаг 9px);
 * лишние (>3) объединяются в последнюю точку (extra). xOf(day) — позиция
 * левого края дня относительно полосы, dayW — ширина дня.
 */
export const layoutEventDots = (
  events: RepairEvent[],
  clipA: number,
  clipB: number,
  xOf: (day: number) => number,
  dayW: number,
): EventDot[] => {
  const byDay = new Map<number, RepairEvent[]>();
  events.forEach((e) => {
    if (e.day == null || e.day < clipA || e.day > clipB) return;
    const arr = byDay.get(e.day);
    if (arr) arr.push(e);
    else byDay.set(e.day, [e]);
  });
  const dots: EventDot[] = [];
  Array.from(byDay.keys())
    .sort((a, b) => a - b)
    .forEach((day) => {
      const items = byDay.get(day) as RepairEvent[];
      const shown = Math.min(items.length, MAX_DOTS_PER_DAY);
      const grouped: RepairEvent[][] = [];
      for (let i = 0; i < shown; i += 1) grouped.push([items[i]]);
      if (items.length > shown) grouped[shown - 1] = grouped[shown - 1].concat(items.slice(shown));
      grouped.forEach((grp, i) => {
        dots.push({
          key: `${grp[0].id}`,
          day,
          x: xOf(day) + dayW / 2 + (i - (shown - 1) / 2) * DOT_STEP,
          items: grp,
          extra: items.length > shown && i === shown - 1 ? items.length - shown : 0,
        });
      });
    });
  return dots;
};
