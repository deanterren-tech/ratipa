// Server-side Firebase Admin SDK инициализация.
// Используется Agent API для верификации ID-токенов пользователей (delegated-режим)
// и для server-side мутаций в ту же RTDB, что и клиент.
//
// Конфигурация (env, через .env или переменные окружения):
//   FIREBASE_SERVICE_ACCOUNT  — JSON строкой (service-account key)
//   либо по отдельности:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (с \n для переносов)
//   FIREBASE_DATABASE_URL     — RTDB url (по умолчанию ratipa-portal-default-rtdb)
//
// Если ключ не задан — adminApp/adminDb = null, Agent API вернёт 503 с понятной ошибкой.

import { initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

const DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://ratipa-portal-default-rtdb.firebaseio.com";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "ratipa-portal";

function buildCredential(): any | null {
  // 1. Полный JSON в одной переменной
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } catch (e) {
      console.warn(
        "[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT невалидный JSON:",
        (e as Error).message,
      );
    }
  }
  // 2. По отдельным полям
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey && PROJECT_ID) {
    return cert({ projectId: PROJECT_ID, clientEmail, privateKey });
  }
  return null;
}

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Database | null = null;

const credential = buildCredential();

if (credential) {
  try {
    adminApp = initializeApp({
      credential,
      databaseURL: DATABASE_URL,
      projectId: PROJECT_ID,
    });
    adminAuth = getAuth(adminApp);
    adminDb = getDatabase(adminApp);
    console.log("[firebaseAdmin] Admin SDK инициализирован ✓");
  } catch (e) {
    console.warn(
      "[firebaseAdmin] Ошибка инициализации Admin SDK:",
      (e as Error).message,
    );
  }
} else {
  console.warn(
    "[firebaseAdmin] Service-account не задан — Agent API недоступен (503). " +
      "Задайте FIREBASE_SERVICE_ACCOUNT в .env",
  );
}

export { adminApp, adminAuth, adminDb, DATABASE_URL, PROJECT_ID };
