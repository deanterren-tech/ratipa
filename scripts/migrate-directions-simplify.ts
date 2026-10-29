/**
 * migrate-directions-simplify — упрощение справочника `directories/directions`
 * по требованию владельца: варианты переключателя Турция/Китай с КОРОТКИМИ
 * кодами TR/CN; никаких ставок, средних дней и плановых значений.
 *
 * Что делает (идемпотентно, точечно — только записи справочника):
 *  1. добавляет/выставляет `code`: Турция → TR, Китай → CN (у прочих записей
 *     код сохраняется; нет кода — первые две буквы названия, как autoCode);
 *  2. удаляет поля схемы «ставки/дни», которые больше не используются:
 *     plannedRate, plannedCosts, plannedDays, bufferDays, fromCountry,
 *     toCountry (from/to — от прежнего кода «откуда-куда»);
 *  3. coeff / id / dbKey / label / name / active НЕ трогает (реальные данные);
 *  4. записи рейсов (trips_dashboard) НЕ затрагивает вовсе — старые текстовые
 *     значения «Китай»/«Турция» читаются маппингом с фолбэком.
 *
 * Запуск: npx tsx scripts/migrate-directions-simplify.ts
 */
import { adminDb } from '../server/firebaseAdmin.ts';

const BUILTIN_CODE_BY_NAME: Record<string, string> = { 'китай': 'CN', 'турция': 'TR' };
const REMOVE_FIELDS = ['plannedRate', 'plannedCosts', 'plannedDays', 'bufferDays', 'fromCountry', 'toCountry'] as const;

const s = (v: unknown): string => String(v ?? '').trim();

async function main(): Promise<void> {
  if (!adminDb) {
    console.error('[migrate-directions-simplify] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT в .env/.env.local');
    process.exit(2);
  }
  const snap = await adminDb.ref('directories/directions').get();
  const data = (snap.val() || {}) as Record<string, Record<string, unknown>>;
  const keys = Object.keys(data);
  if (!keys.length) {
    console.log('[migrate-directions-simplify] справочник пуст — нечего делать');
    process.exit(0);
  }
  for (const key of keys) {
    const rec = data[key];
    const name = s(rec.name) || s(rec.label) || key;
    const beforeCode = s(rec.code);
    const code = BUILTIN_CODE_BY_NAME[name.toLowerCase()] || beforeCode.toUpperCase() || name.slice(0, 2).toUpperCase();
    const patch: Record<string, unknown> = { code };
    const removed: string[] = [];
    for (const f of REMOVE_FIELDS) {
      if (rec[f] !== undefined) {
        patch[f] = null; // удаление поля (аддитивно: остальные поля записи не трогаем)
        removed.push(`${f}=${JSON.stringify(rec[f])}`);
      }
    }
    await adminDb.ref(`directories/directions/${key}`).update(patch);
    console.log(
      `[migrate-directions-simplify] ${key}: «${name}» code ${beforeCode || '—'} → ${code}` +
        (removed.length ? `; удалено: ${removed.join(', ')}` : '; лишних полей не было'),
    );
  }
  console.log(`[migrate-directions-simplify] готово: записей ${keys.length}. coeff/id/dbKey/label не тронуты.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[migrate-directions-simplify] ошибка:', (e as Error)?.message || e);
  process.exit(1);
});
