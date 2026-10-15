/**
 * История изменений рейса (план + факт) — ЧИСТАЯ логика без обращений к базе.
 *
 * Одна успешная операция сохранения окна рейса (или записи «Плана дохода») =
 * ОДНА запись истории со списком всех изменённых полей «было → стало».
 * Сохранение без изменений записи не создаёт.
 *
 * Хранение: `tripTimeline/tripHistory/<tripKey>/<opKey>` (serverTimestamp —
 * время сервера, автор — текущий пользователь). Ключ записи = opKey: стабильный
 * ключ операции (содержимое изменений + окно времени), поэтому одна и та же
 * правка, пришедшая из другой вкладки при синхронизации, не даёт дубля.
 *
 * Старая история плана (`tripTimeline/planGuard/<tripKey>/history`, механизм
 * разрешений) не теряется: она читается на лету и показывается в том же списке
 * (см. legacyPlanHistoryEntries) — записи не переписываются и не выдумываются.
 */
import type { TimelinePlanHistoryEntry, TimelineStage } from '../../../../types';
import { dayNum } from './timeline';
import { stageBufferOf, stageSeqOf } from './stageSchedule';
import { computePlanStageChanges, isFallbackStage } from './planChanges';

/** К какой части рейса относится изменение. */
export type TripHistoryScope = 'plan' | 'fact' | 'both';

/** Одна строка изменения: поле (или этап) и «было → стало». */
export interface TripHistoryLine {
  scope: TripHistoryScope;
  /** Поле или этап: «Возвращение», «Загрузка: план», «Добавлен этап «Граница»». */
  field: string;
  from: string;
  to: string;
}

/** Источник изменения: сохранение окна таймлайна, «План дохода», система. */
export type TripHistorySource = 'timeline' | 'plan' | 'system';

/** Запись истории в базе (`tripTimeline/tripHistory/<tripKey>/<opKey>`). */
export interface TripHistoryEntry {
  /** Время внесения — serverTimestamp (мс эпохи после чтения из базы). */
  at: number | null;
  by: string;
  byUid?: string;
  source: TripHistorySource;
  /** Стабильный ключ операции — он же ключ записи (защита от дублей). */
  opKey: string;
  summary?: string;
  lines: TripHistoryLine[];
}

/** Снимок состояния рейса для сравнения (план/факт одной операции). */
export interface TripHistorySnapshot {
  /** Плановый старт (ISO или ''). */
  planStart: string;
  /** Плановое возвращение (ISO или ''). */
  planEnd: string;
  /** Количество кругов рейса. */
  circles: number;
  /** Направление — человекочитаемое значение ('', — не указано). */
  direction: string;
  stages: TimelineStage[];
}

export const TRIP_HISTORY_SCOPE_LABELS: Record<TripHistoryScope, string> = {
  plan: 'План',
  fact: 'Факт',
  both: 'План и факт',
};

export const TRIP_HISTORY_SOURCE_LABELS: Record<TripHistorySource, string> = {
  timeline: 'Таймлайн',
  plan: 'План дохода',
  system: 'Система',
};

/** Ширина окна склейки одинаковых операций (одна и та же правка из двух вкладок). */
export const TRIP_HISTORY_DEDUPE_WINDOW_MS = 120_000;

// ---------------------------------------------------------------------------
// Форматирование значений (ничего не выдумываем: пусто — понятная подпись)
// ---------------------------------------------------------------------------

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Значение даты для строки истории: дд.мм.гггг либо исходный текст. */
export const fmtHistoryDay = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'не указана';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return raw;
};

/** Время внесения записи истории: дд.мм.гггг, чч:мм. */
export const fmtHistoryDateTime = (atMs: number | null | undefined): string => {
  if (atMs == null || !Number.isFinite(atMs)) return 'Не зафиксировано';
  try {
    const d = new Date(atMs);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return 'Не зафиксировано';
  }
};

/** Дата в подписи (дд.мм.гггг, чч:мм) — только для тестов/подсказок. */
export const fmtHistoryDayLong = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw || 'не указана';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${m[3]} ${MONTHS[d.getMonth()]} ${m[1]}`;
};

const boolLabel = (v: unknown): string => (v ? 'да' : 'нет');

/** Границы ФАКТА рейса по фактическим датам реальных этапов (не заглушек). */
export const factBoundsOf = (stages: TimelineStage[] | undefined): { start: string; end: string } => {
  const days = (stages || [])
    .filter((s) => !isFallbackStage(s))
    .map((s) => String(s.actualDate || '').trim())
    .filter((d) => dayNum(d) != null)
    .sort();
  return { start: days.length ? days[0] : '', end: days.length ? days[days.length - 1] : '' };
};

// ---------------------------------------------------------------------------
// Расчёт строк изменений
// ---------------------------------------------------------------------------

export interface TripHistoryBuildOptions {
  /** Подпись этапа (тип/место) для строк истории. */
  nameOf?: (s: TimelineStage) => string;
}

/**
 * Строки изменений между двумя снимками рейса.
 *
 * Плановая часть переиспользует computePlanStageChanges (плановые даты, запас
 * и порядок этапов, состав, круги, привязка к кругам); дополнительно считаются
 * факт (фактические даты этапов и границы факта), тип этапа, место, крит. срок
 * и направление рейса.
 */
export const buildTripHistoryLines = (
  before: TripHistorySnapshot,
  after: TripHistorySnapshot,
  opts: TripHistoryBuildOptions = {},
): TripHistoryLine[] => {
  const nameOf = (s: TimelineStage): string => (opts.nameOf ? opts.nameOf(s) : s.label || s.type || s.id);
  const lines: TripHistoryLine[] = [];

  // ── План рейса: границы, круги, направление (поля записи рейса) ─────────
  if ((before.planStart || '') !== (after.planStart || '')) {
    lines.push({ scope: 'plan', field: 'Старт', from: fmtHistoryDay(before.planStart), to: fmtHistoryDay(after.planStart) });
  }
  if ((before.planEnd || '') !== (after.planEnd || '')) {
    lines.push({ scope: 'plan', field: 'Возвращение', from: fmtHistoryDay(before.planEnd), to: fmtHistoryDay(after.planEnd) });
  }
  const circlesBefore = Math.max(1, Math.floor(Number(before.circles)) || 1);
  const circlesAfter = Math.max(1, Math.floor(Number(after.circles)) || 1);
  if (circlesBefore !== circlesAfter) {
    lines.push({ scope: 'plan', field: 'Количество кругов', from: String(circlesBefore), to: String(circlesAfter) });
  }
  if (String(before.direction || '') !== String(after.direction || '')) {
    lines.push({
      scope: 'plan',
      field: 'Направление',
      from: before.direction ? before.direction : 'не указано',
      to: after.direction ? after.direction : 'не указано',
    });
  }

  // ── Границы ФАКТА (крайние фактические даты этапов) ─────────────────────
  const factBefore = factBoundsOf(before.stages);
  const factAfter = factBoundsOf(after.stages);
  if (factBefore.start !== factAfter.start && (factBefore.start || factAfter.start)) {
    lines.push({ scope: 'fact', field: 'Старт', from: fmtHistoryDay(factBefore.start), to: fmtHistoryDay(factAfter.start) });
  }
  if (factBefore.end !== factAfter.end && (factBefore.end || factAfter.end)) {
    lines.push({ scope: 'fact', field: 'Возвращение', from: fmtHistoryDay(factBefore.end), to: fmtHistoryDay(factAfter.end) });
  }

  // ── Этапы: плановая часть (общий расчёт изменений плана) ────────────────
  const changes = computePlanStageChanges(before.stages, after.stages, { stored: circlesBefore, draft: circlesAfter });
  const afterById = new Map((after.stages || []).map((s) => [s.id, s]));
  const beforeById = new Map((before.stages || []).map((s) => [s.id, s]));
  const storedIdx = new Map((before.stages || []).map((s, i) => [s.id, i]));

  changes.plannedUpdates.forEach((u) => {
    const stage = afterById.get(u.id) || beforeById.get(u.id);
    const name = stage ? nameOf(stage) : u.id;
    if ((u.before || '') !== (u.plannedDate || '')) {
      lines.push({ scope: 'plan', field: `${name}: план`, from: fmtHistoryDay(u.before), to: fmtHistoryDay(u.plannedDate) });
    }
    if (u.bufferDays !== undefined) {
      lines.push({ scope: 'plan', field: `${name}: запас дней`, from: String(u.bufferBefore ?? 0), to: String(u.bufferDays) });
    }
    if (u.seq !== undefined) {
      lines.push({
        scope: 'both',
        field: `${name}: порядок в маршруте`,
        from: String(u.orderBefore ?? '—'),
        to: String(u.seq),
      });
    }
  });
  changes.adds.forEach((s) => {
    const plan = dayNum(s.plannedDate) != null ? ` — план ${fmtHistoryDay(s.plannedDate)}` : '';
    lines.push({ scope: 'both', field: `Добавлен этап «${nameOf(s)}»`, from: '', to: `новый этап${plan}` });
  });
  changes.removes.forEach((s) => {
    lines.push({ scope: 'both', field: `Удалён этап «${nameOf(s)}»`, from: 'этап был в рейсе', to: 'этап удалён' });
  });
  changes.circleUpdates.forEach((u) => {
    const stage = afterById.get(u.id) || beforeById.get(u.id);
    const name = stage ? nameOf(stage) : u.id;
    lines.push({
      scope: 'both',
      field: `${name}: круг`,
      from: u.before != null ? String(u.before) : 'не указан',
      to: u.circle != null ? String(u.circle) : 'не указан',
    });
  });

  // ── Этапы: факт, тип, место, крит. срок (поля, не входящие в план-расчёт) ─
  (after.stages || []).forEach((s) => {
    if (isFallbackStage(s)) return;
    const was = beforeById.get(s.id);
    if (!was) return; // добавленный этап уже описан строкой «Добавлен этап»
    const name = nameOf(s);
    if ((was.actualDate || '') !== (s.actualDate || '')) {
      lines.push({ scope: 'fact', field: `${name}: факт`, from: fmtHistoryDay(was.actualDate), to: fmtHistoryDay(s.actualDate) });
    }
    if ((was.type || '') !== (s.type || '')) {
      lines.push({ scope: 'both', field: `${name}: тип этапа`, from: was.type || 'не указан', to: s.type || 'не указан' });
    }
    if ((was.label || '') !== (s.label || '')) {
      lines.push({ scope: 'both', field: `${name}: место`, from: was.label || 'не указано', to: s.label || 'не указано' });
    }
    if (!!was.isCritical !== !!s.isCritical) {
      lines.push({ scope: 'both', field: `${name}: критический срок`, from: boolLabel(was.isCritical), to: boolLabel(s.isCritical) });
    }
    // Порядок мог измениться без смены даты/запаса — плановый расчёт его уже
    // поймал (seq), но если этап не попал в plannedUpdates, добавим строку.
    const inPlanned = changes.plannedUpdates.some((u) => u.id === s.id);
    if (!inPlanned) {
      const seqBefore = stageSeqOf(was, storedIdx.get(was.id) ?? 0);
      const seqAfter = stageSeqOf(s, 0);
      if (seqBefore !== seqAfter) {
        lines.push({ scope: 'both', field: `${name}: порядок в маршруте`, from: String(seqBefore), to: String(seqAfter) });
      }
    }
  });

  return lines;
};

// ---------------------------------------------------------------------------
// Ключ операции (защита от дублей при синхронизации)
// ---------------------------------------------------------------------------

/** Короткий стабильный хеш строки (FNV-1a → base36). */
const hashOf = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/** Содержимое операции без автора: одна и та же правка = один ключ. */
export const tripHistoryContentKey = (tripKey: string, lines: TripHistoryLine[]): string => {
  const body = lines.map((l) => `${l.scope}|${l.field}|${l.from}→${l.to}`).join(';');
  return `${hashOf(`${tripKey}#${body}`)}`;
};

/**
 * Стабильный ключ операции: содержимое изменений + окно времени (склейка
 * одинаковых правок, пришедших из двух вкладок/двух путей синхронизации).
 * Автор в ключ НЕ входит: инициатор записи сохраняется, а не подменяется
 * синхронизирующим пользователем.
 */
export const tripHistoryOpKey = (
  tripKey: string,
  lines: TripHistoryLine[],
  atMs: number,
  windowMs = TRIP_HISTORY_DEDUPE_WINDOW_MS,
): string => {
  const win = Math.max(1, Math.floor(windowMs));
  const bucket = Math.floor(atMs / win);
  return `${tripHistoryContentKey(tripKey, lines)}-${bucket.toString(36)}`;
};

/** Путь записи истории одного рейса. */
export const tripHistoryPath = (tripKey: string, opKey: string): string =>
  `tripTimeline/tripHistory/${String(tripKey || '').replace(/[.#$/[\]]/g, '_')}/${opKey}`;

/** Черновик записи истории: без `at` — его проставляет база (serverTimestamp). */
export interface TripHistoryDraft {
  opKey: string;
  path: string;
  entry: Omit<TripHistoryEntry, 'at'>;
  lines: TripHistoryLine[];
}

/**
 * Запись истории для одной операции сохранения: null — изменений нет (записи
 * не будет). Автор обязателен: системные изменения передают source='system' и
 * пользователя не подставляют.
 */
export const buildTripHistoryDraft = (params: {
  tripKey: string;
  before: TripHistorySnapshot;
  after: TripHistorySnapshot;
  by?: string;
  byUid?: string;
  source: TripHistorySource;
  /** Время операции (мс) — для ключа; запись времени в базе — serverTimestamp. */
  atMs: number;
  nameOf?: (s: TimelineStage) => string;
  summary?: string;
  windowMs?: number;
}): TripHistoryDraft | null => {
  const lines = buildTripHistoryLines(params.before, params.after, { ...(params.nameOf ? { nameOf: params.nameOf } : {}) });
  if (!lines.length) return null;
  const opKey = tripHistoryOpKey(params.tripKey, lines, params.atMs, params.windowMs);
  const by = String(params.by || '').trim();
  if (params.source !== 'system' && !by) {
    // Изменение человека без автора не записываем: выдумывать автора нельзя.
    return null;
  }
  return {
    opKey,
    path: tripHistoryPath(params.tripKey, opKey),
    lines,
    entry: {
      by: by || 'Система',
      ...(params.byUid ? { byUid: params.byUid } : {}),
      source: params.source,
      opKey,
      ...(params.summary ? { summary: params.summary } : {}),
      lines,
    },
  };
};

// ---------------------------------------------------------------------------
// Показ: сортировка, метки, старая история плана (без потери)
// ---------------------------------------------------------------------------

/** Время записи в мс: число, ISO-строка либо неизвестно (null). */
export const tripHistoryAtMs = (at: unknown): number | null => {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at === 'string' && at.trim()) {
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

/** Метки старой истории плана (tripTimeline/planGuard/<tripKey>/history). */
export const LEGACY_PLAN_HISTORY_LABELS: Record<string, string> = {
  initial: 'первичное сохранение плана',
  update: 'изменение плана',
  'admin-update': 'изменение плана (администратор)',
  grant: 'разрешение выдано',
  revoke: 'разрешение отозвано',
  request: 'запрошен доступ к плану',
  'request-approved': 'доступ одобрен',
  'request-rejected': 'доступ отклонён',
  'request-used': 'разрешение использовано',
  'request-revoked': 'разрешение отозвано',
};

/**
 * Строка истории для показа: живая запись из базы либо запись старой истории
 * плана (legacy — только чтение, ничего не переписываем).
 */
export interface TripHistoryView {
  key: string;
  atMs: number | null;
  atLabel: string;
  byLabel: string;
  sourceLabel: string;
  /** Метка «План» / «Факт» / «План и факт» — у старых записей пусто. */
  scopeLabel: string;
  field: string;
  from: string;
  to: string;
  /** Пояснение (summary живой записи или текст старой истории плана). */
  note: string;
  legacy: boolean;
}

/** Запись истории (как она лежит в базе) → строки для показа. */
export const tripHistoryEntryViews = (entry: TripHistoryEntry, keyFallback = ''): TripHistoryView[] => {
  const atMs = tripHistoryAtMs(entry.at);
  const base = {
    atMs,
    atLabel: fmtHistoryDateTime(atMs),
    byLabel: String(entry.by || '').trim() || 'Неизвестно',
    sourceLabel: TRIP_HISTORY_SOURCE_LABELS[entry.source] || '',
    note: entry.summary || '',
    legacy: false,
  };
  const lines = Array.isArray(entry.lines) ? entry.lines : [];
  if (!lines.length) {
    return [{ ...base, key: keyFallback || entry.opKey, scopeLabel: '', field: entry.summary || 'изменение', from: '', to: '' }];
  }
  return lines.map((l, i) => ({
    ...base,
    key: `${keyFallback || entry.opKey}::${i}`,
    scopeLabel: TRIP_HISTORY_SCOPE_LABELS[l.scope] || '',
    field: l.field,
    from: l.from,
    to: l.to,
  }));
};

/**
 * Старая история плана (planGuard.history) → строки для показа в общем блоке.
 * Поля не выдумываются: нет автора — «Неизвестно», нет времени — «Не зафиксировано».
 */
export const legacyPlanHistoryViews = (history: TimelinePlanHistoryEntry[] | null | undefined): TripHistoryView[] =>
  (Array.isArray(history) ? history : []).map((h, i) => {
    const atMs = tripHistoryAtMs(h?.at);
    const label = LEGACY_PLAN_HISTORY_LABELS[String(h?.action || '')] || String(h?.action || 'изменение плана');
    return {
      key: `legacy::${i}::${hashOf(`${h?.at || ''}#${h?.by || ''}#${label}`)}`,
      atMs,
      atLabel: fmtHistoryDateTime(atMs),
      byLabel: String(h?.by || '').trim() || 'Неизвестно',
      sourceLabel: 'До перехода',
      scopeLabel: '',
      field: label,
      from: '',
      to: '',
      note: String(h?.note || ''),
      legacy: true,
    };
  });

/**
 * Живая история + старая история плана, СВЕРХУ СВЕЖИЕ: сортировка по времени
 * внесения (не по дате этапа), при равенстве — стабильный порядок по ключу.
 * Legacy-записи показываются в конце своей позиции (равное время — внизу).
 */
export const mergeTripHistoryViews = (
  live: Array<{ key: string; entry: TripHistoryEntry }>,
  legacy: TimelinePlanHistoryEntry[] | null | undefined,
): TripHistoryView[] => {
  const liveViews = live.flatMap(({ key, entry }) => tripHistoryEntryViews(entry, key));
  const legacyViews = legacyPlanHistoryViews(legacy);
  const all = [...liveViews, ...legacyViews];
  return all.sort((a, b) => {
    const am = a.atMs ?? Number.NEGATIVE_INFINITY;
    const bm = b.atMs ?? Number.NEGATIVE_INFINITY;
    if (am !== bm) return bm - am;
    if (a.legacy !== b.legacy) return a.legacy ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
};

/** Разбор снимка истории из базы: `{opKey: entry}` → список для показа. */
export const tripHistoryLiveFromStore = (
  store: Record<string, unknown> | null | undefined,
): Array<{ key: string; entry: TripHistoryEntry }> =>
  Object.entries(store || {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => {
      const raw = v as Partial<TripHistoryEntry>;
      return {
        key,
        entry: {
          at: tripHistoryAtMs(raw.at),
          by: String(raw.by || ''),
          ...(raw.byUid ? { byUid: String(raw.byUid) } : {}),
          source: (raw.source as TripHistorySource) || 'system',
          opKey: String(raw.opKey || key),
          ...(raw.summary ? { summary: String(raw.summary) } : {}),
          lines: Array.isArray(raw.lines) ? raw.lines : [],
        } as TripHistoryEntry,
      };
    });

/** Строка «Показать ещё» порцией: сколько показать и сколько осталось. */
export const historyPageSlice = <T,>(items: T[], shown: number, step: number): { visible: T[]; hidden: number } => {
  const count = Math.max(0, Math.min(items.length, shown));
  return { visible: items.slice(0, count), hidden: Math.max(0, items.length - count) };
};

/** Поля записи «Плана дохода», изменение которых попадает в историю рейса. */
export const PLAN_TRACKED_FIELDS: Array<{ key: 'dateStart' | 'dateEnd' | 'circles' | 'direction'; label: string }> = [
  { key: 'dateStart', label: 'Старт' },
  { key: 'dateEnd', label: 'Возвращение' },
  { key: 'circles', label: 'Количество кругов' },
  { key: 'direction', label: 'Направление' },
];

/**
 * Строки изменений записи «Плана дохода» (путь `pdService.updateTrip`): берём
 * только плановые поля рейса — финансы/расходы в историю рейса не попадают.
 */
export const planRecordHistoryLines = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): TripHistoryLine[] => {
  const b = before || {};
  const a = after || {};
  const lines: TripHistoryLine[] = [];
  const text = (v: unknown): string => String(v ?? '').trim();
  PLAN_TRACKED_FIELDS.forEach(({ key, label }) => {
    const bv = text(b[key]);
    const av = text(a[key]);
    if (bv === av) return;
    if (key === 'dateStart' || key === 'dateEnd') {
      lines.push({ scope: 'plan', field: label, from: fmtHistoryDay(bv), to: fmtHistoryDay(av) });
    } else if (key === 'circles') {
      const bN = Math.max(1, Math.floor(Number(bv)) || 1);
      const aN = Math.max(1, Math.floor(Number(av)) || 1);
      if (bN !== aN) lines.push({ scope: 'plan', field: label, from: String(bN), to: String(aN) });
    } else {
      lines.push({ scope: 'plan', field: label, from: bv || 'не указано', to: av || 'не указано' });
    }
  });
  return lines;
};
