/**
 * Тесты приведения карточки авто к единому виду (utils/vehicleRecordNormalize).
 * Запуск: npx tsx scripts/test-vehicle-normalize.ts  (или npm run test:vehicle-normalize)
 */
import {
  brandCompareKey,
  canonicalBrand,
  directoryKeyOf,
  fixDimensions,
  fixDocumentNumber,
  sanitizeVehicleRecord,
} from '../src/utils/vehicleRecordNormalize';

let failed = 0;
let passed = 0;
const eq = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} — получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`);
  }
};

console.log('Марка тягача — все написания → один ключ');
for (const v of ['Mercedes', 'Mercedes-Benz', 'MERCEDES-BENZ', 'MERCEDES', 'mercedes benz', ' Mercedes ', 'MERSEDES']) {
  eq(`«${v}» → MERCEDES-BENZ`, canonicalBrand('vehicle', v)?.key, 'MERCEDES-BENZ');
}
eq('Volvo / VOLVO → VOLVO', [canonicalBrand('vehicle', 'Volvo')?.key, canonicalBrand('vehicle', 'VOLVO')?.key], ['VOLVO', 'VOLVO']);
eq('DAF → DAF', canonicalBrand('vehicle', 'daf')?.key, 'DAF');
eq('название для справочника — «Mercedes-Benz»', canonicalBrand('vehicle', 'MERCEDES')?.name, 'Mercedes-Benz');

console.log('Марка прицепа');
for (const v of ['KOEGEL', 'Koegel', 'KOGEL', 'Kogel', 'koegel ']) eq(`«${v}» → KOEGEL`, canonicalBrand('trailer', v)?.key, 'KOEGEL');
eq('Schwarzmuller → SCHWARZMULLER', canonicalBrand('trailer', 'Schwarzmuller')?.key, 'SCHWARZMULLER');
eq('Kazberer (опечатка) → KASSBOHRER', canonicalBrand('trailer', 'Kazberer')?.key, 'KASSBOHRER');
eq('Kassbohrer / KASSBOHRER → KASSBOHRER', [canonicalBrand('trailer', 'Kassbohrer')?.key, canonicalBrand('trailer', 'KASSBOHRER')?.key], ['KASSBOHRER', 'KASSBOHRER']);
eq('пара «MERSEDES / KOEGEL» в поле прицепа → KOEGEL', canonicalBrand('trailer', 'MERSEDES / KOEGEL')?.key, 'KOEGEL');
eq('пара «MERSEDES / KOEGEL» в поле тягача → MERCEDES-BENZ', canonicalBrand('vehicle', 'MERSEDES / KOEGEL')?.key, 'MERCEDES-BENZ');

console.log('Неизвестная марка и пустые значения');
eq('Scania → ключ SCANIA, название сохраняет регистр', canonicalBrand('vehicle', 'Scania'), { key: 'SCANIA', name: 'Scania', known: false });
eq('лишние пробелы схлопываются', canonicalBrand('vehicle', '  MAN   TGX '), { key: 'MAN TGX', name: 'MAN TGX', known: false });
eq('пустая строка → null', canonicalBrand('vehicle', '   '), null);
eq('не строка → null', canonicalBrand('vehicle', undefined), null);
eq('ключ справочника из «MAN TGX» → MAN_TGX', directoryKeyOf(canonicalBrand('vehicle', 'MAN TGX')!), 'MAN_TGX');
eq('ключ справочника у известной марки не меняется', directoryKeyOf(canonicalBrand('vehicle', 'Mercedes')!), 'MERCEDES-BENZ');
eq('ключ сравнения прицепа: oe → o', brandCompareKey('trailer', 'KOEGEL'), 'kogel');

console.log('Габариты и документы');
eq('«х» кириллицей → «x»', fixDimensions('13,6м х 2,45м х 2,7м'), '13,6м x 2,45м x 2,7м');
eq('латинская «x» не меняется', fixDimensions('13,6м x 2,45м x 2,7м'), '13,6м x 2,45м x 2,7м');
eq('серия паспорта «МР» кириллицей → «MP»', fixDocumentNumber('МР1234567'), 'MP1234567');
eq('личный номер: кириллица → латиница', fixDocumentNumber('3100774НО45РВ6'), '3100774HO45PB6');
eq('права: пробел внутри сохраняется, по краям убирается', fixDocumentNumber(' 5АВ 0059427 '), '5AB 0059427');
eq('латиница не меняется', fixDocumentNumber('PD0426572'), 'PD0426572');

console.log('sanitizeVehicleRecord');
{
  const input = {
    id: 'AO39217',
    carNumber: 'AO 3921-7',
    brand: 'Mercedes',
    brandModel: 'Mercedes',
    brands: 'Mercedes',
    trailerMake: 'Kogel',
    trailerBrand: 'MERSEDES / KOEGEL',
    dimensions: '13,6м х 2,45м х 2,7м',
    passportNumber: 'МР5102375',
    lastPassportVerificationYear: 0,
    year: '2015',
  };
  const snapshot = JSON.stringify(input);
  const out = sanitizeVehicleRecord(input) as typeof input & { lastPassportVerificationYear: number | null };
  eq('тягач: три поля марки одинаковы', [out.brand, out.brandModel, out.brands], ['MERCEDES-BENZ', 'MERCEDES-BENZ', 'MERCEDES-BENZ']);
  eq('прицеп: оба поля марки', [out.trailerMake, out.trailerBrand], ['KOEGEL', 'KOEGEL']);
  eq('габариты исправлены', out.dimensions, '13,6м x 2,45м x 2,7м');
  eq('паспорт исправлен', out.passportNumber, 'MP5102375');
  eq('нулевой год проверки → null', out.lastPassportVerificationYear, null);
  eq('остальные поля не тронуты', [out.id, out.carNumber, out.year], ['AO39217', 'AO 3921-7', '2015']);
  eq('входная запись не изменена', JSON.stringify(input), snapshot);
}
{
  const out = sanitizeVehicleRecord({ id: 'X', lastPassportVerificationYear: 2026, brand: '' });
  eq('год 2026 остаётся', (out as { lastPassportVerificationYear: number }).lastPassportVerificationYear, 2026);
  eq('пустая марка остаётся пустой', (out as { brand: string }).brand, '');
}
{
  const out = sanitizeVehicleRecord({ id: 'Y' }) as Record<string, unknown>;
  eq('отсутствующие поля не создаются', Object.keys(out), ['id']);
}

if (failed) {
  console.error(`\nПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`\nВсе проверки пройдены: ${passed}.`);
