/**
 * test-dozvola-tabs — юнит-проверки ЧИСТОЙ фильтрации реестра «Учёт дозволов»
 * (dozvolaRegistryFilter.ts).
 *
 * Регрессия, которую закрывает тест: строки таблицы должны соответствовать
 * ВЫБРАННОЙ вкладке статуса (первопричина жалобы — мемоизация таблицы не
 * пересчитывалась при смене вкладки, строки менялись только после F5).
 *
 *  1. statusTabMatches — правила отнесения записи к вкладке:
 *     «Все статусы» = всё, кроме завершённых (used/expired/office_return);
 *     «Архив» = used; «Использован» = office_return;
 *     «Утерянные / аннулированные» = lost|expired; «expiring» — срок ≤ 30 дней.
 *  2. filterDozvolaItems — смена ТОЛЬКО вкладки меняет выборку (смысл вкладок
 *     сохранён), уточнения lost/expired, поиск и фильтры не теряются при смене
 *     вкладки, copy_yes/copy_no, сортировка desc/asc.
 *  3. isRegistryFilterCompatible — несовместимый фильтр «Статус» не блокирует
 *     содержимое вкладки, совместимый — сохраняется.
 *
 * Запуск: npm run test:dozvola-tabs   (или npx tsx scripts/test-dozvola-tabs.ts)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import {
  statusTabMatches,
  filterDozvolaItems,
  isRegistryFilterCompatible,
  type DozvolaRegistryItem,
} from '../src/components/modules/dozvola/dozvolaRegistryFilter';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra: unknown = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra !== '' ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
};

// ── Фикстуры ───────────────────────────────────────────────────────────────
const item = (over: Partial<DozvolaRegistryItem> & { id: string }): DozvolaRegistryItem => ({
  type: 'RUS',
  number: '100000',
  comment: '',
  isCopy: false,
  issueDate: '2026-05-01',
  ...over,
});

const OFFICE = item({ id: 'i-office', status: 'office', number: '110001', car: 'Минск офис', issueDate: '2026-05-01' });
const HAND = item({ id: 'i-hand', status: 'hand', number: '110002', car: 'AO 1111-7', issueDate: '2026-05-02' });
const LOST = item({ id: 'i-lost', status: 'lost', number: '110003', car: 'AO 1112-7', issueDate: '2026-05-03' });
const EXPIRED = item({ id: 'i-expired', status: 'expired', number: '110004', car: 'AO 1113-7', issueDate: '2026-05-04' });
const USED = item({ id: 'i-used', status: 'used', number: '110005', car: 'AO 1114-7', issueDate: '2026-05-05' });
const RETURNED = item({ id: 'i-returned', status: 'office_return', number: '110006', car: 'AO 1115-7', issueDate: '2026-05-06', submissionBatch: 1 });
const COPY_CHN = item({ id: 'i-copy', status: 'hand', number: '110007', type: 'CHN 2', isCopy: true, car: 'AO 1116-7', issueDate: '2026-05-07' });
const EXPIRING = item({ id: 'i-expiring', status: 'hand', number: '110008', car: 'AO 1117-7', issueDate: '2026-06-01', expiryDate: '2026-10-20' });
const ALL_ITEMS = [OFFICE, HAND, LOST, EXPIRED, USED, RETURNED, COPY_CHN, EXPIRING];

const ids = (list: DozvolaRegistryItem[]) => list.map((i) => i.id).sort();

// ── 1. statusTabMatches ────────────────────────────────────────────────────
{
  check('«Все статусы»: завершённые скрыты, незавершённые показаны',
    statusTabMatches('all', OFFICE) && statusTabMatches('all', HAND) && statusTabMatches('all', LOST) && statusTabMatches('all', COPY_CHN) &&
    !statusTabMatches('all', USED) && !statusTabMatches('all', EXPIRED) && !statusTabMatches('all', RETURNED));
  check('«Архив»: только сданные в ТИ (used)',
    statusTabMatches('archive', USED) && !statusTabMatches('archive', RETURNED) && !statusTabMatches('archive', EXPIRED) && !statusTabMatches('archive', OFFICE));
  check('«Использован»: только office_return',
    statusTabMatches('office_returns', RETURNED) && !statusTabMatches('office_returns', USED) && !statusTabMatches('office_returns', HAND));
  check('«Утерянные / аннулированные»: lost и expired (оба статуса остаются разными)',
    statusTabMatches('lost_expired', LOST) && statusTabMatches('lost_expired', EXPIRED) && !statusTabMatches('lost_expired', USED) && !statusTabMatches('lost_expired', HAND));
  const now = new Date('2026-10-01T12:00:00');
  const far = item({ id: 'x1', status: 'hand', expiryDate: '2027-01-01' });
  const noDate = item({ id: 'x2', status: 'hand', expiryDate: '' });
  check('«expiring»: срок ≤ 30 дней проходит; далёкая дата и запись без срока — нет',
    statusTabMatches('expiring', EXPIRING, now) && !statusTabMatches('expiring', far, now) && !statusTabMatches('expiring', noDate, now));
}

// ── 2. filterDozvolaItems: вкладка решает, что видно в таблице ─────────────
{
  const byTab = (tab: string, extra = {}) => filterDozvolaItems(ALL_ITEMS, { statusTab: tab, ...extra });

  const all = byTab('all');
  check('вкладка «Все статусы»: office/hand/lost/копия (без used/expired/office_return)',
    ids(all).join(',') === ids([OFFICE, HAND, LOST, COPY_CHN, EXPIRING]).join(','), ids(all));

  const archive = byTab('archive');
  check('вкладка «Архив»: только used', ids(archive).join(',') === 'i-used', ids(archive));

  const returns = byTab('office_returns');
  check('вкладка «Использован»: только office_return', ids(returns).join(',') === 'i-returned', ids(returns));

  const lostExp = byTab('lost_expired');
  check('вкладка «Утерянные / аннулированные»: lost + expired', ids(lostExp).join(',') === ids([LOST, EXPIRED]).join(','), ids(lostExp));

  // Ключевая регрессия: одна и та же база, меняется ТОЛЬКО вкладка — меняются строки
  check('РЕГРЕССИЯ: смена только вкладки меняет строки (archive ≠ all ≠ lost_expired)',
    ids(archive).join(',') !== ids(all).join(',') &&
    ids(lostExp).join(',') !== ids(all).join(',') &&
    ids(lostExp).join(',') !== ids(archive).join(','));

  // Уточнение внутри вкладки
  check('уточнение «Аннулирован»: только expired',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'lost_expired', lostExpiredFilter: 'expired' })).join(',') === 'i-expired');
  check('уточнение «Утерян»: только lost',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'lost_expired', lostExpiredFilter: 'lost' })).join(',') === 'i-lost');
  check('уточнение «Оба статуса»: оба статуса',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'lost_expired', lostExpiredFilter: 'all' })).join(',') === ids([LOST, EXPIRED]).join(','));

  // Поиск сохраняется вместе с вкладкой (одновременно применены оба условия)
  check('поиск «110005» на вкладке архива находит used',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'archive', searchQuery: '110005' })).join(',') === 'i-used');
  check('поиск «110005» на вкладке «Все статусы» пуст (запись — завершённая)',
    filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', searchQuery: '110005' }).length === 0);
  check('поиск по машине «AO 1112» находит только утерянный',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'lost_expired', searchQuery: 'ao 1112' })).join(',') === 'i-lost');

  // Фильтр «Статус» (выпадающий список)
  check('фильтр copy_yes: только копия CHN 2/3 среди незавершённых',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', countryFilter: 'copy_yes' })).join(',') === 'i-copy');
  check('фильтр copy_no: все, кроме «сдана копия»',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', countryFilter: 'copy_no' })).join(',') === ids([OFFICE, HAND, LOST, EXPIRING]).join(','));
  check('фильтр «В офисе»: остаётся одна запись',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', countryFilter: 'office' })).join(',') === 'i-office');

  // Сортировка
  const desc = filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', sortField: 'issueDate', sortOrder: 'desc' });
  const asc = filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', sortField: 'issueDate', sortOrder: 'asc' });
  check('сортировка по дате выдачи: desc — новые сверху, asc — обратный порядок',
    desc[0].id === 'i-expiring' && asc[0].id === 'i-office' && asc.length === desc.length);
  check('сортировка по номеру (строки, регистронезависимо)',
    filterDozvolaItems(ALL_ITEMS, { statusTab: 'all', sortField: 'number', sortOrder: 'asc' })[0].number === '110001');

  // expiring
  const now = new Date('2026-10-01T12:00:00');
  check('вкладка «expiring»: только бланки со сроком ≤ 30 дней',
    ids(filterDozvolaItems(ALL_ITEMS, { statusTab: 'expiring', now })).join(',') === 'i-expiring');
}

// ── 3. Совместимость фильтра «Статус» с вкладкой ───────────────────────────
{
  check('«В офисе» + «Все статусы» — совместимо; + «Архив»/«Использован»/«Утерянные» — нет',
    isRegistryFilterCompatible('office', 'all') &&
    !isRegistryFilterCompatible('office', 'archive') &&
    !isRegistryFilterCompatible('office', 'office_returns') &&
    !isRegistryFilterCompatible('office', 'lost_expired'));
  check('«В рейсе» — только на «Все статусы»',
    isRegistryFilterCompatible('hand', 'all') && !isRegistryFilterCompatible('hand', 'archive'));
  check('«Использованы» + «Использован» — совместимо; + «Все статусы» — нет',
    isRegistryFilterCompatible('office_return', 'office_returns') && !isRegistryFilterCompatible('office_return', 'all'));
  check('«Сдана копия» — совместимо только с «Все статусы»',
    isRegistryFilterCompatible('copy_yes', 'all') && !isRegistryFilterCompatible('copy_yes', 'archive') && !isRegistryFilterCompatible('copy_yes', 'lost_expired'));
  check('«Нет копии» и «Все статусы»-фильтр — совместимы с любой вкладкой',
    ['all', 'archive', 'office_returns', 'lost_expired', 'expiring'].every((tab) => isRegistryFilterCompatible('copy_no', tab) && isRegistryFilterCompatible('all', tab)));
}

console.log(`\nИТОГО: ${passed} пройдено, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
