const fs = require('fs');
let code = fs.readFileSync('src/firebase/planDohodService.ts', 'utf-8');

if (!code.includes('subscribeDriversCarMapping')) {
  const insertIndex = code.indexOf('// --- DISPATCHERS COLORS ---');
  if (insertIndex !== -1) {
    const newCode = `  // --- DRIVERS CAR MAPPING ---
  subscribeDriversCarMapping: (callback: (mapping: Record<string, string>) => void) => {
    if (!useFirebase) {
        callback({});
        return () => {};
    }
    const dbRef = ref(database, 'drivers_car_mapping');
    return onValue(dbRef, (s) => {
      callback(s.val() || {});
    });
  },

  updateDriversCarMapping: (mapping: Record<string, string>) => {
    if (!useFirebase) return;
    set(ref(database, 'drivers_car_mapping'), mapping);
  },

  `;
    code = code.substring(0, insertIndex) + newCode + code.substring(insertIndex);
    fs.writeFileSync('src/firebase/planDohodService.ts', code);
    console.log("Added drivers_car_mapping methods");
  }
}
