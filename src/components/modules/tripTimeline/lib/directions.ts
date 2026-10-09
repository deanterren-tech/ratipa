/**
 * Направления рейсов на таймлайне (Турция, Китай и др.).
 *
 * Источник — СУЩЕСТВУЮЩЕЕ поле записи «Плана дохода» `direction` (значения:
 * «Китай», «Турция», …). Если у рейса поля нет — направление выводится из уже
 * собранного текста маршрута (direction → tripNote → цепочка плеч) поиском
 * названия/кода направления; ничего не досочиняется.
 *
 * Справочник направлений: встроенные Турция и Китай (мягкие сине-фиолетовые и
 * бирюзовые цвета — отдельная приглушённая палитра, не конфликтующая со
 * статусными цветами) + записи ветки directories/tripDirections, которые
 * добавляет/меняет пользователь в «Настройках» (название, код, цвет, порядок).
 * Встроенные записи переопределяются справочником по id/названию, но не
 * пропадают: цвет и код остаются даже при пустом справочнике.
 *
 * КРУГИ: отдельного поля в данных нет (проверены все поля trips_dashboard и
 * записей учёта выезда). Правило владельца, внедряется здесь:
 *   круг = один рейс машины на внешнем направлении (направление определено
 *   справочником направлений); номер = порядок рейсов внутри периода учёта
 *   выезда (приезд→выезд) — хронологически по началу рейса; рейсы вне периода
 *   нумеруются сквозной группой «вне периода учёта»;
 *   незавершённый рейс (факт начат, окончание не внесено) = «круг идёт».
 * Функция `circlesOf` — точка истины; интерфейс не меняет данные.
 */
import type { WholeTrip, BasePeriod } from './sources';
import { tripFactEnd, tripSpan } from './timeline';

export interface DirectionDef {
  id: string;
  name: string;
  /** Короткий код для мини-метки (CN, TR…). */
  code: string;
  /** Цвет метки (приглушённый сине-фиолетовый/бирюзовый ряд). */
  color: string;
  /** Порядок в панели и справочнике. */
  order: number;
  /** Встроенное направление (Турция/Китай): редактируется, но не удаляется. */
  builtin?: boolean;
}

/** Отдельная приглушённая палитра направлений (не пересекается со статусами). */
export const DIRECTION_PALETTE = [
  '#5E7BB6', // синий
  '#4FA3A5', // бирюзовый
  '#7C6FBF', // фиолетовый
  '#4E8FB8', // стальной
  '#8E7CC3', // светло-фиолетовый
  '#3E9E8F', // глубокий бирюзовый
  '#6E8FC9', // лавандово-синий
  '#5FA9B5', // морской
];

export const DEFAULT_DIRECTIONS: DirectionDef[] = [
  { id: 'china', name: 'Китай', code: 'CN', color: '#5E7BB6', order: 1, builtin: true },
  { id: 'turkey', name: 'Турция', code: 'TR', color: '#4FA3A5', order: 2, builtin: true },
];

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

const isHex = (s: unknown): boolean => /^#[0-9a-fA-F]{6}$/.test(String(s || ''));

/** Код из названия, если пользователь не указал: первые две буквы. */
const autoCode = (name: string): string =>
  String(name || '')
    .trim()
    .slice(0, 2)
    .toUpperCase();

/**
 * Слияние справочника из базы с встроенными направлениями: записи базы
 * переопределяют встроенные (по id или названию), новые добавляются; порядок —
 * по полю order, затем по названию. Цвет новых — из палитры по кругу.
 */
export const mergeDirections = (dbList: Array<Record<string, unknown>> | null | undefined): DirectionDef[] => {
  const db: DirectionDef[] = (dbList || [])
    .filter((d) => d && typeof d === 'object')
    .map((d, i) => {
      const name = String(d.name || d.label || d.id || '').trim() || `Направление ${i + 1}`;
      return {
        id: String(d.id || d.key || `td_${i}`),
        name,
        code: String(d.code || '').trim().toUpperCase() || autoCode(name),
        color: isHex(d.color) ? String(d.color) : DIRECTION_PALETTE[i % DIRECTION_PALETTE.length],
        order: Number.isFinite(Number(d.order)) ? Number(d.order) : 100 + i,
      } satisfies DirectionDef;
    });
  const out: DirectionDef[] = DEFAULT_DIRECTIONS.map((def) => {
    const o = db.find((x) => x.id === def.id || norm(x.name) === norm(def.name));
    return o ? { ...def, ...o, id: def.id, name: def.name, builtin: true } : { ...def };
  });
  db.forEach((x) => {
    if (!out.some((o) => o.id === x.id || norm(o.name) === norm(x.name))) out.push(x);
  });
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
};

/** Направление по тексту: точное имя/код, затем вхождение имени в текст. */
export const resolveDirection = (text: unknown, dirs: DirectionDef[]): DirectionDef | null => {
  const t = norm(text);
  if (!t) return null;
  return (
    dirs.find((d) => norm(d.name) === t) ||
    dirs.find((d) => d.code && norm(d.code) === t) ||
    dirs.find((d) => norm(d.name).length >= 3 && t.includes(norm(d.name))) ||
    null
  );
};

/**
 * Направление рейса: поле записи плана (`direction`), иначе — из текста
 * маршрута существующим способом. null — направление честно неизвестно.
 */
export const directionOfTrip = (t: WholeTrip, dirs: DirectionDef[]): DirectionDef | null =>
  resolveDirection(t.plan?.direction || '', dirs) || resolveDirection(t.route || '', dirs);

/** Простое смешивание hex-цветов (для мягких заливок чипа/полосы). */
export const mixHex = (hex: string, target: string, ratio: number): string => {
  const a = isHex(hex) ? hex : '#5E7BB6';
  const b = isHex(target) ? target : '#FFFFFF';
  const r = Math.round(parseInt(a.slice(1, 3), 16) * (1 - ratio) + parseInt(b.slice(1, 3), 16) * ratio);
  const g = Math.round(parseInt(a.slice(3, 5), 16) * (1 - ratio) + parseInt(b.slice(3, 5), 16) * ratio);
  const bl = Math.round(parseInt(a.slice(5, 7), 16) * (1 - ratio) + parseInt(b.slice(5, 7), 16) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
};

export interface DirectionChipColors {
  bg: string;
  border: string;
  text: string;
  /** Насыщенный цвет (акцент по краю полосы, точка в левой колонке). */
  solid: string;
}

export const directionChipColors = (color: string): DirectionChipColors => ({
  bg: mixHex(color, '#FFFFFF', 0.86),
  border: mixHex(color, '#FFFFFF', 0.5),
  text: mixHex(color, '#121316', 0.35),
  solid: color,
});

// ---------------------------------------------------------------------------
// КРУГИ — правило владельца (единая точка истины)
// ---------------------------------------------------------------------------

/**
 * Круг машины: один рейс на внешнем направлении.
 *  - n — номер (порядок внутри периода учёта выезда; хронологически);
 *  - ongoing — «круг идёт»: факт начат (есть фактический старт), окончание
 *    не внесено, рейс не архивный;
 *  - periodKey/periodText — период учёта выезда, внутри которого начался рейс
 *    (или null — «вне периода учёта», сквозная нумерация).
 */
export interface TripCircle {
  n: number;
  tripKey: string;
  dir: DirectionDef | null;
  /** Плановые границы рейса (фолбэк — фактические), дни. */
  a: number;
  b: number;
  fA: number | null;
  fB: number | null;
  ongoing: boolean;
  archived: boolean;
  periodKey: string | null;
  /** Человекочитаемый период: «приезд 12/03 → выезд 20/04». */
  periodText: string | null;
}

const fmtD = (n: number): string => {
  const d = new Date(n * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Дата начала рейса (план, иначе факт) — та же, что у полосы. */
const tripStartDay = (t: WholeTrip): number | null => {
  const ov = t.spanOverride || {};
  const span = tripSpan(t);
  return ov.pMin ?? span.pMin ?? span.fMin ?? null;
};

/**
 * Круги всех машин: Map carKey → список кругов (по возрастанию номера).
 * Внешнее направление = directionOfTrip(t) != null (справочник направлений).
 * Рейсы без дат начала пропускаются (номер не выдумывается).
 */
export const circlesOf = (
  trips: WholeTrip[],
  dirs: DirectionDef[],
  bases: BasePeriod[],
): Map<string, TripCircle[]> => {
  const byCar = new Map<string, WholeTrip[]>();
  const seen = new Set<string>();
  trips.forEach((t) => {
    if (!t.carKey || seen.has(t.key)) return;
    if (directionOfTrip(t, dirs) == null) return; // внешнее направление — только определённые
    if (tripStartDay(t) == null) return;
    seen.add(t.key);
    const arr = byCar.get(t.carKey);
    if (arr) arr.push(t);
    else byCar.set(t.carKey, [t]);
  });

  const out = new Map<string, TripCircle[]>();
  byCar.forEach((list, carKey) => {
    const carBases = bases.filter((p) => p.carKey === carKey && p.arrivalDay != null);
    const sorted = [...list].sort((x, y) => (tripStartDay(x) as number) - (tripStartDay(y) as number) || x.key.localeCompare(y.key));
    /** Счётчик номера внутри группы (период учёта / вне периода). */
    const counters = new Map<string, number>();
    const circles: TripCircle[] = [];
    sorted.forEach((t) => {
      const start = tripStartDay(t) as number;
      const span = tripSpan(t);
      const ov = t.spanOverride || {};
      const a = ov.pMin ?? span.pMin ?? span.fMin ?? start;
      const b = Math.max(a, ov.pMax ?? span.pMax ?? span.fMax ?? a);
      // Период учёта выезда, внутри которого начался рейс (приезд → выезд).
      const hit = carBases
        .filter((p) => {
          const end = p.departureDay ?? p.plannedReadyDay ?? null;
          return start >= (p.arrivalDay as number) && (end == null || start <= end);
        })
        .sort((x, y) => (y.arrivalDay as number) - (x.arrivalDay as number))[0];
      const groupKey = hit ? hit.key : '∅';
      const n = (counters.get(groupKey) || 0) + 1;
      counters.set(groupKey, n);
      const ongoing = span.fMin != null && tripFactEnd(t) == null && !t.archived;
      circles.push({
        n,
        tripKey: t.key,
        dir: directionOfTrip(t, dirs),
        a,
        b,
        fA: span.fMin,
        fB: span.fMax,
        ongoing,
        archived: !!t.archived,
        periodKey: hit ? hit.key : null,
        periodText: hit
          ? `приезд ${fmtD(hit.arrivalDay as number)} → ${hit.departureDay != null ? `выезд ${fmtD(hit.departureDay)}` : 'выезд не указан'}`
          : null,
      });
    });
    out.set(carKey, circles);
  });
  return out;
};

/** Подсказка по кругу: номер, направление, даты, состояние. */
export const circleTitleOf = (c: TripCircle, total: number): string => {
  const dir = c.dir ? c.dir.name : 'направление не определено';
  const dates =
    c.fA != null
      ? `факт: ${fmtD(c.fA)} – ${c.ongoing ? 'идёт (окончание не внесено)' : c.fB != null ? fmtD(c.fB) : '—'}`
      : `план: ${fmtD(c.a)} – ${c.b > c.a ? fmtD(c.b) : 'дата окончания не указана'}`;
  const per = c.periodText ? ` · период учёта выезда: ${c.periodText}` : ' · вне периода учёта выезда';
  const state = c.ongoing ? ' · круг идёт (рейс не завершён)' : c.archived ? ' · архив' : '';
  return `Круг ${c.n} из ${total} · ${dir}${state}\n${dates}${per}${c.archived ? ' · архивный рейс' : ''}`;
};
