/**
 * Изолированные тесты импорта GeoNames (без сети и без базы): на мок-TSV.
 *  - разбор строк cities5000.txt / alternateNamesV2.txt;
 *  - отбор по странам и порогам (малые страны 5000, столицы — всегда);
 *  - запись города: русское имя из alternateNames (isPreferred приоритетно),
 *    латинские алиасы из alternatenames, отсев «чужих» раскладок;
 *  - идемпотентность: решение create/extend/skip — по geonameId, затем по
 *    нормализованному имени/алиасам; дополняются ТОЛЬКО пустые поля;
 *    записи не-города не трогаются; дубли в пределах прогона не создаются.
 * Запуск: npm run test:geonames
 */
import {
  parseCitiesRow,
  parseAlternateNameRow,
  passesCityFilter,
  pickGeonamesCities,
  buildGeonamesCity,
  decideCityImport,
  resolveGeonamesSettings,
  thresholdForCountry,
  CityIndex,
  GEONAMES_DEFAULT_COUNTRIES,
} from '../src/utils/geonames.ts';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` ${extra}` : ''}`);
  }
};
const eq = (name: string, a: unknown, b: unknown): void =>
  check(name, JSON.stringify(a) === JSON.stringify(b), `(${JSON.stringify(a)} == ${JSON.stringify(b)})`);

// Строка cities5000.txt: 19 колонок; население — 15-я (индекс 14).
const cityLine = (over: { id: number; name: string; ascii?: string; alts?: string; lat?: number; lng?: number; cc: string; pop: number; fcode?: string; fclass?: string }): string =>
  [
    over.id, over.name, over.ascii ?? over.name, over.alts ?? '', over.lat ?? 0, over.lng ?? 0,
    over.fclass ?? 'P', over.fcode ?? 'PPL', over.cc, '', '', '', '', '',
    String(over.pop), '', '', '', '',
  ].join('\t');

// --- разбор cities ---
{
  const row = parseCitiesRow(cityLine({ id: 625144, name: 'Minsk', ascii: 'Minsk', alts: 'Минск,Minsk,Mensk', cc: 'BY', pop: 1742124, fcode: 'PPLC' }));
  check('parseCitiesRow: id/имя/страна/население', !!row && row.geonameId === 625144 && row.country === 'BY' && row.population === 1742124);
  eq('parseCitiesRow: alternatenames разобраны', row?.alternateNames, ['Минск', 'Minsk', 'Mensk']);
  check('parseCitiesRow: лат/лонг', row?.lat === 0 && row?.lng === 0);
  check('parseCitiesRow: короткая строка отклонена', parseCitiesRow('1\t2\t3') === null);
  check('parseCitiesRow: мусор отклонён', parseCitiesRow('abc\tdef') === null);
}

// --- разбор alternateNames ---
{
  const ru = parseAlternateNameRow('123456\t625144\tru\tМинск\t1\t0\t0\t0\t\t');
  check('parseAlternateNameRow: ru + isPreferred', !!ru && ru.language === 'ru' && ru.name === 'Минск' && ru.isPreferred === true);
  const en = parseAlternateNameRow('1\t625144\ten\tMinsk\t0\t0\t0\t0\t\t');
  check('parseAlternateNameRow: en без preferred', !!en && en.isPreferred === false);
  check('parseAlternateNameRow: пустая строка', parseAlternateNameRow('') === null);
}

// --- пороги и страны ---
{
  const s = resolveGeonamesSettings(null);
  eq('умолчания: страны', s.countries, GEONAMES_DEFAULT_COUNTRIES);
  check('умолчания: порог 15000', s.threshold === 15000);
  check('порог BY = 5000 (малая страна)', thresholdForCountry(s, 'BY') === 5000);
  check('порог RU = 15000 (общий)', thresholdForCountry(s, 'RU') === 15000);
  const custom = resolveGeonamesSettings({ countries: ['by', 'xx', 'PL'], threshold: 20000, smallThreshold: 7000 });
  eq('настройки из базы нормализуются (верхний регистр, мусор отсеян)', custom.countries, ['BY', 'XX', 'PL']);
  check('кастомные пороги применены', custom.threshold === 20000 && custom.smallThreshold === 7000);
  const empty = resolveGeonamesSettings({ countries: [] });
  eq('пустой список стран → умолчания', empty.countries, GEONAMES_DEFAULT_COUNTRIES);
}

// --- фильтр городов ---
{
  const s = resolveGeonamesSettings(null);
  const minsk = parseCitiesRow(cityLine({ id: 1, name: 'Minsk', cc: 'BY', pop: 1000, fcode: 'PPLC' }))!;
  const small = parseCitiesRow(cityLine({ id: 2, name: 'Skidel', cc: 'BY', pop: 9707 }))!;
  const tiny = parseCitiesRow(cityLine({ id: 3, name: 'Village', cc: 'BY', pop: 100 }))!;
  const ru = parseCitiesRow(cityLine({ id: 4, name: 'Tiny', cc: 'RU', pop: 9000 }))!;
  const cityRu = parseCitiesRow(cityLine({ id: 5, name: 'Kazan', cc: 'RU', pop: 1000000 }))!;
  check('столица проходит даже ниже порога', passesCityFilter(minsk, s));
  check('BY 9707 ≥ 5000 — проходит', passesCityFilter(small, s));
  check('BY 100 — не проходит', !passesCityFilter(tiny, s));
  check('RU 9000 < 15000 — не проходит', !passesCityFilter(ru, s));
  check('RU 1000000 — проходит', passesCityFilter(cityRu, s));
  const other = parseCitiesRow(cityLine({ id: 6, name: 'Wien', cc: 'AT', pop: 1900000 }))!;
  check('страна вне списка — не проходит', !passesCityFilter(other, s));
  const picked = pickGeonamesCities([minsk, small, tiny, ru, cityRu, other], s);
  eq('pickGeonamesCities отобрал 3', picked.map((r) => r.geonameId), [1, 2, 5]);
}

// --- запись города из дампа ---
{
  const row = parseCitiesRow(cityLine({ id: 625144, name: 'Minsk', ascii: 'Minsk', alts: 'Минск,Minsk,Mensk,Менск', cc: 'BY', pop: 1742124, fcode: 'PPLC' }))!;
  const city = buildGeonamesCity(row, ['Минск', 'Менск']);
  check('имя — русское (preferred ru)', city.name === 'Минск');
  check('алиасы содержат латиницу', city.aliases.includes('Minsk') && city.aliases.includes('Mensk'));
  check('алиасы содержат прочие ru-варианты', city.aliases.includes('Менск'));
  check('дублей форм нет', new Set(city.aliases.map((a) => a.toLowerCase())).size === city.aliases.length);
  const noRu = buildGeonamesCity(row, []);
  check('без ru-имён — основное (asciiname)', noRu.name === 'Minsk');
  // чужие раскладки отсеиваются, дубли по пунктуации схлопываются
  const weird = parseCitiesRow(cityLine({ id: 7, name: 'Zelva', ascii: 'Zelva', alts: "Zel'va,Zel’va,זעלווא,Zelwa", cc: 'BY', pop: 6193 }))!;
  const wc = buildGeonamesCity(weird, []);
  check('иврит/иные раскладки отсеяны', wc.aliases.every((a) => !/[^\x00-\x7F]/.test(a) || /[а-яё]/i.test(a)));
  check("варианты Zel'va/Zel’va не дублируют имя (остаётся Zelwa)", wc.aliases.filter((a) => a.toLowerCase().startsWith('zel')).length === 1, JSON.stringify(wc.aliases));
}

// --- решение create/extend/skip ---
{
  const city = buildGeonamesCity(parseCitiesRow(cityLine({ id: 625144, name: 'Minsk', ascii: 'Minsk', alts: 'Minsk,Mensk', cc: 'BY', pop: 1742124 }))!, ['Минск', 'Менск']);
  const d1 = decideCityImport(city, null);
  check('новая запись → create', d1.action === 'create');

  // запись из миграции с тем же именем: дополняем, не переименовываем
  const migrated = { id: 'minsk', name: 'Минск', aliases: ['Миинск'], type: 'город', source: 'migration', country: 'BY' };
  const d2 = decideCityImport(city, migrated);
  check('совпадение по имени → extend', d2.action === 'extend' && d2.id === 'minsk');
  check('дополняются: geonameId/координаты/population', d2.patch.geonameId === 625144 && d2.patch.population === 1742124 && typeof d2.patch.lat === 'number');
  check('страна НЕ перезаписана (уже есть)', d2.patch.country === undefined);
  check('новые алиасы добавлены, старые не трогаются', d2.addAliases.includes('Mensk') && !d2.addAliases.includes('Миинск'));

  // запись «user» — тоже только дополнение, имя не меняется
  const userRec = { id: 'mysk', name: 'Мыск', aliases: ['Минск'], type: 'город', source: 'user' };
  const d3 = decideCityImport(city, userRec);
  check('совпадение по алиасу user-записи → extend', d3.action === 'extend' && d3.id === 'mysk');
  check('user-запись не переименовывается (имя не в patch)', d3.patch.name === undefined && d3.patch.aliases === undefined);

  // запись-граница не трогается
  const border = { id: 'brest-border', name: 'Минск', aliases: [], type: 'граница', source: 'migration' };
  const d4 = decideCityImport(city, border);
  check('type «граница» → skip (не трогаем)', d4.action === 'skip' && /не город/.test(d4.reason));

  // полностью совпадающая запись — без изменений (идемпотентность)
  const full = { id: 'minsk', name: 'Минск', aliases: ['Minsk', 'Mensk', 'Менск'], type: 'город', source: 'geonames', country: 'BY', geonameId: 625144, lat: 1, lng: 2, population: 1742124 };
  const d5 = decideCityImport(city, full);
  check('полное совпадение → skip без изменений', d5.action === 'skip' && /идемпотентно/.test(d5.reason));

  // дополнение уже частично заполненной записи
  const part = { id: 'minsk', name: 'Минск', aliases: ['Minsk', 'Mensk', 'Менск'], type: 'город', source: 'migration', country: 'BY', geonameId: 625144, lat: 53.9, lng: 27.55 };
  const d6 = decideCityImport(city, part);
  check('недостаёт только population → extend', d6.action === 'extend' && d6.patch.population === 1742124 && Object.keys(d6.patch).length === 1 && d6.addAliases.length === 0);
}

// --- CityIndex: поиск по geonameId и формам, дубли внутри прогона ---
{
  const idx = new CityIndex([
    { id: 'minsk', name: 'Минск', aliases: ['Minsk'], type: 'город', source: 'migration', geonameId: 625144 },
  ]);
  const city = buildGeonamesCity(parseCitiesRow(cityLine({ id: 625144, name: 'Minsk', ascii: 'Minsk', cc: 'BY', pop: 1742124 }))!, ['Минск']);
  check('поиск по geonameId', idx.find(city)?.id === 'minsk');
  const city2 = buildGeonamesCity(parseCitiesRow(cityLine({ id: 999999, name: 'Minsk', ascii: 'Minsk', cc: 'BY', pop: 100000 }))!, []);
  check('поиск по алиасу (Minsk)', idx.find(city2)?.id === 'minsk');
  const city3 = buildGeonamesCity(parseCitiesRow(cityLine({ id: 111111, name: 'Grodno', ascii: 'Grodno', cc: 'BY', pop: 300000 }))!, ['Гродно']);
  check('новый город не найден в индексе', idx.find(city3) === null);
  eq('uniqueId для нового (слаг из ru-имени)', idx.uniqueId(city3), 'grodno');
  idx.add({ id: 'grodno', name: 'Гродно', aliases: [], type: 'город', source: 'geonames', geonameId: 111111 });
  const citySame = buildGeonamesCity(parseCitiesRow(cityLine({ id: 222222, name: 'Grodno2', ascii: 'Grodno2', cc: 'BY', pop: 100000 }))!, ['Гродно']);
  check('внутри прогона дубль не создаётся (по форме)', idx.find(citySame)?.id === 'grodno');
  const idCollision = idx.uniqueId(buildGeonamesCity(parseCitiesRow(cityLine({ id: 333333, name: 'Grodno', ascii: 'Grodno', cc: 'BY', pop: 1 }))!, ['Гродно', 'Городно']));
  check('коллизия id → суффикс', idCollision === 'grodno-2', idCollision);
}

console.log(`\ntest-geonames: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
