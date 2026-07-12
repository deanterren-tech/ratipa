import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, push } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyClw_tHhyR_s4v5z7_fhMrcujg8qkPohgw",
  authDomain: "ratipa-panel.firebaseapp.com",
  databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  projectId: "ratipa-panel",
  storageBucket: "ratipa-panel.firebasestorage.app",
  messagingSenderId: "726344734944",
  appId: "1:726344734944:web:10f511be867e03f9e71885",
};

let app;
let auth: any;
let database: any;

function initFirebase() {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  auth = getAuth(app);
  database = getDatabase(app);
}

export async function getDbRef(path: string) {
  initFirebase();
  // Ensure we are signed in anonymously so DB rules allow read/write
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return ref(database, path);
}

export async function readData(path: string) {
  const dbRef = await getDbRef(path);
  const snapshot = await get(dbRef);
  return snapshot.val();
}

export async function writeData(path: string, data: any) {
  const dbRef = await getDbRef(path);
  await set(dbRef, data);
}

export async function pushData(path: string, data: any) {
  const dbRef = await getDbRef(path);
  const newRef = push(dbRef);
  await set(newRef, data);
  return newRef.key;
}
