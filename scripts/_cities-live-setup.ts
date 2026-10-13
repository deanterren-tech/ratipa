/**
 * СЛУЖЕБНЫЙ скрипт живых прогонов CityInput (НЕ для продакшена руками).
 * Режимы:
 *   setup    — создать пробные профили (probe-city-admin/exec), сессии в scratch,
 *              тестовые города (Тестоград-*) для живых сценариев;
 *   check    — показать текущее состояние веток cities/appSettings/auditLogs;
 *   cleanup  — удалить ВСЁ тестовое: города testograd*, профили probe-city-*,
 *              appSettings/geonames (созданный тестом), свежие auditLogs прогона.
 *
 * Запуск: npx tsx scripts/_cities-live-setup.ts setup|check|cleanup
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb } from '../firebaseAdmin.ts';

const MODE = process.argv[2] || 'check';
const OUT = '/Users/sergei/.hermes/cache/scratch/cities2';

const now = (): string => new Date().toISOString();

const ADMIN_SESSION = {
  uid: 'probe-city-admin',
  name: 'probe-city-admin',
  email: 'probe-city-admin@local',
  role: 'root_admin',
  permissions: { planDohod: 'write', tripTimeline: 'write', settings: 'write', baza: 'write' },
  onboarding: { '2_0_0': 'shown' },
  plDohodAnnounceSeen: true,
  tlGuide: { at: now(), status: 'done', step: 9, version: '1.3.0' },
  tlPrefs: { columnHighlight: false, paintByDirection: true },
  lastActive: now(),
  createdAt: now(),
  isDispatcher: false,
};

const EXEC_SESSION = {
  uid: 'probe-city-exec',
  name: 'probe-city-exec',
  email: 'probe-city-exec@local',
  role: 'dispatcher',
  permissions: { dohod: 'write', salary: 'write', planDohod: 'read', tripTimeline: 'write', baza: 'read', settings: 'none' },
  onboarding: { '2_0_0': 'shown' },
  plDohodAnnounceSeen: true,
  tlGuide: { at: now(), status: 'done', step: 9, version: '1.3.0' },
  tlPrefs: { columnHighlight: false, paintByDirection: true },
  lastActive: now(),
  createdAt: now(),
  isDispatcher: true,
};

const SEED_CITIES: Record<string, Record<string, unknown>> = {
  'testograd-alfa': {
    id: 'testograd-alfa', name: 'Тестоград-Альфа', country: 'ZZ', type: 'город',
    aliases: ['testograd', 'Testograd Alpha'], usageCount: 5, source: 'test',
    author: 'probe-city-admin', createdAt: now(),
  },
  'testograd-dupe-a': {
    id: 'testograd-dupe-a', name: 'Тестоград-Дубль', country: 'ZZ', type: 'город',
    aliases: ['testograd dupe'], usageCount: 2, source: 'test',
    author: 'probe-city-admin', createdAt: now(),
  },
  'testograd-dupe-b': {
    id: 'testograd-dupe-b', name: 'Тестоград-Дубль-Бэ', country: 'ZZ', type: 'город',
    aliases: ['testograd dupe b', 'Тестодубль'], usageCount: 3, source: 'test',
    author: 'probe-city-admin', createdAt: now(),
  },
};

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('Admin SDK недоступен');
    return 2;
  }
  mkdirSync(OUT, { recursive: true });

  if (MODE === 'setup') {
    await adminDb.ref('users_list/probe-city-admin').set({ ...ADMIN_SESSION, lastActive: now() });
    await adminDb.ref('users_list/probe-city-exec').set({ ...EXEC_SESSION, lastActive: now() });
    writeFileSync(join(OUT, 'probe-admin.json'), JSON.stringify(ADMIN_SESSION, null, 1), 'utf8');
    writeFileSync(join(OUT, 'probe-exec.json'), JSON.stringify(EXEC_SESSION, null, 1), 'utf8');
    await adminDb.ref('cities').update(SEED_CITIES);
    console.log('[setup] профили probe-city-admin/exec, сессии и тестовые города записаны');
    console.log('[setup] seeded:', Object.keys(SEED_CITIES).join(', '));
    return 0;
  }

  if (MODE === 'cleanup') {
    const cities = (await adminDb.ref('cities').get()).val() as Record<string, unknown> | null;
    const del: Record<string, null> = {};
    Object.keys(cities || {}).forEach((id) => {
      if (/^testograd|^probe/.test(id)) del[`cities/${id}`] = null;
    });
    ['users_list/probe-city-admin', 'users_list/probe-city-exec'].forEach((p) => { del[p] = null; });
    // ВАЖНО: appSettings/geonames здесь НЕ удаляем — с 13.10.2026 это рабочие
    // настройки администратора (страны и пороги GeoNames), а не артефакт теста.
    // ЖИВОЙ тест настроек больше не должен писать их в боевой узел или обязан
    // восстанавливать прежнее значение сам.
    const gnProbe = (await adminDb.ref('appSettings/geonamesProbe').get()).val();
    if (gnProbe) del['appSettings/geonamesProbe'] = null;
    // свежие auditLogs прогона (пишутся через logAction от probe-city-*)
    try {
      const snap = await adminDb.ref('auditLogs').limitToLast(800).get();
      const recs = (snap.val() || {}) as Record<string, Record<string, unknown>>;
      Object.entries(recs).forEach(([id, r]) => {
        const u = String(r?.user ?? '');
        const desc = String(r?.description ?? '') + String(r?.action ?? '');
        if (u.includes('probe-city') || /Тестоград/.test(desc)) del[`auditLogs/${id}`] = null;
      });
    } catch (e) {
      console.warn('[cleanup] auditLogs не очищены:', (e as Error).message);
    }
    if (Object.keys(del).length) await adminDb.ref().update(del);
    console.log(`[cleanup] удалено путей: ${Object.keys(del).length}`);
    Object.keys(del).forEach((p) => console.log('   -', p));
    return 0;
  }

  // check
  const cities = (await adminDb.ref('cities').get()).val();
  const gn = (await adminDb.ref('appSettings/geonames').get()).val();
  console.log('[check] cities:', cities ? JSON.stringify(Object.keys(cities as object)) : 'ОТСУТСТВУЕТ');
  if (cities) console.log('[check] cities содержимое:', JSON.stringify(cities).slice(0, 1200));
  console.log('[check] appSettings/geonames:', gn ? JSON.stringify(gn) : 'ОТСУТСТВУЕТ');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
