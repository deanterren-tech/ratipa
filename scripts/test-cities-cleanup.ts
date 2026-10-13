/**
 * Изолированные тесты починки справочника (без базы и сети):
 *  - перевывод алиасов из своего geonameId (удаление чужих форм, сохранение
 *    не-дамповых алиасов миграции, добавление своих);
 *  - склейки в полях мест (список владельца + обобщения, защита от ложных
 *    срабатываний на нормальных составных названиях);
 *  - защищённые значения (МО/НН/РБ, заметки, числа) — не трогаются;
 *  - опечатки: единственный ближайший кандидат, правила безопасности
 *    (Астана/Астара, Ульяновка, Самра — не трогаются), исправление текста;
 *  - слияние двойников: usageCount/aliases/mergedFrom.
 * Запуск: npm run test:cities-cleanup
 */
import { normalizeCityName } from '../src/utils/cityDirectory.ts';
import {
  findTypoCandidate,
  isGluedValue,
  isNumericValue,
  isProtectedValue,
  ownFormsOf,
  planAliasRebuild,
  mergeIntoCanonPatch,
  type CleanupCatalogEntry,
} from '../src/utils/cityCleanup.ts';
import { buildGeonamesCity, parseCitiesRow } from '../src/utils/geonames.ts';

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

const row = (over: { id: number; name: string; ascii?: string; alts?: string; cc?: string; pop?: number }): ReturnType<typeof parseCitiesRow> =>
  parseCitiesRow(
    [
      over.id, over.name, over.ascii ?? over.name, over.alts ?? '', 0, 0, 'P', 'PPL', over.cc ?? 'RU', '', '', '', '', '',
      String(over.pop ?? 0), '', '', '', '',
    ].join('\t'),
  );

// ---------------------------------------------------------------------------
// Защищённые значения
// ---------------------------------------------------------------------------
{
  check('«МО» защищено (условная пометка)', isProtectedValue('МО'));
  check('«НН» защищено', isProtectedValue('НН'));
  check('«РБ» защищено', isProtectedValue('РБ'));
  check('«без водителя» защищено (заметка)', isProtectedValue('без водителя'));
  check('«Нет водителя» защищено', isProtectedValue('Нет водителя'));
  check('«ХЗ "ТП"» защищено (кавычки не мешают)', isProtectedValue('ХЗ "ТП"'));
  check('«ТП "ХЗ"» защищено', isProtectedValue('ТП "ХЗ"'));
  check('«Отпуск водителя» защищено (паттерн)', isProtectedValue('Отпуск водителя'));
  check('«В отпуске по 09.09» защищено', isProtectedValue('В отпуске по 09.09'));
  check('«2142» — число (не опечатка)', isNumericValue('2142') && !isProtectedValue('2142'));
  check('обычный город НЕ защищён', !isProtectedValue('Иркутск') && !isProtectedValue('Улан-Удэ'));
}

// ---------------------------------------------------------------------------
// Склейки
// ---------------------------------------------------------------------------
{
  const glues = [
    'Минск+Гомель', 'Мосты+Борисов', 'Ростов+Минск', 'Брест - МИНСК',
    'Москва, на КЗ, УЗ, КГ, МНГ', 'Ростов на Армению', 'Челябинск -  на  КЗ',
    'На АРМ, ТР', 'КЗ/УЗ/РФ', 'на второй круг', 'Курган + Тюмень',
  ];
  glues.forEach((v) => check(`склейка: «${v}»`, isGluedValue(v)));
  const notGlues = ['Ростов-на-Дону', 'Улан-Удэ', 'Забайкальск - Маньчжурия', 'Стамбул (Акташ)', 'Минск', 'Минск (BY)', 'Акташ - Карцахи', 'Москва'];
  notGlues.forEach((v) => check(`НЕ склейка: «${v}»`, !isGluedValue(v)));
}

// ---------------------------------------------------------------------------
// Опечатки
// ---------------------------------------------------------------------------
{
  const catalog: CleanupCatalogEntry[] = [
    { id: 'ekaterinburg', name: 'Екатеринбург', aliases: ['Свердловск'] },
    { id: 'minsk', name: 'Минск', aliases: [] },
    { id: 'mtsensk', name: 'Мценск', aliases: [] },
    { id: 'manchzhuriya', name: 'Маньчжурия', aliases: [] },
    { id: 'tekirdag', name: 'Текирдаг', aliases: [] },
    { id: 'ulyanovsk', name: 'Ульяновск', aliases: [] },
    { id: 'astana', name: 'Астана', aliases: [] },
    { id: 'astara', name: 'Астара', aliases: [] },
    { id: 'samara', name: 'Самара', aliases: [] },
    { id: 'samra', name: 'Самра', aliases: [] },
    { id: 'shymkent', name: 'Шымкент', aliases: ['Chimkent'] },
    { id: 'ulan-ude', name: 'Улан-Уде', aliases: ['улан уде'] },
  ];
  const cand = (v: string) => findTypoCandidate(v, catalog);

  check('«Екатеренбург» → Екатеринбург (d=1)', cand('Екатеренбург')?.id === 'ekaterinburg');
  check('«Екаьтеринбург» → Екатеринбург', cand('Екаьтеринбург')?.id === 'ekaterinburg');
  check('«Манчжурия» → Маньчжурия', cand('Манчжурия')?.id === 'manchzhuriya');
  check('«Тегирдак» → Текирдаг (d=2)', cand('Тегирдак')?.id === 'tekirdag');
  check('«миннск» → Минск (ближайший уникальный, дальние кандидаты не мешают)', cand('миннск')?.id === 'minsk');
  // Правила безопасности:
  check('«Ульяновка» НЕ трогается (может быть деревней)', cand('Ульяновка') === null);
  check('«Астана» НЕ трогается — это город, а не опечатка', cand('Астана') === null);
  check('«Астара» НЕ трогается', cand('Астара') === null);
  check('«Самра» НЕ трогается (может быть реальным селом)', cand('Самра') === null);
  check('«МО» не кандидат (короткое/защищённое)', cand('МО') === null);
  check('склейка никогда не опечатка', cand('Минск+Гомель') === null);
  check('точная форма — не опечатка', cand('Минск') === null && cand('Улан-Уде') === null);
  check('несуществующее-непохожее — не опечатка', cand('Ксилофоноград') === null);
}

// ---------------------------------------------------------------------------
// Перевывод алиасов из своего geonameId
// ---------------------------------------------------------------------------
{
  // Горки (BY): чужие имена Нижнего Новгорода должны уйти, свои остаться.
  const gorkiRow = row({ id: 627905, name: 'Horki', ascii: 'Horki', alts: 'Gorki,Horkai,Horki,ge er ji,hwrky,hwrqy', cc: 'BY', pop: 28626 })!;
  const own = ownFormsOf(gorkiRow, ['Горки']);
  check('ownForms: своё имя первым', normalizeCityName(own[0]) === 'горки', JSON.stringify(own));
  const dumpDomain = new Set(
    ['нижний новгород', 'nizhniy novgorod', 'горький', 'goj', "gor'kij", "gor'kiy", 'gorkey', 'gorkii', 'gorky', 'nijni novgorod'].map(normalizeCityName),
  );
  const plan = planAliasRebuild(
    ['Gorki', 'Horkai', 'Horki', 'Нижний Новгород', 'Nizhniy Novgorod', 'Горький', 'GOJ', 'Gorky'],
    own,
    buildGeonamesCity(gorkiRow, ['Горки']).aliases,
    dumpDomain,
    'Горки',
  )!;
  check('rebuild Горок: чужие 5 удалены', plan.remove.length === 5 && plan.remove.includes('Нижний Новгород') && plan.remove.includes('Горький'));
  check('rebuild Горок: свои сохранены', plan.newAliases.includes('Gorki') && plan.newAliases.includes('Horkai'));

  // Алиас, не выводимый ни из какого дампа (миграция) — сохраняется («улан уде»).
  const ulanRow = row({ id: 2014407, name: 'Ulan-Ude', ascii: 'Ulan-Ude', alts: 'Ulan-Ude,Верхнеудинск', cc: 'RU', pop: 360278 })!;
  const plan2 = planAliasRebuild(
    ['улан уде'],
    ownFormsOf(ulanRow, ['Улан-Удэ']),
    buildGeonamesCity(ulanRow, ['Улан-Удэ']).aliases,
    new Set<string>(), // чужого домена нет
    'Улан-Уде',
  );
  check('не-дамповый алиас «улан уде» сохраняется', plan2 === null || plan2.newAliases?.includes('улан уде'), JSON.stringify(plan2));

  // Чистая запись — расхождений нет (идемпотентность).
  const minskRow = row({ id: 625144, name: 'Minsk', ascii: 'Minsk', alts: 'Минск,Minsk,Mensk', cc: 'BY', pop: 1742124 })!;
  const city = buildGeonamesCity(minskRow, ['Минск', 'Менск']);
  const clean = planAliasRebuild(city.aliases, ownFormsOf(minskRow, ['Минск']), city.aliases, new Set(), 'Минск');
  check('чистая запись: rebuild не нужен (null)', clean === null);
}

// ---------------------------------------------------------------------------
// Слияние двойников
// ---------------------------------------------------------------------------
{
  const canon = { id: 'sankt-peterburg', name: 'Санкт-Петербург', aliases: ['СПб'], usageCount: 7, type: 'город' } as any;
  const merged = { id: 'piter', name: 'Питер', aliases: [], usageCount: 3, type: 'город' } as any;
  const patch = mergeIntoCanonPatch(canon, merged, '2026-01-01T00:00:00Z');
  check('merge: usageCount суммируется', patch.usageCount === 10);
  check('merge: имя двойника ушло в алиасы', (patch.aliases as string[]).includes('Питер'));
  check('merge: mergedFrom записан', Array.isArray(patch.mergedFrom) && (patch.mergedFrom as string[]).includes('piter'));
  check('merge: тип миграции перелит', patch.type === 'город');
  const patchDup = mergeIntoCanonPatch({ ...canon, aliases: ['СПб'] }, { id: 'spb', name: 'СПБ', aliases: [], usageCount: 3 }, '2026-01-01T00:00:00Z');
  check('merge: дубль по норме («СПБ» vs «СПб») не добавлен', (patchDup.aliases as string[]).filter((a) => normalizeCityName(a) === 'спб').length === 1);
}

console.log(`\ntest-cities-cleanup: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
