/**
 * Направления рейсов на таймлайне (метки-чипы, фильтр, раскраска).
 *
 * ЕДИНЫЙ СПРАВОЧНИК — тот же, что у «Плана дохода»: ветка
 * `directories/directions` (название/код/идентификатор записи; поле `direction`
 * записи хранит НАЗВАНИЕ — см. lib/directionCatalog). Отдельного списка у
 * таймлайна больше НЕТ: `DEFAULT_DIRECTIONS` — это та же встроенная пара
 * (Турция TR, Китай CN) из directionCatalog.BUILTIN_DIRECTIONS, лишь с цветами;
 * она нужна только пока справочник пуст/не загружен, чтобы чипы и фильтр
 * работали. Ветка `directories/tripDirections` читается ТОЛЬКО как источник
 * цвета по названию (историческая палитра) и список направлений не задаёт.
 *
 * КРУГИ в этом модуле БОЛЬШЕ НЕ СЧИТАЮТСЯ: старый расчёт «круги машины»
 * (рейс на внешнем направлении внутри периода учёта выезда) удалён. Круги
 * относятся к рейсу и хранятся в поле записи «circles» — единое правило
 * lib/circles (normalizeCircles, tripCircleMarksOf). Направления остаются
 * здесь: определение направления рейса (`directionOfTrip`) и метки-чипы.
 */
import { BUILTIN_DIRECTIONS, normalizeDirectionCode } from './directionCatalog';
import type { WholeTrip } from './sources';

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

/** Цвета встроенной пары — историческая палитра направлений (сопоставление
 *  «направление → цвет» не меняется); остальные — из DIRECTION_PALETTE. */
const DEFAULT_COLORS: Record<string, string> = {
  'турция': '#4FA3A5',
  'китай': '#5E7BB6',
};

/**
 * Встроенная пара — из ЕДИНОГО источника (directionCatalog.BUILTIN_DIRECTIONS):
 * те же названия, коды и ids, что у переключателя рейса; справочник «Плана
 * дохода» (`directories/directions`) несёт ровно эти названия/коды. Нужна
 * только пока справочник пуст или ещё не загружен — чипы и фильтр работают.
 */
export const DEFAULT_DIRECTIONS: DirectionDef[] = BUILTIN_DIRECTIONS.map((b, i) => ({
  id: b.id,
  name: b.name,
  code: b.code,
  color: DEFAULT_COLORS[b.name.toLowerCase()] || DIRECTION_PALETTE[i % DIRECTION_PALETTE.length],
  order: b.order,
  builtin: true,
}));

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

const isHex = (s: unknown): boolean => /^#[0-9a-fA-F]{6}$/.test(String(s || ''));

/** Код из названия, если пользователь не указал: первые две буквы. */
const autoCode = (name: string): string =>
  String(name || '')
    .trim()
    .slice(0, 2)
    .toUpperCase();

/**
 * Список направлений таймлайна из ЕДИНОГО справочника «Плана дохода»
 * (`directories/directions`). Идентификаторы/названия/коды — записи справочника
 * (совпадают с тем, что видит план дохода); встроенная пара Турция/Китай
 * добавляется, только если записи нет (пустой справочник), и не удаляется.
 *
 * Второй аргумент (`colorList`, ветка `directories/tripDirections`) — только
 * историческое перекрытие ЦВЕТА по названию; список направлений он не задаёт.
 *
 * Порядок — по `order` записи (Турция 1, Китай 2, прочие — после), затем по
 * названию; так же упорядочены переключатель рейса и список «Плана дохода».
 */
export const mergeDirections = (
  dirList: Array<Record<string, unknown>> | null | undefined,
  colorList?: Array<Record<string, unknown>> | null | undefined,
): DirectionDef[] => {
  const colors = new Map<string, string>();
  (colorList || []).forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const name = norm(c.name || c.label);
    if (name && isHex(c.color)) colors.set(name, String(c.color));
  });
  const canonicalPair = (name: string, code: string): DirectionDef | undefined =>
    DEFAULT_DIRECTIONS.find(
      (d) => norm(d.name) === norm(name) || (!!code && d.code === normalizeDirectionCode(code)),
    );
  const rows: DirectionDef[] = (dirList || [])
    .filter((d) => d && typeof d === 'object')
    .map((d, i) => {
      const name = String(d.name || d.label || d.id || '').trim() || `Направление ${i + 1}`;
      const code = normalizeDirectionCode(d.code) || autoCode(name);
      const base = canonicalPair(name, code);
      return {
        id: String(d.id || d.key || base?.id || `td_${i}`),
        name,
        code: code || base?.code || '',
        color: isHex(d.color)
          ? String(d.color)
          : colors.get(norm(name)) || DEFAULT_COLORS[norm(name)] || DIRECTION_PALETTE[i % DIRECTION_PALETTE.length],
        order: Number.isFinite(Number(d.order)) && Number(d.order) > 0 ? Number(d.order) : base?.order ?? 100 + i,
        ...(base ? { builtin: true } : {}),
      } satisfies DirectionDef;
    });
  DEFAULT_DIRECTIONS.forEach((def) => {
    if (!rows.some((r) => norm(r.name) === norm(def.name) || (!!r.code && r.code === def.code))) {
      rows.push({ ...def, ...(colors.has(norm(def.name)) ? { color: colors.get(norm(def.name))! } : {}) });
    }
  });
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
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
 * Направление рейса: поле записи (`direction` — код «TR»/«CN» у новых, текст
 * «Китай»/«Турция» у старых), далее поле записи плана, иначе — из текста
 * маршрута существующим способом. null — направление честно неизвестно.
 */
export const directionOfTrip = (t: WholeTrip, dirs: DirectionDef[]): DirectionDef | null =>
  resolveDirection(t.direction || '', dirs) ||
  resolveDirection(t.plan?.direction || '', dirs) ||
  resolveDirection(t.route || '', dirs);

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
