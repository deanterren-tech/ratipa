/**
 * dozvolaRegistryFilter — чистые правила отбора строк реестра дозволов.
 *
 * Вынесены из DozvolaRegistryList, чтобы:
 *  — фильтрация строк пересчитывалась при ЛЮБОМ изменении вкладки статуса,
 *    уточнения, фильтров, поиска и данных (первопричина жалобы «таблица не
 *    обновляется при переключении вкладки» — мемоизация не учитывала вкладку
 *    в зависимостях и отдавала список предыдущей выборки до перезагрузки);
 *  — правила отбора были покрыты юнит-тестами без React (scripts/test-dozvola-tabs.ts).
 *
 * СМЫСЛ ВКЛАДОК НЕ ИЗМЕНЯЕТСЯ (как в модуле и раньше):
 *  — «Все статусы» — всё, кроме завершённых (сдан в ТИ / аннулирован / использован);
 *  — «Архив» — только сданные в ТИ (status = used);
 *  — «Использован» — только возвращённые (status = office_return);
 *  — «Утерянные / аннулированные» — утерянные и аннулированные (lost / expired),
 *    с уточнением «Аннулирован» / «Утерян» / «Оба статуса»;
 *  — «expiring» (доступен только из URL) — бланки со сроком в пределах 30 дней.
 *
 * Вид дозвола (type) фильтруется ДО вызова — так счётчики вкладок считаются
 * внутри выбранного вида, как и раньше.
 */

/** Строка реестра: реальные поля записи dozvolsRegistryV4 (остальное — необязательно). */
export interface DozvolaRegistryItem {
  id: string;
  status?: string;
  type?: string;
  number?: string;
  permitNumber?: string;
  car?: string;
  assignedVehicle?: string;
  comment?: string;
  comments?: string;
  isCopy?: boolean;
  expiryDate?: string | null;
  issueDate?: string;
  [key: string]: unknown;
}

/** Уточнение внутри вкладки «Утерянные / аннулированные». */
export type LostExpiredFilter = 'all' | 'expired' | 'lost';

/** Статусы «бланк завершён»: вкладка «Все статусы» их не показывает. */
const FINAL_STATUSES = ['used', 'expired', 'office_return'];

/**
 * Относится ли запись к вкладке статуса (без учёта вида, поиска и уточнений).
 * `now` параметризован только ради тестируемости вкладки «expiring».
 */
export function statusTabMatches(tab: string, item: DozvolaRegistryItem, now: Date = new Date()): boolean {
  const status = item.status || '';
  if (tab === 'archive') return status === 'used';
  if (tab === 'office_returns') return status === 'office_return';
  if (tab === 'lost_expired') return status === 'lost' || status === 'expired';
  if (tab === 'expiring') {
    if (!item.expiryDate) return false;
    const expiry = new Date(item.expiryDate);
    if (Number.isNaN(expiry.getTime())) return false;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  }
  return !FINAL_STATUSES.includes(status);
}

/**
 * Совместим ли фильтр «Статус» (выпадающий список над таблицей) с вкладкой.
 * Если пересечение заведомо пусто (например, «В офисе» + вкладка «Архив»),
 * фильтр блокировал бы содержимое новой вкладки — при переключении его
 * сбрасывают к «Все статусы». Совместимые фильтры сохраняются.
 */
export function isRegistryFilterCompatible(filter: string, tab: string): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'copy_yes') {
    // «Сдана копия (CHN 2/3)» бывает только у незавершённых бланков
    return tab !== 'archive' && tab !== 'office_returns' && tab !== 'lost_expired';
  }
  // copy_no: завершённые статусы тоже считаются «без копии» — совместимо везде
  if (filter === 'copy_no') return true;
  return statusTabMatches(tab, { id: 'compat', status: filter });
}

export interface DozvolaRegistryFilterOptions {
  /** Выбранная вкладка статуса: all | archive | office_returns | lost_expired | expiring. */
  statusTab?: string;
  /** Уточнение внутри «Утерянные / аннулированные». */
  lostExpiredFilter?: LostExpiredFilter;
  /**
   * Фильтр «Статус» (выпадающий список; в компоненте историческое имя
   * selectedCountryFilter): office | hand | office_return | copy_yes | copy_no.
   */
  countryFilter?: string;
  /** Дополнительный фильтр равенства статуса (в компоненте selectedStatusFilter). */
  statusFilter?: string;
  searchQuery?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  /** Точка отсчёта для вкладки «expiring» (тесты); по умолчанию — сейчас. */
  now?: Date;
}

const compareForSort = (a: string | number, b: string | number, order: 'asc' | 'desc'): number => {
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a === b ? 0 : a < b ? -1 : 1;
  } else {
    const sa = String(a);
    const sb = String(b);
    cmp = sa === sb ? 0 : sa < sb ? -1 : 1;
  }
  return order === 'asc' ? cmp : -cmp;
};

/**
 * Отбор и сортировка строк реестра. Чистая функция: тот же вход → тот же выход,
 * никакого React — именно поэтому смена вкладки гарантированно меняет выборку.
 */
export function filterDozvolaItems<T extends DozvolaRegistryItem>(
  rawItems: readonly T[],
  options: DozvolaRegistryFilterOptions = {},
): T[] {
  const {
    statusTab = 'all',
    lostExpiredFilter = 'all',
    countryFilter = 'all',
    statusFilter = 'all',
    searchQuery = '',
    sortField = 'issueDate',
    sortOrder = 'desc',
    now = new Date(),
  } = options;

  let list: T[] = rawItems.filter((item) => statusTabMatches(statusTab, item, now));

  if (statusTab === 'lost_expired' && lostExpiredFilter !== 'all') {
    list = list.filter((item) => item.status === lostExpiredFilter);
  }

  if (countryFilter !== 'all') {
    if (countryFilter === 'copy_yes') {
      list = list.filter(
        (item) => item.isCopy === true && item.status !== 'office_return' && item.status !== 'used' && item.status !== 'expired',
      );
    } else if (countryFilter === 'copy_no') {
      list = list.filter(
        (item) => item.isCopy === false || item.status === 'office_return' || item.status === 'used' || item.status === 'expired',
      );
    } else {
      list = list.filter((item) => item.status === countryFilter);
    }
  }

  if (statusFilter !== 'all') {
    list = list.filter((item) => item.status === statusFilter);
  }

  if (searchQuery) {
    const s = searchQuery.toLowerCase();
    list = list.filter((item) =>
      (item.number || item.permitNumber || '').toLowerCase().includes(s) ||
      (item.car || item.assignedVehicle || '').toLowerCase().includes(s) ||
      (item.comment || item.comments || '').toLowerCase().includes(s) ||
      (item.type || '').toLowerCase().includes(s));
  }

  const sorted = [...list];
  const sortValueOf = (item: T): string | number => {
    const raw = item[sortField];
    const value = typeof raw === 'string' || typeof raw === 'number' ? raw : '';
    return typeof value === 'string' ? value.toUpperCase() : value;
  };
  sorted.sort((a, b) => compareForSort(sortValueOf(a), sortValueOf(b), sortOrder));

  return sorted;
}
