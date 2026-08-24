// Единый источник firebase-конфигурации.
// Конфиг читается из Vite/env (.env / .env.local), без хардкода в коде.
// Если env не задан — fallback на проект ratipa-portal (основная база),
// чтобы деплой/Vercel работал без явной настройки переменных окружения.
// Если VITE_STAGING=true — fallback на проект ratipa-staging (песочница).
//
// Также сохраняется возможность override через localStorage
// ("ratipa_custom_firebase_config") — для переключения проекта из UI.

interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const envConfig: FirebaseEnvConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
};

// Определяем окружение: staging или prod
// VITE_STAGING может быть задан через .env, VITE_STAGING=true, или переменную Vercel
const isStaging = import.meta.env.VITE_STAGING === 'true' || import.meta.env.VITE_STAGING === '1';

const prodFallbackConfig: FirebaseEnvConfig = {
  apiKey: "«redacted»",
  authDomain: "ratipa-portal.firebaseapp.com",
  databaseURL: "https://ratipa-portal-default-rtdb.firebaseio.com",
  projectId: "ratipa-portal",
  storageBucket: "ratipa-portal.firebasestorage.app",
  messagingSenderId: "359074314449",
  appId: "1:359074314449:web:917011dfb51998273aadf0",
};

const stagingFallbackConfig: FirebaseEnvConfig = {
  apiKey: "AIzaSyCrbVq1iN3iDo4vso0gKGF0cvlmxUPw6TM",
  authDomain: "ratipa-staging.firebaseapp.com",
  databaseURL: "https://ratipa-staging-default-rtdb.firebaseio.com",
  projectId: "ratipa-staging",
  storageBucket: "ratipa-staging.firebasestorage.app",
  messagingSenderId: "396977180317",
  appId: "1:396977180317:web:c664bb130e53eabb8e4e74",
};

const fallbackConfig: FirebaseEnvConfig = isStaging ? stagingFallbackConfig : prodFallbackConfig;

export const isFirebaseEnvConfigured = Boolean(envConfig.apiKey) && Boolean(envConfig.databaseURL);

export const defaultFirebaseConfig: FirebaseEnvConfig =
  isFirebaseEnvConfigured ? envConfig : fallbackConfig;

// override из localStorage (если пользователь переключил проект в UI)
export const getCustomFirebaseConfig = (): FirebaseEnvConfig | null => {
  const stored = localStorage.getItem("ratipa_custom_firebase_config");
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return parsed && parsed.apiKey ? (parsed as FirebaseEnvConfig) : null;
  } catch (e) {
    return null;
  }
};

export const firebaseConfig: FirebaseEnvConfig =
  getCustomFirebaseConfig() ?? defaultFirebaseConfig;
