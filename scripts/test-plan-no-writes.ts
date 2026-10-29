/**
 * Страховка: скрипт плана исправлений данных (plan-data-fixes.ts) не должен
 * ничего писать в базу. Проверяет исходник: нет Firebase-клиентов, единственный
 * сетевой вызов — fetch с методом GET, из файловых операций — только создание
 * каталога и запись файла плана.
 * Запуск: npx tsx scripts/test-plan-no-writes.ts  (или npm run test:plan-no-writes)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let failed = 0;
let passed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const dir = fileURLToPath(new URL('.', import.meta.url));
const raw = readFileSync(join(dir, 'plan-data-fixes.ts'), 'utf8');
// Без комментариев: в шапке файла перечислены запрещённые слова.
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

console.log('plan-data-fixes.ts не пишет в базу');
check('нет импорта Firebase / firebase-admin / серверного доступа к базе', !/from\s+['"](firebase|firebase-admin|\.\.\/src\/firebase|\.\.\/server\/firebaseAdmin)[^'"]*['"]/.test(code));
check('нет динамического импорта Firebase', !/import\(\s*['"][^'"]*firebase/i.test(code));
const fetches = code.match(/\bfetch\s*\(/g) || [];
check('ровно один сетевой вызов fetch', fetches.length === 1, String(fetches.length));
const methods = [...code.matchAll(/method\s*:\s*['"]([A-Za-z]+)['"]/g)].map((m) => m[1].toUpperCase());
check('все явные методы запроса — GET', methods.length > 0 && methods.every((m) => m === 'GET'), methods.join(','));
check('нет PUT / POST / PATCH / DELETE', !/\b(PUT|POST|PATCH|DELETE)\b/.test(code));
check('нет тела запроса (body:)', !/\bbody\s*:/.test(code));
check('нет удаления и перезаписи файлов', !/\b(rmSync|unlinkSync|appendFileSync|renameSync|rmdirSync|copyFileSync)\b/.test(code));
check('нет запуска команд (child_process)', !/child_process|execSync|spawn\(/.test(code));
check('файл плана пишется только в каталог scripts/out', /OUT_DIR\s*=\s*join\(.*'out'\)/.test(code) && (code.match(/writeFileSync\(/g) || []).length === 1);

if (failed) {
  console.error(`\nПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`\nВсе проверки пройдены: ${passed}.`);
