// Seed-скрипт: вносит данные по авто и водителям в RTDB.
// Запуск (локально, с Firebase service-account в .env):
//   FIREBASE_SERVICE_ACCOUNT="$(cat path/to/key.json)" npx tsx seedVehicles.ts
//
// Что делает:
//  - читает vehicles.seed.json (43 записи)
//  - пишет авто в tractors/{id} (нормализованные поля, как saveVehicle)
//  - добавляет госномер тягача в known_fleet (если нет)
//  - создаёт водителя в driversPool (если ФИО ещё нет), проставляет driverId в tractor
//  - НЕ трогает baza (учёт выезда) — по требованию владельца
//  - idempotent: существующие не дублирует
//
// ВАЖНО: персональные данные (паспорт, ИНН) из seed НЕ коммитятся в git
// (vehicles.seed.json в .gitignore). Скрипт только пишет в облако.

import { readFileSync } from "fs";
import { adminDb } from "./firebaseAdmin.ts";

interface SeedRow {
  tractor: string;
  trailer: string;
  tractorBrand: string;
  trailerBrand: string;
  driverName: string;
  driverLat: string;
  birthDate: string;
  passport: string;
  inn: string;
  licenseValid: string;
  issuedBy: string;
  license: string;
  phone: string;
  phones: string[];
}

function slug(s: string): string {
  return s.replace(/[^A-Z0-9]/gi, "_");
}

async function main() {
  if (!adminDb) {
    console.error(
      "❌ Firebase Admin SDK не инициализирован. Задайте FIREBASE_SERVICE_ACCOUNT в .env",
    );
    process.exit(1);
  }

  const seedPath = new URL("./vehicles.seed.json", import.meta.url);
  const rows: SeedRow[] = JSON.parse(readFileSync(seedPath, "utf-8"));

  // Читаем существующие данные один раз (для idempotency)
  const [tractorsSnap, knownSnap, driversSnap] = await Promise.all([
    adminDb.ref("tractors").once("value"),
    adminDb.ref("known_fleet").once("value"),
    adminDb.ref("driversPool").once("value"),
  ]);

  const tractors = tractorsSnap.val() || {};
  const knownVals = Object.values(knownSnap.val() || {}) as string[];
  const knownUpper = new Set(knownVals.map((v) => String(v).trim().toUpperCase()));
  const drivers = driversSnap.val() || {};
  const driverNames = new Set(
    Object.values(drivers).map((d: any) => String(d.name || "").trim().toUpperCase()),
  );

  let addedVehicles = 0;
  let skippedVehicles = 0;
  let addedDrivers = 0;
  let addedKnown = 0;

  for (const r of rows) {
    const carNum = r.tractor.trim().toUpperCase();
    const trailerNum = r.trailer.trim().toUpperCase();
    const id = slug(carNum);

    // --- Авто: пропускаем, если уже есть с таким carNumber ---
    const exists = Object.values(tractors).find(
      (t: any) => String(t.carNumber || "").trim().toUpperCase() === carNum,
    );
    if (exists) {
      skippedVehicles++;
      console.log(`⏭  Авто ${carNum} уже есть — пропуск`);
      continue;
    }

    // --- Водитель: создаём, если ФИО ещё нет ---
    let driverId = "";
    if (r.driverName && !driverNames.has(r.driverName.trim().toUpperCase())) {
      driverId = "drv_" + slug(r.driverName);
      await adminDb.ref(`driversPool/${driverId}`).set({
        id: driverId,
        name: r.driverName,
        shortNameLat: r.driverLat || undefined,
        phone: r.phone || undefined,
        phones: r.phones || undefined,
        license: r.license || undefined,
        licenseValid: r.licenseValid || undefined,
        birthDate: r.birthDate || undefined,
        passport: r.passport || undefined,
        inn: r.inn || undefined,
        issuedBy: r.issuedBy || undefined,
      });
      driverNames.add(r.driverName.trim().toUpperCase());
      addedDrivers++;
      console.log(`➕ Водитель: ${r.driverName}`);
    } else {
      // найти существующий id по имени
      const found = Object.entries(drivers).find(
        ([, d]: any) => String(d.name || "").trim().toUpperCase() === r.driverName.trim().toUpperCase(),
      );
      driverId = found ? (found[0] as string) : "";
    }

    // --- Авто: пишем в tractors ---
    const vehicle = {
      id,
      carNumber: carNum,
      vehicleNumbers: carNum,
      trailerNumber: trailerNum,
      brandModel: r.tractorBrand,
      brands: r.tractorBrand,
      trailerMake: r.trailerBrand,
      driverName: r.driverName || "",
      driverId: driverId || undefined,
      driverRaw: r.driverLat || undefined,
      driverPhone: r.phone || "",
      phone: r.phone || "",
      dispatcherName: "",
      dispatcher: "",
      status: "base",
      dateArrival: "",
      dateLoading: "",
      dateRepairStart: "",
      dateRepairEnd: "",
      dateDeparture: "",
      comment: "",
      history: [],
      // персональные данные водителя (для справочника, не ломают чтение)
      passport: r.passport || undefined,
      inn: r.inn || undefined,
      birthDate: r.birthDate || undefined,
      license: r.license || undefined,
      licenseValid: r.licenseValid || undefined,
      issuedBy: r.issuedBy || undefined,
    };
    await adminDb.ref(`tractors/${id}`).set(vehicle);
    addedVehicles++;
    console.log(`➕ Авто: ${carNum} (прицеп ${trailerNum}) → ${r.driverName}`);

    // --- known_fleet: добавляем номер, если нет ---
    if (!knownUpper.has(carNum)) {
      await adminDb.ref("known_fleet").push(carNum);
      knownUpper.add(carNum);
      addedKnown++;
    }
  }

  // Audit
  await adminDb.ref("auditLogs").push({
    user: "seed-script",
    role: "root_admin",
    action: "seed",
    target: "tractors/known_fleet/driversPool",
    detail: `Добавлено авто: ${addedVehicles}, водителей: ${addedDrivers}, known_fleet: ${addedKnown}. Пропущено (уже есть): ${skippedVehicles}.`,
    timestamp: Date.now(),
  });

  console.log("\n=== ИТОГ ===");
  console.log(`Авто добавлено: ${addedVehicles}, пропущено: ${skippedVehicles}`);
  console.log(`Водителей добавлено: ${addedDrivers}`);
  console.log(`known_fleet добавлено: ${addedKnown}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Ошибка seed:", e);
  process.exit(1);
});
