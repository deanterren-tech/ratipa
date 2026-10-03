/**
 * Общий визуальный слой Ratipa Portal (новый дизайн, образец — «Учёт дозволов»).
 *
 * Единственный источник классов для разделов, приводимых к стилю «Учёта дозволов».
 * Значения сняты с модуля дозволов один в один, чтобы разделы не расходились.
 *
 * Токены нового дизайна:
 *  #121316 — графит: заголовки, тёмные кнопки, активная вкладка;
 *  var(--accent*) — акцент пользователя (в дозволах это #FF8040);
 *  #F8F9FA — холст страницы;  #F3F4F6 — наведение и тихие плашки;
 *  #E5E7EB — рамки и разделители;  #6B7280 — второстепенный текст;
 *  #9CA3AF — подсказки;  #4B5563 — основной текст.
 *
 * Правила:
 *  - оболочка модуля БЕЗ карточки: заголовок + подчёркнутые вкладки + содержимое на холсте;
 *  - таблицы стоят прямо на холсте, без обёртки в белую карточку;
 *  - статус — точка + цветной текст, а не залитая плашка;
 *  - акцент — сдержанно, только через переменные темы;
 *  - смысл не передаётся одним цветом: у состояния всегда есть текст или значок;
 *  - прозрачность к рамкам не применяется (никаких border-[#E5E7EB]/50).
 */

export const UI = {
  /* ---------- Оболочка раздела ---------- */
  /** Корень модуля: колонка на холсте, без карточки вокруг. */
  shell: 'w-full flex flex-col min-h-full',
  /** Шапка: заголовок и вкладки. */
  shellHeader: 'px-6 sm:px-8 pt-6 pb-2',
  /** Заголовок раздела. */
  title: 'text-2xl sm:text-3xl font-bold tracking-tight text-[#121316]',
  /** Полоса подчёркнутых вкладок. */
  tabsBar: 'mt-4 border-b border-[#E5E7EB] overflow-x-auto scrollbar-none',
  tabsNav: 'flex items-center space-x-6 min-w-max pb-px',
  /** Вкладка: активная — графит + подчёркивание внизу. */
  tab: 'relative py-2.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] rounded-t-sm',
  tabActive: 'text-[#121316] font-semibold',
  tabIdle: 'text-[#6B7280] hover:text-[#121316]',
  /** Подчёркивание активной вкладки. */
  tabUnderline: 'absolute bottom-0 left-0 right-0 h-[2px] bg-[#121316]',
  /** Счётчик на вкладке. */
  tabBadge: 'ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full',
  tabBadgeActive: 'bg-[#121316] text-white',
  tabBadgeIdle: 'bg-[#E5E7EB] text-[#4B5563]',
  /** Область содержимого раздела. */
  content: 'px-6 sm:px-8 py-5',

  /* ---------- Заголовки и подписи ---------- */
  sectionHeader: 'flex items-center justify-between pb-3 border-b border-[#E5E7EB]',
  sectionTitle: 'text-sm font-semibold text-[#121316]',
  sectionSubtitle: 'text-xs text-[#6B7280]',
  /** Мелкая прописная метка над таблицей/блоком. */
  caption: 'text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none',
  /** Подпись поля в форме. */
  fieldLabel: 'text-[11px] font-medium text-[#6B7280]',
  hint: 'text-[11px] text-[#6B7280]',

  /* ---------- Поверхности ---------- */
  /** Панель, которая действительно карточка (редко). */
  card: 'bg-white border border-[#E5E7EB] rounded-2xl shadow-xs',
  /** Компактная панель-строка. */
  bar: 'px-4 py-2.5 bg-white border border-[#E5E7EB] rounded-xl',
  /** Секция, разделённая линией (вместо карточки). */
  section: 'flex flex-col gap-3 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0',
  divider: 'border-t border-[#E5E7EB]',

  /* ---------- Таблица прямо на холсте ---------- */
  tableWrap: 'w-full overflow-x-auto',
  table: 'w-full text-left',
  theadRow: 'border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none',
  th: 'px-3 py-2.5 font-semibold border-b border-[#E5E7EB] text-left',
  thSortable:
    'px-3 py-2.5 font-semibold border-b border-[#E5E7EB] text-left cursor-pointer hover:text-[#121316] select-none whitespace-nowrap',
  tr: 'border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors',
  td: 'px-3 py-2.5 text-xs text-[#4B5563] align-middle',
  tdStrong: 'px-3 py-2.5 text-xs font-semibold text-[#121316] align-middle',
  tdMono: 'px-3 py-2.5 text-xs font-mono font-semibold text-[#121316] align-middle whitespace-nowrap',
  /** Липкая шапка компактной таблицы с внутренней прокруткой. */
  stickyTh: 'sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB]',

  /* ---------- Поля ---------- */
  input:
    'w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] min-h-[44px]',
  inputSm:
    'w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-1.5 text-xs text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]',
  /** Строка поиска — заметный элемент на холсте. */
  searchWrap: 'relative flex-1 max-w-3xl',
  searchIcon: 'absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none',
  searchInput:
    'w-full pl-9 pr-8 py-2 text-xs bg-white border border-[#E5E7EB] rounded-xl outline-none transition-colors placeholder:text-[#9CA3AF] shadow-xs focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]',
  select:
    'bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] min-h-[44px]',
  textarea:
    'w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] leading-relaxed outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]',
  checkbox: 'w-4 h-4 rounded border-[#D1D5DB] text-[var(--accent)] accent-[var(--accent)] cursor-pointer',

  /* ---------- Кнопки ---------- */
  /** Основное действие — акцент. */
  buttonPrimary:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] text-xs font-semibold transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] min-h-[44px]',
  /** Тёмная кнопка — для главного действия без акцента. */
  buttonDark:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#121316] hover:bg-black text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#121316]/20 min-h-[44px]',
  /** Второстепенное действие. */
  buttonGhost:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] min-h-[44px]',
  /** Компактное действие-ссылка внутри строки. */
  buttonLink:
    'inline-flex items-center gap-1 text-[11px] text-[var(--accent-ink)] hover:bg-[var(--accent-10)] rounded-md px-1.5 py-1 transition-colors cursor-pointer',
  buttonIcon:
    'inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]',
  /** Опасное действие. */
  buttonDanger:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-medium transition-colors cursor-pointer min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200',

  /* ---------- Сегментные фильтры ---------- */
  filterPill:
    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]',
  filterPillActive: 'bg-[#121316] text-white',
  filterPillIdle: 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]',
  filterPillDangerActive: 'bg-rose-600 text-white',
  filterPillDangerIdle: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
  filterPillWarnActive: 'bg-amber-500 text-white',
  filterPillWarnIdle: 'bg-amber-50 text-amber-700 hover:bg-amber-100',

  /* ---------- Статусы: точка + текст ---------- */
  status: 'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
  statusDot: 'w-1.5 h-1.5 rounded-full shrink-0',
  /** Чип-значение (номер, вид) — тихий фон, без заливки цветом. */
  chip: 'text-[10px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md whitespace-nowrap',
  /** Счётчик-плашка для списков. */
  countBadge: 'text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#E5E7EB] text-[#4B5563]',

  /* ---------- Состояния ---------- */
  empty: 'py-12 text-center',
  emptyTitle: 'text-xs font-medium text-[#4B5563]',
  emptyText: 'text-xs text-[#6B7280] mt-1',
  emptyAction: 'mt-2 text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer',
  errorBox: 'flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700',
  loading: 'flex items-center justify-center gap-2 py-10 text-xs text-[#6B7280]',

  /* ---------- Модальные окна (единый язык) ---------- */
  modalBackdrop: 'fixed inset-0 z-40 md:z-[5000] flex md:bg-black/40 md:backdrop-blur-[2px] md:items-center md:justify-center md:p-6',
  modalSurface:
    'z-10 w-full bg-white flex flex-col overflow-hidden fixed inset-x-0 top-14 bottom-0 rounded-none md:relative md:border md:border-[#E5E7EB] md:rounded-2xl md:shadow-[0_25px_60px_rgba(0,0,0,0.12)] md:max-h-[90vh]',
  modalHeader: 'flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E5E7EB] shrink-0',
  modalIconTile: 'p-2 bg-[var(--accent-10)] text-[var(--accent-ink)] rounded-lg shrink-0',
  modalTitle: 'text-sm font-semibold text-[#121316]',
  modalSubtitle: 'text-xs text-[#6B7280] mt-0.5',
  modalClose: 'p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0',
  modalBody: 'flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5',
  modalFooter: 'px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] md:pb-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2 shrink-0',
} as const;

/** Склонение: 1 запись, 2 записи, 5 записей. */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/** «Найдено: 12 записей». */
export const foundLabel = (n: number): string => `Найдено: ${n} ${plural(n, 'запись', 'записи', 'записей')}`;

/** Цвета точек статуса (образец — «Учёт дозволов»). */
export const STATUS_DOT: Record<string, string> = {
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  grey: 'bg-[#9CA3AF]',
  stone: 'bg-stone-400',
  graphite: 'bg-[#121316]',
  accent: 'bg-[var(--accent)]',
};
