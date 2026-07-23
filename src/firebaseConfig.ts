// Единый источник firebase-конфигурации.
// Конфиг читается из Vite/env (.env / .env.local), без хардкода в коде.
// Если env не задан — fallback на проект ratipa-panel (старое поведение fresh),
// чтобы ничего не сломалось.
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

const fallbackConfig: FirebaseEnvConfig = {
  apiKey: "«redacted»",
  authDomain: "ratipa-panel.firebaseapp.com",
  databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  projectId: "ratipa-panel",
  storageBucket: "ratipa-panel.firebasestorage.app",
  messagingSenderId: "726344734944",
  appId: "1:726344734944:web:10f511be867e03f9e71885",
};

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
