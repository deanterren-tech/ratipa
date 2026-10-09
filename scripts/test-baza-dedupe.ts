/**
 * Тест сценария дублей «Учёта выезда» (кейс 8806 и соседние правила).
 * Запуск: npx tsx scripts/test-baza-dedupe.ts
 */
import {
  dedupeBazaRecords,
  findActiveDuplicate,
  plateVariants,
  samePlate,
  type BazaDedupeRecord,
} from '../src/components/modules/baza/lib/bazaDedupe';

let failures = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    console.log(`✔ ${name}`);
  } else {
    failures += 1;
    console.error(`✘ ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
};

const rec = (over: Partial<BazaDedupeRecord> & { id: string }): BazaDedupeRecord => ({
  carNumber: 'AO 8806-7 / A3928B7',
  dateArrival: '2026-10-01',
  dateDeparture: '',
  status: 'base',
  ...over,
});

// ── 1. Реальный кейс 8806: две активные записи с одним приездом (дубль) ──
const twinA = rec({
  id: '-P2vFw7Uovi-MEa1ZLFb',
  dateLoading: '2026-10-19',
  history: {
    h1: { date: '02/10/2026 09:18' },
    h2: { date: '06/10/2026 12:10' },
  },
});
const twinB = rec({
  id: '-P2vG-np95EmWVficb8W',
  dateLoading: '2026-10-12',
  history: { h1: { date: '02/10/2026 09:18' } },
});
const r1 = dedupeBazaRecords([twinA, twinB]);
ok('8806: остаётся одна запись из двух', r1.kept.length === 1, r1.kept.map((x) => x.id));
ok('8806: остаётся более «живая» (с поздней правкой)', r1.kept[0].id === '-P2vFw7Uovi-MEa1ZLFb', r1.kept[0].id);
ok('8806: схлопнутая запись указана в dropped', r1.dropped.length === 1 && r1.dropped[0].dropped.id === '-P2vG-np95EmWVficb8W');
ok('findActiveDuplicate находит дубль при создании', findActiveDuplicate([twinA, twinB], 'AO 8806-7 / A3928B7', '2026-10-01') !== null);

// ── 2. Разные периоды (приезды) — НЕ дубль ──────────────────────────────
const other = rec({ id: 'r2', dateArrival: '2026-09-01', history: { h: { date: '01/09/2026 10:00' } } });
const r2 = dedupeBazaRecords([twinA, other]);
ok('разные приезды: обе записи сохранены', r2.kept.length === 2 && r2.dropped.length === 0);
ok('findActiveDuplicate не срабатывает на другой приезд', findActiveDuplicate([twinA], 'AO 8806-7 / A3928B7', '2026-09-01') === null);

// ── 3. Архивная + активная с тем же приездом — НЕ дубль ─────────────────
const arch = rec({ id: 'r3', status: 'archive', dateDeparture: '2026-10-05', history: { h: { date: '05/10/2026 12:00' } } });
const r3 = dedupeBazaRecords([twinA, arch]);
ok('архив и активная с тем же приездом: обе сохранены', r3.kept.length === 2 && r3.dropped.length === 0);
ok('findActiveDuplicate игнорирует архивную', findActiveDuplicate([arch], 'AO 8806-7 / A3928B7', '2026-10-01') === null);

// ── 4. Раскладка кириллица/латиница ─────────────────────────────────────
ok('варианты номера с раскладкой: общий ключ есть', plateVariants('АО 8806-7 / А3928В7').some((k) => plateVariants('AO 8806-7 / A3928B7').includes(k)));
ok('samePlate: кириллица и латиница совпадают', samePlate('АО 8806-7 / А3928В7', 'AO 8806-7 / A3928B7'));
ok(
  'findActiveDuplicate ловит дубль в другой раскладке',
  findActiveDuplicate([twinA], 'АО 8806-7 / А3928В7', '2026-10-01') !== null,
);

// ── 5. Записи без приезда не группируются ───────────────────────────────
const noDate1 = rec({ id: 'n1', dateArrival: '' });
const noDate2 = rec({ id: 'n2', dateArrival: '' });
const r5 = dedupeBazaRecords([noDate1, noDate2]);
ok('записи без приезда сохраняются все', r5.kept.length === 2 && r5.dropped.length === 0);

// ── 6. Двойное правило: «живее» — по журналу, затем по id ───────────────
const h1 = rec({ id: 'aaa', history: {} });
const h2 = rec({ id: 'bbb', history: {} });
const r6 = dedupeBazaRecords([h1, h2]);
ok('равные журналы: стабильный tie-break по id (первый созданный)', r6.kept.length === 1 && r6.kept[0].id === 'aaa');

if (failures) {
  console.error(`\n${failures} проверок не прошли`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены: дубли «Учёта выезда» схлопываются, создание защищено.');
