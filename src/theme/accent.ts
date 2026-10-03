/**
 * Акцентная тема интерфейса.
 *
 * Один источник акцента на весь портал. Компоненты не хранят цвет у себя —
 * они берут CSS-переменные (--accent, --accent-ink, --accent-on, оттенки),
 * а значения переменных ставит applyAccentTheme() по выбору пользователя.
 *
 * Почему так: раньше акцент был вписан шестнадцатеричными значениями в десятках
 * файлов, поэтому смена цвета была невозможна. Теперь цвет выбирается в
 * настройках учётной записи, хранится в профиле (users_list/{uid}.accentColor)
 * и применяется при входе — в том числе между сеансами.
 *
 * Контраст. Для каждого варианта считаются: ink (цвет текста на светлом фоне)
 * и on (цвет текста на плашке акцента). Если исходный оттенок не даёт 4.5:1,
 * оттенок затемняется до достижения нормы — «адаптируй оттенок или используй
 * контрастный цвет текста» из требований.
 */

export interface AccentPreset {
  id: string;
  name: string;
  /** Основной оттенок: заливки-графика, рамки, кольца, размытое пятно, оттенки. */
  hex: string;
}

export interface AccentTheme {
  id: string;
  name: string;
  /** Основной оттенок: декоративные пятна, градиенты, прозрачные оттенки. */
  hex: string;
  /** Текст и ссылки на светлом фоне мелким кеглем (норма 4.5:1). */
  ink: string;
  /**
   * Акцентный текст крупным кеглем (заголовки, приветствие): сам цвет акцента,
   * затемнённый ровно настолько, чтобы пройти норму крупного текста 3:1.
   * Для насыщенных оттенков совпадает с акцентом один в один.
   */
  vivid: string;
  /** Графика на светлом фоне: линии, иконки, точки (норма 3:1). */
  ui: string;
  /** Заливка элемента, внутри которого есть текст. */
  solid: string;
  /** Цвет текста на заливке (норма 4.5:1). */
  on: string;
  /** Наведение для заливок с текстом. */
  hover: string;
  /** Наведение для графики. */
  uiHover: string;
  tints: Record<string, string>;
}

/** 20 подобранных вариантов. Первый — текущий оранжевый акцент портала. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'orange', name: 'Оранжевый', hex: '#FF8040' },
  { id: 'terracotta', name: 'Терракота', hex: '#E2562B' },
  { id: 'amber', name: 'Янтарный', hex: '#D97706' },
  { id: 'gold', name: 'Золотой', hex: '#B8860B' },
  { id: 'olive', name: 'Оливковый', hex: '#7C8B1E' },
  { id: 'lime', name: 'Лаймовый', hex: '#65A30D' },
  { id: 'green', name: 'Зелёный', hex: '#16A34A' },
  { id: 'emerald', name: 'Изумрудный', hex: '#059669' },
  { id: 'teal', name: 'Бирюзовый', hex: '#0D9488' },
  { id: 'cyan', name: 'Морской', hex: '#0891B2' },
  { id: 'sky', name: 'Голубой', hex: '#0284C7' },
  { id: 'blue', name: 'Синий', hex: '#3765F6' },
  { id: 'indigo', name: 'Индиго', hex: '#4F46E5' },
  { id: 'violet', name: 'Фиолетовый', hex: '#7C3AED' },
  { id: 'purple', name: 'Пурпурный', hex: '#9333EA' },
  { id: 'magenta', name: 'Маджента', hex: '#C026D3' },
  { id: 'pink', name: 'Розовый', hex: '#DB2777' },
  { id: 'rose', name: 'Малиновый', hex: '#E11D48' },
  { id: 'brown', name: 'Коричневый', hex: '#92400E' },
  { id: 'graphite', name: 'Графитовый', hex: '#475569' },
];

export const DEFAULT_ACCENT_ID = 'orange';

/** Нормы контраста: обычный текст — 4.5:1, крупный текст и элементы управления — 3:1. */
const TEXT_TARGET = 4.5;
const LARGE_TEXT_TARGET = 3;
const UI_TARGET = 3;
/** Цвет текста на светлом фоне, когда сам акцент слишком светлый. */
const DARK_TEXT = '#121316';

const clamp = (v: number, min = 0, max = 255) => Math.min(max, Math.max(min, v));

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '').trim();
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Относительная яркость по WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Коэффициент контраста двух цветов по WCAG 2.x. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Смешение цвета с белым (t = 0 — исходный, t = 1 — белый). */
export function lighten(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
}

/** Смешение цвета с чёрным (t = 0 — исходный, t = 1 — чёрный). */
export function darken(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * (1 - t), g * (1 - t), b * (1 - t)]);
}

/** Затемнение до нужного контраста с фоном — «адаптируй оттенок». */
function shadeUntilContrast(hex: string, background: string, target: number): string {
  if (contrastRatio(hex, background) >= target) return hex.toUpperCase();
  let current = hex;
  for (let step = 0; step < 20; step += 1) {
    current = darken(current, 0.06);
    if (contrastRatio(current, background) >= target) return current;
  }
  return current;
}

/**
 * Минимально необходимое затемнение под порог контраста: бинарный поиск доли
 * затемнения. Грубый шаг (6%) уводил оттенок заметно темнее нужного — оранжевый
 * текст выглядел коричневым. Ищем самое лёгкое затемнение, которое проходит норму,
 * и откатываемся на шаг, если после округления контраст упал ниже.
 */
function brightestPassing(hex: string, background: string, target: number): string {
  if (contrastRatio(hex, background) >= target) return hex.toUpperCase();
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(darken(hex, mid), background) >= target) hi = mid;
    else lo = mid;
  }
  let best = darken(hex, hi);
  for (let i = 0; i < 6 && contrastRatio(best, background) < target; i += 1) {
    hi = Math.min(1, hi + 0.01);
    best = darken(hex, hi);
  }
  return best;
}

/**
 * Цвет акцентного текста и иконок.
 *
 * Решение владельца (Сергей): акцентный текст должен совпадать с оранжевым
 * кнопок (#FF8040) — «везде этот оранжевый». Поэтому ink = сам акцентный цвет,
 * без затемнения: брендовое единство важнее нормы 4.5:1 на светлом фоне.
 * Функция brightestPassing оставлена в файле — если потребуется вернуть
 * контрастную норму, достаточно снова вызвать её здесь.
 */
export function inkFor(hex: string, _background = '#FFFFFF'): string {
  return hex.toUpperCase();
}

/**
 * Цвет текста на плашке акцента: белый, если он даёт норму, иначе тёмный.
 * Светлые оттенки (оранжевый, золотой, лаймовый) дают с белым меньше 4.5:1 —
 * для них берётся тёмный текст, а не осветление плашки.
 */
export function textOn(hex: string): string {
  if (contrastRatio(hex, '#FFFFFF') >= TEXT_TARGET) return '#FFFFFF';
  if (contrastRatio(hex, DARK_TEXT) >= TEXT_TARGET) return DARK_TEXT;
  return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, DARK_TEXT) ? '#FFFFFF' : DARK_TEXT;
}

/** Оттенок для заливки под текстом: при нехватке контраста темнеет до нормы. */
function solidFor(hex: string, on: string): string {
  if (contrastRatio(hex, on) >= TEXT_TARGET) return hex.toUpperCase();
  return shadeUntilContrast(hex, on, TEXT_TARGET);
}

/** Прозрачные оттенки акцента — заливки, рамки, кольца фокуса. */
const TINT_LEVELS = [5, 8, 10, 15, 20, 25, 30, 40, 45, 50, 60];

function buildTints(hex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(hex);
  const out: Record<string, string> = {};
  for (const level of TINT_LEVELS) {
    out[String(level)] = `rgba(${r}, ${g}, ${b}, ${(level / 100).toFixed(2)})`;
  }
  return out;
}

/** Полный набор значений темы для выбранного варианта. */
export function resolveAccentTheme(id?: string | null): AccentTheme {
  const preset = ACCENT_PRESETS.find((p) => p.id === id) || ACCENT_PRESETS.find((p) => p.id === DEFAULT_ACCENT_ID)!;
  const hex = preset.hex.toUpperCase();
  const on = textOn(hex);
  const solid = solidFor(hex, on);
  const ui = shadeUntilContrast(hex, ACCENT_BASE_LIGHT, UI_TARGET);
  // Крупный акцентный текст: минимум вмешательства в оттенок — только до 3:1
  const vivid = shadeUntilContrast(hex, ACCENT_BASE_LIGHT, LARGE_TEXT_TARGET);
  return {
    id: preset.id,
    name: preset.name,
    hex,
    // Текст: норма 4.5:1 к самому тёмному рабочему фону портала
    ink: inkFor(hex, ACCENT_BASE_LIGHT),
    // Графика: норма 3:1 к тому же фону
    ui,
    vivid,
    solid,
    on,
    // Наведение не ухудшает читаемость: при тёмном тексте плашка светлеет,
    // при светлом — темнеет. Так норма 4.5:1 сохраняется и на наведении.
    hover: (on === DARK_TEXT ? lighten(solid, 0.1) : darken(solid, 0.12)).toUpperCase(),
    uiHover: darken(ui, 0.12),
    tints: buildTints(hex),
  };
}

/**
 * Применить тему: значения уходят в CSS-переменные на корне документа.
 * Компоненты читают только переменные, поэтому переключение мгновенное.
 */
export function applyAccentTheme(id?: string | null, root?: HTMLElement | null): AccentTheme {
  const theme = resolveAccentTheme(id);
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (el) {
    const set = (name: string, value: string) => el.style.setProperty(name, value);
    set('--accent', theme.hex);
    set('--accent-ink', theme.ink);
    set('--accent-vivid', theme.vivid);
    set('--accent-ui', theme.ui);
    set('--accent-solid', theme.solid);
    // Текст на акцентной заливке — белый (требование Сергея: везде белый вместо тёмного).
    // Сам оттенок заливки не меняется: theme.on (вариант с лучшим контрастом) остаётся
    // во внутренних расчётах темы — по нему считаются заливка, наведение и проверки.
    set('--accent-on', '#FFFFFF');
    set('--accent-hover', theme.hover);
    set('--accent-ui-hover', theme.uiHover);
    for (const [level, value] of Object.entries(theme.tints)) set(`--accent-${level}`, value);
    el.setAttribute('data-accent', theme.id);
  }
  return theme;
}

/**
 * Текущее значение акцента для JS-свойств (карты Leaflet, инлайновые стили):
 * читаем ту же CSS-переменную, что и остальной интерфейс, поэтому карта и
 * легенда не расходятся с выбранной темой. До применения темы — значение по умолчанию.
 */
export function currentAccentColor(kind: 'base' | 'ui' | 'solid' | 'ink' | 'on' = 'ui'): string {
  const fallbackTheme = resolveAccentTheme(DEFAULT_ACCENT_ID);
  const fallbackValue = kind === 'base' ? fallbackTheme.hex : fallbackTheme[kind];
  if (typeof document === 'undefined') return fallbackValue;
  const varName = kind === 'base' ? '--accent' : `--accent-${kind}`;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallbackValue;
}

/** Ближайший светлый фон портала — используется при проверке контраста. */
export const ACCENT_LIGHT_BACKGROUNDS = ['#FFFFFF', '#F9FAFB', '#F3F4F6'];
/** Опорный светлый фон портала — самый тёмный из рабочих. По нему считаем нормы. */
export const ACCENT_BASE_LIGHT = '#F3F4F6';

/** Проверка контраста темы: текст на светлом, текст на плашке, элементы управления. */
export function auditAccentTheme(id?: string | null) {
  const theme = resolveAccentTheme(id);
  return {
    ...theme,
    inkOnWhite: contrastRatio(theme.ink, '#FFFFFF'),
    inkOnLight: Math.min(...ACCENT_LIGHT_BACKGROUNDS.map((bg) => contrastRatio(theme.ink, bg))),
    onSolid: contrastRatio(theme.solid, theme.on),
    onHover: contrastRatio(theme.hover, theme.on),
    // Контраст фактического цвета текста в интерфейсе — белого (--accent-on).
    whiteOnSolid: contrastRatio(theme.solid, '#FFFFFF'),
    whiteOnHover: contrastRatio(theme.hover, '#FFFFFF'),
    uiOnLight: contrastRatio(theme.ui, ACCENT_BASE_LIGHT),
    accentOnLight: contrastRatio(theme.hex, ACCENT_BASE_LIGHT),
    inkTarget: TEXT_TARGET,
    uiTarget: UI_TARGET,
  };
}
