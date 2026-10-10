/**
 * Загрузка серверных переменных окружения для интеграции Nav.by.
 *
 * Порядок: .env.local перекрывает .env; уже заданные переменные процесса
 * НЕ перезаписываются. Секреты (NAVBY_LOGIN / NAVBY_PASSWORD / NAVBY_TOKEN /
 * FIREBASE_SERVICE_ACCOUNT*) живут только в env сервера и в клиент не попадают.
 *
 * Модуль подключается side-effect-импортом ПЕРВЫМ в точке входа, чтобы
 * firebaseAdmin.ts (инициализация admin SDK) увидел переменные при импорте.
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

const candidates = ['.env.local', '.env']
  .map((f) => path.resolve(process.cwd(), f))
  .filter((p) => existsSync(p));

if (candidates.length) {
  dotenvConfig({ path: candidates, override: false, quiet: true });
}
