/**
 * seed-stage-templates — АДДИТИВНЫЙ сид стартовых шаблонов этапов в ветку
 * `stageTemplates` (только создаёт отсутствующие записи; существующие — не
 * перезаписывает). Список названий взят ПО ФАКТУ реальных рейсов
 * (READ-ONLY разведка trips_dashboard.direction + tripTimeline/tripStages):
 *
 *   · Китай (8 рейсов с этапами): типы по числу рейсов — Загрузка (7),
 *     Граница (7), Растаможка (4), Выгрузка (4); порядок в фактах:
 *     Загрузка → Граница → Растаможка → Выгрузка. «Затаможка»
 *     в фактах Китая не встречается — в шаблон не включена.
 *   · Турция (6 рейсов с этапами): по числу рейсов — Растаможка (3),
 *     Выгрузка (3), Загрузка (3), Граница (2), Затаможка (2);
 *     порядок в фактах: Загрузка → Затаможка → Граница →
 *     Растаможка → Выгрузка. Подписи короткие (без «(экспорт)»/«(импорт)»);
 *     записи этапов хранят ключи типов, переименование их не трогает.
 *
 * Запуск: npx tsx scripts/seed-stage-templates.ts  (идемпотентно)
 */
import { adminDb } from '../server/firebaseAdmin.ts';

const STARTERS: Array<{ id: string; name: string; stages: string[] }> = [
  {
    id: 'tpl_turkey',
    name: 'Турция',
    stages: ['Загрузка', 'Затаможка', 'Граница', 'Растаможка', 'Выгрузка'],
  },
  {
    id: 'tpl_china',
    name: 'Китай',
    stages: ['Загрузка', 'Граница', 'Растаможка', 'Выгрузка'],
  },
];

async function main(): Promise<void> {
  if (!adminDb) {
    console.error('[seed-stage-templates] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT в .env/.env.local');
    process.exit(2);
  }
  const snap = await adminDb.ref('stageTemplates').get();
  const existing = (snap.val() || {}) as Record<string, { name?: string }>;
  const existingNames = new Set(Object.values(existing).map((v) => String(v?.name || '').trim().toLowerCase()));
  const now = new Date().toISOString();

  let created = 0;
  for (const t of STARTERS) {
    if (existingNames.has(t.name.toLowerCase())) {
      console.log(`[seed-stage-templates] «${t.name}» уже есть — не трогаем (существующие записи не перезаписываются)`);
      continue;
    }
    await adminDb.ref(`stageTemplates/${t.id}`).set({
      id: t.id,
      name: t.name,
      stages: t.stages,
      updatedAt: now,
      updatedBy: 'seed-stage-templates',
    });
    created += 1;
    console.log(`[seed-stage-templates] создан шаблон «${t.name}»: ${t.stages.join(' → ')}`);
  }
  console.log(`[seed-stage-templates] готово: создано ${created} из ${STARTERS.length}; ветка: stageTemplates`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[seed-stage-templates] ошибка:', (e as Error)?.message || e);
  process.exit(1);
});
