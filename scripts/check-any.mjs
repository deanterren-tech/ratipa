#!/usr/bin/env node
/**
 * Заслон от новых `as any`.
 *
 * Полная замена всех `as any` — поэтапная работа, поэтому запрещаем не сами касты,
 * а их РОСТ: сколько было на момент замера, столько и остаётся максимумом.
 * Уменьшил — молодец, обнови baseline вниз. Увеличил без причины — сборка падает.
 *
 * Запускается через `npm run typecheck` и перед сборкой на Vercel.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const BASELINE_FILE = join(ROOT, 'scripts', 'any-baseline.json');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const counts = {};
let total = 0;
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const matches = text.match(/(?<![\w.])as\s+any(?![.\w])/g);
  if (matches && matches.length) {
    const key = relative(ROOT, file);
    counts[key] = matches.length;
    total += matches.length;
  }
}

// --accept: осознанно принять текущее значение (с обоснованием в коммите)
if (process.argv.includes('--accept')) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  console.log(`[check-any] baseline обновлён вручную: ${total}.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : null;

if (!baseline) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  console.log(`[check-any] baseline создан: ${total} кaстов as any в ${Object.keys(counts).length} файлах.`);
  process.exit(0);
}

if (total > baseline.total) {
  const grown = Object.entries(counts)
    .filter(([file, n]) => n > (baseline.files[file] || 0))
    .map(([file, n]) => `  ${file}: ${baseline.files[file] || 0} → ${n}`);
  console.error(
    `[check-any] Появились новые "as any": ${baseline.total} → ${total}.\n` +
    grown.join('\n') +
    '\n\nВместо каста опиши тип. Если каст действительно необходим, обнови baseline:\n' +
    '  node scripts/check-any.mjs --accept\n'
  );
  process.exit(1);
}

if (total < baseline.total) {
  console.log(`[check-any] Кастов стало меньше: ${baseline.total} → ${total}. Обновляю baseline (это улучшение).`);
  writeFileSync(BASELINE_FILE, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  process.exit(0);
}

console.log(`[check-any] Новых "as any" нет (${total}).`);
