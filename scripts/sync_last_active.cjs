const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set, update } = require("firebase/database");

// prod config
const prod = {
  apiKey: "AIzaSyBPa3mLzQ3nk4vS1jyqkUl4S8rX8c_WbC0",
  authDomain: "ratipa-portal.firebaseapp.com",
  databaseURL: "https://ratipa-portal-default-rtdb.firebaseio.com",
  projectId: "ratipa-portal",
};

const app = initializeApp(prod);
const db = getDatabase(app);

async function main() {
  // 1. Get presence data (has real lastActive timestamps)
  console.log("Loading ratipapresence...");
  const pSnap = await get(ref(db, "ratipapresence"));
  const presence = pSnap.val() || {};
  console.log("Found", Object.keys(presence).length, "presence entries");

  // 2. Get users_list
  console.log("Loading users_list...");
  const uSnap = await get(ref(db, "users_list"));
  const users = uSnap.val() || {};
  console.log("Found", Object.keys(users).length, "users");

  // 3. For each user, use the presence lastActive if it's more recent
  let updated = 0;
  for (const [uid, user] of Object.entries(users)) {
    let newTime = user.lastActive || null;

    // Check presence data
    if (presence[uid] && presence[uid].lastActive) {
      const pTime = presence[uid].lastActive;
      if (!newTime || pTime > newTime) {
        newTime = pTime;
      }
    }

    if (newTime && newTime !== user.lastActive) {
      await set(ref(db, `users_list/${uid}/lastActive`), newTime);
      updated++;
      console.log(`  ✓ ${user.name || uid}: ${user.lastActive || '—'} → ${newTime}`);
    }
  }

  console.log(`\nDone! Updated ${updated} users.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});