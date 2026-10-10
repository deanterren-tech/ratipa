/**
 * Типы движка проверки пробега по рейсу (модуль «Пробег и связь», этап 2).
 *
 * Движок — чистые функции: на входе измерения, интервалы отчёта Nav.by и
 * параметры; на выходе — участки, стоянки, сценарии, сводка. Никаких
 * вердиктов о «накрутке»: только наблюдаемые значения, основания и
 * ограничения данных.
 */

/** Точность границы рейса: даты источника — только дни (ложная точность не создаётся). */
export type BoundaryPrecision = 'minute' | 'day';

/** Откуда взяты границы анализа. */
export type BoundarySource = 'fact' | 'plan' | 'plan_current' | 'manual';

export interface TripWindow {
  carKey: string;
  /** Ключ рейса: `pd:<id>` записи «Плана дохода» (параллельный реестр не создаётся). */
  tripKey: string;
  fromMs: number;
  toMs: number;
  fromPrecision: BoundaryPrecision;
  toPrecision: BoundaryPrecision;
  source: BoundarySource;
  /** Рейс продолжается: конец не наступил, анализ предварительный. */
  ongoing: boolean;
  /** Что показать пользователю про выбранные границы. */
  fromLabel: string;
  toLabel: string;
  sourceLabel: string;
  warnings: string[];
}

/** Измерение портала (из telemetry_history/telemetry_current). */
export interface MeasureSample {
  /** coordAtMs — время координаты (UTC мс). */
  atMs: number;
  coordAt: string | null;
  lat: number | null;
  lon: number | null;
  posValid: boolean;
  speed: number | null;
  /** Одометр (odom_can), км; null — не передаётся. */
  odoKm: number | null;
  satellites: number | null;
  odoSource: string | null;
  receivedAtMs: number | null;
  /** Признак: координата устарела на момент получения (receivedAt − coordAt > порога). */
  staleOnArrival?: boolean;
}

/** Нормализованный интервал отчёта Nav.by «Стоянка-движение». */
export interface ParkingIntervalRaw {
  inMotion: boolean;
  startMs: number;
  endMs: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  startOdoKm: number | null;
  endOdoKm: number | null;
}

export interface Interval {
  fromMs: number;
  toMs: number;
}

/** Способ определения стоянки. */
export type StopMethod = 'navby_parking_report' | 'portal_sequence';
export type StopCategory = 'confirmed' | 'presumed';

export interface StopQuality {
  /** Измерений портала внутри стоянки. */
  samplesInside: number;
  /** Максимальный разрыв между измерениями внутри (мс), null — нет пары. */
  maxGapMs: number | null;
  /** Кол-во измерений внутри с движением (включая одиночные точки). */
  movingInside: number;
  /** Метки проблем (исключённые выбросы и т.п.). */
  tags: string[];
}

export interface Stop {
  id: string;
  method: StopMethod;
  category: StopCategory;
  startMs: number;
  endMs: number;
  durationMin: number;
  lat: number | null;
  lon: number | null;
  /** Человеческое обоснование определения. */
  basis: string;
  quality: StopQuality;
}

/** Технические события/отметки на шкале рейса. */
export type TechEventKind =
  | 'reset'            // сброс/уменьшение счётчика (по данным)
  | 'source_change'    // смена источника одометра (по данным)
  | 'rebind'           // смена привязки трекера (по истории привязок)
  | 'journal';         // техническая отметка сотрудника

export interface TechEvent {
  id: string;
  kind: TechEventKind;
  atMs: number;
  label: string;
  /** origin: data — выведено из измерений; mapping — история привязок; journal — отметка сотрудника. */
  origin: 'data' | 'mapping' | 'journal';
  detail?: string;
}

/** Участок непрерывного счётчика (не склеиваем через сброс/смену источника). */
export interface CounterSegment {
  index: number;
  fromMs: number;
  toMs: number;
  /** Измерений в участке. */
  sampleCount: number;
  /** Причина разрыва перед участком (для участков index>0). */
  breakReason: string | null;
}

export type ScenarioKind = 'A' | 'B' | 'C' | null;

export interface StopAnalysis {
  stopId: string;
  /** Последнее пригодное измерение до стоянки (в окне анализа до). */
  before: MeasureSample | null;
  /** Измерения во время стоянки (с пригодным одометром или координатой). */
  during: MeasureSample[];
  /** Первое пригодное измерение после стоянки. */
  after: MeasureSample | null;
  odoBeforeKm: number | null;
  odoAfterKm: number | null;
  /** Прирост между до и после (наблюдаемый интервал; null — не вычислим). */
  riseKm: number | null;
  /** Прирост между измерениями ВНУТРИ стоянки (нужно ≥2 пригодных). */
  riseWithinStopKm: number | null;
  /** Прирост на возобновлении движения (первое «после» минус последнее перед ним). */
  riseResumeKm: number | null;
  /** Темп прироста на возобновлении, км/ч. */
  resumeRateKmh: number | null;
  scenario: ScenarioKind;
  severity: 'none' | 'info' | 'check';
  /** Название события (для таблиц/списков) или null. */
  title: string | null;
  rule: string | null;
  /** Основания события: правило, интервал, исходные значения. */
  explanation: string[];
  /** Ограничения данных: чего не хватает для вывода. */
  limits: string[];
  /** GPS-пробег на том же наблюдаемом интервале (по пригодным парам). */
  gpsKmSameInterval: number | null;
  gapsInside: Interval[];
  /** Первое измерение после стоянки уже в движении — прирост отнесён к возобновлению. */
  resumeAlreadyMoving: boolean;
}

export type GainKind = 'normal' | 'stop_rise' | 'resume' | 'gap' | 'reset' | 'gps_gap';

/** Интервал между двумя соседними измерениями (столбик второго графика). */
export interface GainInterval {
  fromMs: number;
  toMs: number;
  durationMin: number;
  fromOdoKm: number | null;
  toOdoKm: number | null;
  deltaKm: number | null;
  /** Темп прироста, км/ч (null — нулевая/неизвестная длительность или нет прироста). */
  rateKmh: number | null;
  kind: GainKind;
  stopId: string | null;
  /** Разрыв данных внутри интервала (нет измерений дольше порога). */
  gapInside: boolean;
  /** Измерения непригодны (телепорт координат и т.п.) — прирост не считаем. */
  invalid: boolean;
  quality: 'ok' | 'no_odo' | 'reset' | 'gap';
}

/** Период без данных портала (не стоянка — «неизвестный период»). */
export interface UnknownPeriod extends Interval {
  reason: string;
}

export interface TripEventRow {
  id: string;
  kind: 'stop_A' | 'stop_B' | 'gap_rise' | 'move_rate' | 'reset' | 'source_change';
  severity: 'info' | 'check';
  title: string;
  stopId: string | null;
  interval: Interval;
  deltaKm: number | null;
  /** Интервал прироста (для «Прирост на отмеченных интервалах»). */
  riseInterval: Interval | null;
  riseKm: number | null;
  rule: string;
  explanation: string[];
  /** Технический контекст (событие совпало с техотметкой) — не закрывает проверку. */
  techNearby: TechEvent | null;
}

export interface TripSummary {
  /** Прирост одометра за рейс (конец минус начало), км; null — не вычислим корректно. */
  odoGainKm: number | null;
  odoGainReason: string | null;
  baselineKm: number | null;
  lastOdoKm: number | null;
  /** Заявленный километраж из источника (план/факт плана дохода). */
  planKm: number | null;
  factKm: number | null;
  declaredSourceLabel: string;
  /** GPS-сравнение на сопоставимых (покрытых) участках. */
  gpsCoveredKm: number | null;
  odoOnGpsIntervalsKm: number | null;
  gpsCoveragePct: number | null;
  gpsCompareNote: string;
  /** Время: подтверждённые измерениями интервалы и неизвестные. */
  verifiedMs: number;
  unknownMs: number;
  totalWindowMs: number;
  dataCompletenessPct: number;
  stopsTotal: number;
  stopsWithEvents: number;
  eventsOnStops: number;
  eventsInMotion: number;
  openChecks: number;
  /** Сумма приростов на отмеченных интервалах БЕЗ пересечений; подпись обязательна. */
  flaggedGainKm: number | null;
  flaggedNote: string;
}

export interface CheckJournalEntry {
  at: string;
  atMs: number;
  by: string;
  byId?: string;
  action: string;
  note?: string;
  /** Привязка к стоянке/событию, если есть. */
  stopId?: string;
}

/** Техническая отметка сотрудника (техработы, замена трекера, настройка счётчика). */
export interface TechMarkRecord {
  id: string;
  atMs: number;
  kind: 'works' | 'tracker_replace' | 'odo_setting';
  label: string;
  comment?: string;
  by: string;
  byId?: string;
}

/** Уточнённые границы анализа (уполномоченный сотрудник), мс. */
export interface BoundsOverride {
  fromMs: number;
  toMs: number;
  comment?: string;
  by: string;
  byId?: string;
  at: string;
}

export interface TripAnalysisResult {
  window: TripWindow;
  segments: CounterSegment[];
  stops: Array<{ stop: Stop; analysis: StopAnalysis }>;
  unknowns: UnknownPeriod[];
  gains: GainInterval[];
  techEvents: TechEvent[];
  events: TripEventRow[];
  summary: TripSummary;
  /** Данные отчёта Nav.by: доступен ли и что вернул. */
  report: { available: boolean; reason: string | null; fetchedAt: string | null };
  /** Сколько измерений реально в окне (после фильтра) — для честности UI. */
  samplesInWindow: number;
}
