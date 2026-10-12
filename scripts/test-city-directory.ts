/**
 * Изолированные тесты справочника городов (без сети и без базы):
 *  - нормализация (регистр, ё, тире/кавычки, пробелы, приставки);
 *  - транслит-пары (Алашанькоу ↔ Alashankou, Хоргос ↔ Khorgos);
 *  - защита от ложных склеек (Минск ≠ Пинск; цепочки вариантов);
 *  - каноническое имя по частоте (при равенстве — по вхождениям в рейсы);
 *  - «пограничные» пары для ручного решения;
 *  - фильтр «похоже на место» (мусор из свободных текстов);
 *  - поиск похожих для CityAutocomplete.
 * Запуск: npm run test:cities
 */
import {
  normalizeCityName,
  cityMatchKind,
  levenshtein,
  translitVariants,
  citySlug,
  canonicalCityDisplay,
  groupCityCandidates,
  looksLikePlaceName,
  isShortPlaceText,
  findSimilarCities,
  ruToLatin,
  type CityCandidate,
} from '../src/utils/cityDirectory.ts';

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

const cand = (over: Partial<CityCandidate> & { norm: string; name: string }): CityCandidate => ({
  count: 1,
  tripCount: 0,
  kind: 'place',
  typeHints: [],
  countries: [],
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\n1. Нормализация');
eq('trim + регистр', normalizeCityName('  Минск  '), 'минск');
eq('ё→е', normalizeCityName('Могилёв'), 'могилев');
eq('ё→е (строчная)', normalizeCityName('орёл'), 'орел');
eq('тире → дефис', normalizeCityName('Ростов–на–Дону'), 'ростов-на-дону');
eq('кавычки по краям снимаются', normalizeCityName('«Козловичи»'), 'козловичи');
eq('кавычки внутри сохраняются', normalizeCityName('Козловичи («Брест»)'), 'козловичи ("брест")');
eq('точки и лишние пробелы', normalizeCityName('Нижний  Новгород .'), 'нижний новгород');
eq('приставка «г.»', normalizeCityName('г. Минск'), 'минск');
eq('приставка «город»', normalizeCityName('город Брест'), 'брест');
eq('приставка «пос.»', normalizeCityName('пос. Ольховка'), 'ольховка');
eq('неразрывный пробел', normalizeCityName('Великие\u00A0Луки'), 'великие луки');
eq('точка с запятой по краям', normalizeCityName('Хоргос;'), 'хоргос');
eq('пустая строка', normalizeCityName('   '), '');
eq('точка внутри «К. Горка»', normalizeCityName('К. Горка'), 'к. горка');
eq('код страны в скобках снимается «Минск (BY)»', normalizeCityName('Минск (BY)'), 'минск');
eq('код страны кириллицей снимается «Достык (КЗ)»', normalizeCityName('Достык (КЗ)'), 'достык');
eq('код страны в низком регистре НЕ снимается', normalizeCityName('Минск (by)'), 'минск (by)');
eq('скобки со словом сохраняются «Козловичи (Брест)»', normalizeCityName('Козловичи (Брест)'), 'козловичи (брест)');
eq('«Минск (BY)» ↔ «Минск» — одна форма', normalizeCityName('Минск (BY)') === normalizeCityName('Минск') ? 'ok' : 'diff', 'ok');

console.log('\n2. Транслит');
eq('ruToLatin', ruToLatin('Алашанькоу'), 'alashankou');
check('варианты содержат kh', translitVariants('Хоргос').includes('khorgos'), `(${JSON.stringify(translitVariants('хоргос'))})`);
check('варианты содержат h', translitVariants('Хоргос').includes('horgos'));
check('Alashankou ↔ Алашанькоу', cityMatchKind(normalizeCityName('Алашанькоу'), normalizeCityName('Alashankou')) === 'translit');
check('Khorgos ↔ Хоргос', cityMatchKind(normalizeCityName('Хоргос'), normalizeCityName('Khorgos')) === 'translit');
check('Стамбул ≠ Istanbul (не транслит-пара, а перевод)', cityMatchKind(normalizeCityName('Стамбул'), normalizeCityName('Istanbul')) === null);

console.log('\n3. Левенштейн и защита от ложных склеек');
eq('расстояние 0', levenshtein('минск', 'минск'), 0);
eq('расстояние 1', levenshtein('минск', 'минскк'), 1);
eq('лимит обрезает', levenshtein('минск', 'владивосток', 2), 3);
check('Минск / Пинск НЕ склеиваются', cityMatchKind('минск', 'пинск') === null);
check('Орел / Орёл = exact', cityMatchKind('орел', 'орел') === 'exact');
check('опечатка двойной буквы', cityMatchKind('хоргос', 'хоргосс') === 'typo');
check('опечатка внутри длинного', cityMatchKind('великие луки', 'великии луки') === 'typo');
check('усечение короткого — склейка (Иркутс→Иркутск)', cityMatchKind('иркутс', 'иркутск') === 'typo');
check('замена буквы в коротком НЕ склеивает (Астана/Астара)', cityMatchKind('астана', 'астара') === null);
check('замена буквы в коротком НЕ склеивает (Берск/Бердск)', cityMatchKind('берск', 'бердск') === null);
check('короткие города (4 буквы) без опечаток', cityMatchKind('лида', 'лиды') === null);
check('разные первые буквы — не склейка', cityMatchKind('мозырь', 'розырь') === null);
check('разные города не склеиваются', cityMatchKind('нижний новгород', 'нижнекамск') === null);
check('Ростов / Ростов-на-Дону', cityMatchKind('ростов', 'ростов-на-дону') === null);

console.log('\n4. Слаги (идемпотентность id)');
eq('слаг кириллицы', citySlug('Алашанькоу'), 'alashankou');
eq('слаг латиницы совпадает', citySlug('Alashankou'), 'alashankou');
eq('слаг с пробелами', citySlug('Нижний Новгород'), 'nizhniy-novgorod');
eq('слаг «К. Горка»', citySlug('К. Горка'), 'k-gorka');

console.log('\n5. Каноническое написание');
eq('нижний регистр → Title', canonicalCityDisplay('могилев'), 'Могилев');
eq('КАПС → Title', canonicalCityDisplay('МИНСК'), 'Минск');
eq('составное', canonicalCityDisplay('нижний новгород'), 'Нижний Новгород');
eq('дефис и точка', canonicalCityDisplay('К. ГОРКА'), 'К. Горка');

console.log('\n6. Группировка: транслит-пары и частота');
{
  const { groups } = groupCityCandidates([
    cand({ norm: 'алашанькоу', name: 'Алашанькоу', count: 56, tripCount: 30 }),
    cand({ norm: 'alashankou', name: 'Alashankou', count: 3, tripCount: 0, kind: 'checkpoint' }),
    cand({ norm: 'хоргос', name: 'Хоргос', count: 12, tripCount: 6 }),
    cand({ norm: 'khorgos', name: 'Khorgos', count: 1, kind: 'location' }),
  ]);
  const grp = groups.find((g) => g.norm === 'алашанькоу');
  check('транслит-пара в одной группе', !!grp && grp.variants.length === 2, `(${grp ? grp.variants.map((v) => v.name).join(' + ') : 'нет'})`);
  eq('каноническое — по частоте', grp?.canonical, 'Алашанькоу');
  eq('счёт группы', grp?.count, 59);
  const grp2 = groups.find((g) => g.norm === 'хоргос');
  check('Хоргос+Khorgos вместе', !!grp2 && grp2.variants.length === 2);
  eq('каноническое Хоргос', grp2?.canonical, 'Хоргос');
}
{
  // равенство частот → решает вес «реальных рейсов»
  const { groups } = groupCityCandidates([
    cand({ norm: 'минск', name: 'минск', count: 4, tripCount: 1 }),
    cand({ norm: 'минск', name: 'Минск', count: 4, tripCount: 9 }),
  ]);
  check('равные частоты — один вариант', groups.length === 1);
  eq('побеждает частый в рейсах', groups[0]?.canonical, 'Минск');
}
{
  // равные частоты и рейсы → кириллица предпочтительнее
  const { groups } = groupCityCandidates([
    cand({ norm: 'alashankou', name: 'Alashankou', count: 2, tripCount: 1 }),
    cand({ norm: 'алашанькоу', name: 'Алашанькоу', count: 2, tripCount: 1 }),
  ]);
  eq('кириллица при полном равенстве', groups[0]?.canonical, 'Алашанькоу');
}

console.log('\n7. Защита от транзитивных цепочек');
{
  const { groups } = groupCityCandidates([
    cand({ norm: 'самара', name: 'Самара', count: 10, tripCount: 5 }),
    cand({ norm: 'самарра', name: 'Самарра', count: 1 }),
    cand({ norm: 'самаррра', name: 'Самаррра', count: 1 }),
  ]);
  const main = groups.find((g) => g.norm === 'самара');
  check('цепочка не приклеивает далёкий вариант', !!main && main.variants.length === 2, `(${main ? main.variants.map((v) => v.name).join(' + ') : 'нет'})`);
  const loose = groups.find((g) => g.norm === 'самаррра');
  check('далёкий вариант — отдельная группа', !!loose);
}

console.log('\n8. Пограничные пары');
{
  const { borderline } = groupCityCandidates([
    cand({ norm: 'актау', name: 'Актау', count: 5 }),
    cand({ norm: 'актобе', name: 'Актобе', count: 2 }),
    cand({ norm: 'минск', name: 'Минск', count: 20 }),
    cand({ norm: 'пинск', name: 'Пинск', count: 8 }),
  ]);
  check('актау/актобе — в пограничных (разные города, решает человек)', borderline.some((p) => [p.a, p.b].includes('Актау') && [p.a, p.b].includes('Актобе')));
  check('минск/пинск — НЕ в пограничных (разные города)', !borderline.some((p) => [p.a, p.b].includes('Минск') && [p.a, p.b].includes('Пинск')));
}

console.log('\n9. Фильтр «похоже на место»');
check('город ок', looksLikePlaceName('алашанькоу'));
check('«к. горка» ок', looksLikePlaceName('к. горка'));
check('цифровой мусор', !looksLikePlaceName('1351'));
check('фраза с мойкой', !looksLikePlaceName(normalizeCityName('Мойка после смены (повтор)')));
check('фраза про отпуск', !looksLikePlaceName(normalizeCityName('Субцельный до начала августа в отпуске')));
check('«2 дня простоял»', !looksLikePlaceName(normalizeCityName('2 дня простоял')));
check('короткий текст-место', isShortPlaceText('Хоргос'));
check('длинная фраза не место', !isShortPlaceText('день приезда — можно'));

console.log('\n10. Поиск похожих (CityAutocomplete)');
{
  const catalog = [
    { name: 'Алашанькоу', aliases: ['Alashankou'] },
    { name: 'Минск', aliases: [] },
    { name: 'Нижний Новгород', aliases: ['Nizhny Novgorod'] },
  ];
  const r1 = findSimilarCities('алашанко', catalog);
  check('похожий на Алашанькоу найден', r1.length > 0 && r1[0].entry.name === 'Алашанькоу', `(${r1.map((s) => s.entry.name).join(', ')})`);
  const r2 = findSimilarCities('alashankou', catalog);
  check('латиница находит по алиасу', r2.length > 0 && r2[0].entry.name === 'Алашанькоу' && r2[0].reason === 'exact', `(${r2[0]?.reason})`);
  const r3 = findSimilarCities('мин', catalog);
  check('префикс', r3.length > 0 && r3[0].entry.name === 'Минск' && r3[0].reason === 'prefix');
  const r4 = findSimilarCities('хоргос', catalog);
  check('несуществующее ≠ похоже на другие', r4.length === 0);
}

console.log(`\nИтог: ${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
