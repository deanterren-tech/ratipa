import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, push, update, remove } from "firebase/database";

// ---- Firebase init (inlined) ----
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "REMOVED_GOOGLE_API_KEY",
  authDomain: "ratipa-panel.firebaseapp.com",
  databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  projectId: "ratipa-panel",
  storageBucket: "ratipa-panel.firebasestorage.app",
  messagingSenderId: "726344734944",
  appId: "1:726344734944:web:10f511be867e03f9e71885",
};

let app: any;
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

async function getDbRef(path: string) {
  initFirebase();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return ref(database, path);
}

async function readData(path: string) {
  const dbRef = await getDbRef(path);
  const snapshot = await get(dbRef);
  return snapshot.val();
}

async function readAllBranches() {
  initFirebase();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const snap = await get(ref(database));
  const root = snap.val() || {};
  return {
    vehicleFleet: root.vehicleFleet,
    vehicle_driver_data: root.vehicle_driver_data,
    appSettings: root.appSettings,
    planDohod: root.planDohod,
  };
}

async function writeData(path: string, data: any) {
  const dbRef = await getDbRef(path);
  await set(dbRef, data);
}

async function pushData(path: string, data: any) {
  const dbRef = await getDbRef(path);
  const newRef = push(dbRef);
  await set(newRef, data);
  return newRef.key;
}

async function updateData(path: string, patch: any) {
  const dbRef = await getDbRef(path);
  await update(dbRef, patch);
}

async function removeData(path: string) {
  const dbRef = await getDbRef(path);
  await remove(dbRef);
}

// ---- API helpers (inlined) ----
function checkAgentKey(req: any, res: any) {
  const key = req.headers["x-agent-key"];
  if (key !== process.env.AGENT_API_KEY) {
    res.status(401).json({ success: false, error: "unauthorized", message: "Invalid or missing x-agent-key" });
    return false;
  }
  return true;
}

function sendSuccess(res: any, data: any) {
  res.status(200).json({ success: true, data });
}

function sendError(res: any, status: number, error: string, message: string) {
  res.status(status).json({ success: false, error, message });
}

function setCors(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-agent-key");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

async function logAction(actionType: string, payload: any) {
  try {
    await pushData("agent_logs", {
      actionType,
      initiatedBy: "agent",
      timestamp: new Date().toISOString(),
      payload,
      result: "success",
    });
  } catch (_) {}
}

// ---- Handlers ----
async function handleGetVehicle(req: any, res: any) {
  const { plate } = req.query;
  if (!plate) return sendError(res, 400, "missing_fields", "plate query parameter is required");
  try {
    const bazacars = await readData("vehicleFleet");
    if (!bazacars) return sendError(res, 404, "not_found", "No vehicles found in database");
    const normalizedPlate = plate.toString().toLowerCase().replace(/\s+/g, "");
    let foundVehicle: any = null;
    for (const key in bazacars) {
      const v = bazacars[key];
      const vPlate = (v.carNumber || v.vehicleNumbers || "").toLowerCase().replace(/\s+/g, "");
      if (vPlate === normalizedPlate) {
        foundVehicle = { id: key, ...v };
        break;
      }
    }
    if (!foundVehicle) return sendError(res, 404, "not_found", `Vehicle with plate ${plate} not found`);
    const data = {
      id: foundVehicle.id,
      plate: foundVehicle.carNumber || foundVehicle.vehicleNumbers,
      trailer: foundVehicle.trailerNumber || foundVehicle.trailerMake || "",
      trailerBrand: foundVehicle.trailerBrand || foundVehicle.trailerMake || "",
      brand: foundVehicle.brand || foundVehicle.brandModel || "",
      driver: foundVehicle.driverName || foundVehicle.driverShortNameRu,
      dispatcher: foundVehicle.dispatcher || "",
      status: foundVehicle.status,
      currentLocation: foundVehicle.location || "",
      direction: foundVehicle.direction || "",
    };
    await logAction("getVehicle", { plate });
    return sendSuccess(res, data);
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleGetVehicleFleet(req: any, res: any) {
  try {
    const bazacars = await readData("vehicleFleet");
    const fleet: any[] = [];
    if (bazacars) {
      for (const key in bazacars) {
        const v = bazacars[key];
        fleet.push({
          id: key,
          plate: v.carNumber || v.vehicleNumbers || "",
          trailer: v.trailerNumber || v.trailerMake || "",
          trailerBrand: v.trailerBrand || v.trailerMake || "",
          brand: v.brand || v.brandModel || "",
          driver: v.driverName || v.driverShortNameRu || "",
          dispatcher: v.dispatcher || "",
          status: v.status || "",
          currentLocation: v.location || "",
          direction: v.direction || "",
        });
      }
    }
    await logAction("getVehicleFleet", {});
    return sendSuccess(res, { fleet });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleGetTripByVehicle(req: any, res: any) {
  const { plate, limit = 5 } = req.query;
  if (!plate) return sendError(res, 400, "missing_fields", "plate query parameter is required");
  try {
    const tripsData = await readData("tripsdashboard");
    if (!tripsData) return sendSuccess(res, { trips: [] });
    const normalizedPlate = plate.toString().toLowerCase().replace(/\s+/g, "");
    let trips: any[] = [];
    for (const key in tripsData) {
      const t = tripsData[key];
      if (t.carNumber && t.carNumber.toLowerCase().replace(/\s+/g, "") === normalizedPlate) {
        trips.push({
          id: key,
          route: t.direction || "",
          status: t.isArchived ? "archived" : "active",
          dateStart: t.dateStart || "",
          dateEnd: t.dateEnd || "",
          cargo: t.tripNote || "",
        });
      }
    }
    trips.sort((a: any, b: any) => new Date(b.dateStart).getTime() - new Date(a.dateStart).getTime());
    trips = trips.slice(0, Number(limit));
    await logAction("getTripByVehicle", { plate, limit });
    return sendSuccess(res, { trips });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleGetDozvolaByLocation(req: any, res: any) {
  const { location, vehicleId } = req.query;
  if (!location) return sendError(res, 400, "missing_fields", "location query parameter is required");
  try {
    const permitsData = await readData("dozvolaPermits");
    if (!permitsData) return sendSuccess(res, { permits: [] });
    const normalizedLocation = location.toString().toLowerCase();
    const permits: any[] = [];
    for (const key in permitsData) {
      const p = permitsData[key];
      const countryMatch = p.country && p.country.toLowerCase().includes(normalizedLocation);
      const commentMatch = p.comments && p.comments.toLowerCase().includes(normalizedLocation);
      if (countryMatch || commentMatch) {
        if (vehicleId) {
          if (p.assignedVehicle && p.assignedVehicle !== vehicleId) continue;
        }
        permits.push({
          id: key,
          number: p.permitNumber || "",
          type: p.type || "",
          dateIssued: p.dateIssued || "",
          status: p.status || "",
          location: p.country || "",
          assignedVehicle: p.assignedVehicle || "",
          tripsRemaining: p.tripsRemaining || null,
        });
      }
    }
    await logAction("getDozvolaByLocation", { location, vehicleId });
    return sendSuccess(res, { permits });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleGetInsuranceContractorInfo(req: any, res: any) {
  const data = {
    contractorEmail: "insurance_kz@example.com",
    requiredFields: ["vehiclePlate", "insuranceStartDate", "insuranceDurationDays"],
    emailTemplateInfo: "Укажите госномер тягача, дату начала действия страховки и срок страхования в днях.",
  };
  await logAction("getInsuranceContractorInfo", {});
  return sendSuccess(res, data);
}

async function handleGetDeclarationFormSchema(req: any, res: any) {
  const schema = {
    fields: [
      { name: "tirNumber", type: "string", required: true, format: "XX12345678 (2 letters, 8 digits)", description: "Номер книжки МДП (TIR)" },
      { name: "carrierName", type: "string", required: true, description: "Наименование перевозчика" },
      { name: "vehiclePlate", type: "string", required: true, description: "Госномер тягача" },
      { name: "trailerPlate", type: "string", required: false, description: "Госномер прицепа" },
      { name: "customsPoint", type: "string", required: true, description: "Пункт изъятия (наименование таможни)" },
      { name: "driverName", type: "string", required: true, description: "ФИО водителя" },
      { name: "dateOfWithdrawal", type: "string", required: true, format: "YYYY-MM-DD", description: "Дата изъятия" },
      { name: "reason", type: "string", required: true, description: "Причина изъятия" },
    ],
  };
  return sendSuccess(res, { schema });
}

async function handleCreateDeclarationDraft(req: any, res: any) {
  const payload = req.body;
  if (!payload) return sendError(res, 400, "missing_fields", "Request body is required");
  const requiredFields = ["tirNumber", "carrierName", "vehiclePlate", "customsPoint", "driverName", "dateOfWithdrawal", "reason"];
  const missing = requiredFields.filter((f) => !payload[f]);
  if (missing.length > 0) return sendError(res, 400, "validation_error", `Missing required fields: ${missing.join(", ")}`);
  const tirRegex = /^[A-Za-z]{2}\d{8}$/;
  if (!tirRegex.test(payload.tirNumber)) return sendError(res, 400, "validation_error", "Invalid TIR format. Expected 2 letters followed by 8 digits.");
  try {
    const draftData = { ...payload, createdAt: new Date().toISOString(), status: "draft", source: "agent" };
    const draftId = await pushData("declaration_drafts", draftData);
    await logAction("createDeclarationDraft", { draftId, ...payload });
    return sendSuccess(res, { draftId });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleLogInsuranceRequest(req: any, res: any) {
  const { vehiclePlate, insuranceStartDate, insuranceDurationDays, sentAt, sentBy } = req.body;
  if (!vehiclePlate || !insuranceStartDate || !insuranceDurationDays)
    return sendError(res, 400, "missing_fields", "vehiclePlate, insuranceStartDate, and insuranceDurationDays are required");
  try {
    const logData = {
      vehiclePlate,
      insuranceStartDate,
      insuranceDurationDays,
      sentAt: sentAt || new Date().toISOString(),
      sentBy: sentBy || "agent",
    };
    const requestId = await pushData("insurance_requests", logData);
    await logAction("logInsuranceRequest", logData);
    return sendSuccess(res, { requestId });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

async function handleLogAgentAction(req: any, res: any) {
  const { actionType, initiatedBy, timestamp, payload, result } = req.body;
  if (!actionType || !initiatedBy) return sendError(res, 400, "missing_fields", "actionType and initiatedBy are required");
  try {
    const logData = {
      actionType,
      initiatedBy,
      timestamp: timestamp || new Date().toISOString(),
      payload: payload || {},
      result: result || "unknown",
    };
    const logId = await pushData("agent_logs", logData);
    return sendSuccess(res, { logId });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

// ---- Close trip (bot "Закрытие рейса"): replicates the portal's
// "Фиксировать выплату" (SalaryModule) + "В АРХИВ" (PlanDohodModule) actions.
// Rates come from the coupling record (rate, perDiemRate) and global settings
// (idleRate). Days-in-trip are computed from dateStart..dateEnd. ----
async function handleCloseTrip(req: any, res: any) {
  const b = req.body || {};
  const plate = (b.plate || "").toString().trim();
  const factKm = Number(b.factKm) || 0;
  const dateStart = (b.dateStart || "").toString().trim();
  const dateEnd = (b.dateEnd || "").toString().trim();
  const idleDays = Number(b.idleDays) || 0;
  const bonus = Number(b.bonus) || 0;
  const rate = Number(b.rate) || 0;
  const perDiemRate = Number(b.perDiemRate) || 7;
  const idleRate = Number(b.idleRate) || 30;
  const driver = (b.driver || "").toString().trim();
  const dispatcher = (b.dispatcher || "").toString().trim();
  const carId = b.carId || null;
  const driverId = b.driverId || null;
  const planDohodId = b.planDohodId || null;
  const mark = (b.mark || "").toString().trim();
  const comment = (b.comment || "").toString().trim();
  const logist = (b.logist || "Бот").toString().trim();
  const dryRun = Boolean(b.dryRun);

  if (!plate) return sendError(res, 400, "missing_fields", "plate is required");
  if (!dateStart || !dateEnd) return sendError(res, 400, "missing_fields", "dateStart and dateEnd are required");

  try {
    const parseDate = (s) => {
      if (!s) return null;
      let m = s.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})$/);
      if (m) {
        let y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
        return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
      return null;
    };
    const dS = parseDate(dateStart);
    const dE = parseDate(dateEnd);
    if (!dS || !dE) return sendError(res, 400, "bad_date", "Не распознаны даты");
    const totalDays = Math.max(1, Math.round((dE.getTime() - dS.getTime()) / 86400000) + 1);

    const kmMoney = Math.round(factKm * rate * 100) / 100;
    const idleMoney = Math.round(idleDays * idleRate * 100) / 100;
    const daysMoney = Math.round(totalDays * perDiemRate * 100) / 100;
    const totalSalary = Math.round((kmMoney + idleMoney + bonus) * 100) / 100;
    const salaryPerDay = Math.round((totalSalary / totalDays) * 100) / 100;

    if (dryRun) {
      return sendSuccess(res, {
        dryRun: true,
        car: plate.toUpperCase(),
        driver,
        dispatcher,
        rate,
        perDiemRate,
        idleRate,
        factKm,
        totalDays,
        idleDays,
        kmMoney,
        idleMoney,
        daysMoney,
        bonus,
        totalSalary,
        salaryPerDay,
      });
    }

    const ymMatch = dateStart.match(/(\d{4})$/) || dateStart.match(/^(\d{4})/);
    const ym = ymMatch ? ymMatch[1] + "-" + (() => {
      const mm = parseDate(dateStart);
      return mm ? String(mm.getMonth() + 1).padStart(2, "0") : "01";
    })() : new Date().toISOString().slice(0, 7).replace("-", "-");
    const salaryId = Date.now().toString();
    const salaryLog = {
      id: salaryId,
      datetime: dateStart,
      logist,
      car: plate.toUpperCase(),
      rate,
      km: factKm,
      mark,
      idleDays,
      totalDays,
      bonus,
      kmMoney,
      idleMoney,
      daysMoney,
      comment,
      driver: driver || "НЕ УКАЗАНО",
      totalSalary,
      salaryPerDay,
      carId: carId || null,
      driverId: driverId || null,
    };
    await writeData(`salaryHistory/months/${ym}/${salaryId}`, salaryLog);
    if (dispatcher) {
      await writeData(`salaryHistory/byDispatcher/${dispatcher}/${salaryId}`, salaryLog);
    }
    if (planDohodId) {
      await writeData(`planDohod/${planDohodId}`, {
        factKm: factKm || null,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
        isArchived: true,
      });
    }
    await pushData("agent_logs", {
      actionType: "closeTrip",
      initiatedBy: "agent",
      timestamp: new Date().toISOString(),
      payload: { plate, factKm, dateStart, dateEnd, totalSalary },
      result: "success",
    });
    return sendSuccess(res, {
      salaryId,
      car: salaryLog.car,
      driver,
      dispatcher,
      factKm,
      totalDays,
      idleDays,
      kmMoney,
      idleMoney,
      daysMoney,
      bonus,
      totalSalary,
      salaryPerDay,
    });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", (err && err.message ? err.message : String(err)));
  }
}

async function handlePingTest(req: any, res: any) {
  return sendSuccess(res, { pong: true, build: "closeTrip-2026-07-18" });
}

async function handleGetPlanDohod(req: any, res: any) {
  try {
    const data = await readData("planDohod");
    return sendSuccess(res, { planDohod: data || {} });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleGetCoupling(req: any, res: any) {
  try {
    const data = await readData("vehicle_driver_data");
    return sendSuccess(res, { vehicle_driver_data: data || {} });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handlePrintDeclaration(req: any, res: any) {
  const { draftId } = req.body;
  if (!draftId) return sendError(res, 400, "missing_fields", "draftId is required");
  try {
    const draftsData = await readData("declaration_drafts");
    if (!draftsData || !draftsData[draftId]) return sendError(res, 404, "not_found", `Draft with ID ${draftId} not found`);
    const draft = draftsData[draftId];
    if (draft.status === "printed") return sendError(res, 400, "validation_error", "This declaration has already been printed.");
    const documentUrl = `/api/print/declaration/${draftId}`;
    await logAction("printDeclaration", { draftId, documentUrl });
    return sendSuccess(res, { message: "Declaration queued for printing", documentUrl, draftId });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err.message);
  }
}

// ---- Generic DB layer: covers ALL portal actions ----
// Bots specify the exact DB path. Each GET does exactly 1 read (Vercel-safe);
// writes are write-only. This is the universal escape hatch that exposes every
// function the portal exposes via firebase.ts / modules.
const KNOWN_PATHS = [
  "vehicleFleet", "vehicle_driver_data", "driversPool", "planDohod",
  "trips_dashboard", "salaryHistory", "dozvolsRegistryV4", "dozvolsTypesV4",
  "dozvolsTypesOrderV4", "dozvolsTodoTasksV4", "dozvolsHistoryV4", "locationsDB",
  "locationsDeliveries", "directories", "appSettings", "baza", "baza_cars",
  "archive", "archivecars", "known_fleet", "knownFleetCars", "ferryCouples",
  "ferryContacts", "ferryOrdersData", "bamapTirLastData", "analysisRegions",
  "analysisGroups", "analysisRecords", "users_list", "agent_access_center",
  "audit", "routeCalculations", "ferryTemplates", "routeTemplates",
  "distancePresets", "currencyPresets", "carRateGroups", "directionPresets",
  "dozvolsLossPlacesV1", "dozvolsDocumentsHistoryV1", "dozvolsPermitPrintMappingsV1",
  "global_history",
];

async function handleDbGet(req: any, res: any) {
  const path = (req.query.path || "").toString().trim();
  if (!path) return sendError(res, 400, "missing_fields", "path query parameter is required (e.g. ?path=driversPool)");
  try {
    const data = await readData(path);
    return sendSuccess(res, { path, data: data ?? null });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleDbSet(req: any, res: any) {
  const { path, data } = req.body || {};
  if (!path) return sendError(res, 400, "missing_fields", "path is required");
  if (data === undefined) return sendError(res, 400, "missing_fields", "data is required");
  try {
    await writeData(path, data);
    await logAction("dbSet", { path });
    return sendSuccess(res, { path, written: true });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleDbPush(req: any, res: any) {
  const { path, data } = req.body || {};
  if (!path) return sendError(res, 400, "missing_fields", "path is required");
  if (data === undefined) return sendError(res, 400, "missing_fields", "data is required");
  try {
    const key = await pushData(path, data);
    await logAction("dbPush", { path, key });
    return sendSuccess(res, { path, key });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleDbUpdate(req: any, res: any) {
  const { path, patch } = req.body || {};
  if (!path) return sendError(res, 400, "missing_fields", "path is required");
  if (!patch || typeof patch !== "object") return sendError(res, 400, "missing_fields", "patch (object) is required");
  try {
    await updateData(path, patch);
    await logAction("dbUpdate", { path });
    return sendSuccess(res, { path, updated: true });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleDbRemove(req: any, res: any) {
  const { path } = req.body || {};
  if (!path) return sendError(res, 400, "missing_fields", "path is required");
  try {
    await removeData(path);
    await logAction("dbRemove", { path });
    return sendSuccess(res, { path, removed: true });
  } catch (err: any) {
    return sendError(res, 500, "internal_error", err && err.message ? err.message : String(err));
  }
}

async function handleHelp(req: any, res: any) {
  return sendSuccess(res, {
    info: "RATIPA Agent API — universal DB layer + semantic actions",
    genericActions: {
      dbGet: "GET ?path=<branch> — read one branch (1 read, Vercel-safe)",
      dbSet: "POST {path, data} — set entire node",
      dbPush: "POST {path, data} — push new child, returns key",
      dbUpdate: "POST {path, patch} — merge patch into node",
      dbRemove: "POST {path} — delete node",
    },
    semanticActions: {
      closeTrip: "POST — закрыть рейс + архив planDohod",
      getVehicleFleet: "GET — vehicleFleet",
      getCoupling: "GET — vehicle_driver_data",
      getPlanDohod: "GET — planDohod",
      getVehicle: "GET ?plate= — find vehicle",
      getTripByVehicle: "GET ?plate= — trips_dashboard",
      getDozvolaByLocation: "GET ?location= — dozvolaPermits",
      createDeclarationDraft: "POST — declaration_drafts",
      logInsuranceRequest: "POST — insurance_requests",
      logAgentAction: "POST — agent_logs",
      printDeclaration: "POST {draftId}",
    },
    knownPaths: KNOWN_PATHS,
    note: "Any portal function is reachable via dbSet/dbPush/dbUpdate/dbRemove with the correct path. See AGENT_API_SPEC.md.",
  });
}

// ---- Router (flat: /api/agent?action=...) ----
async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: any) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    // if no stream (already consumed), resolve empty
    setTimeout(() => resolve({}), 50);
  });
}

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  const body = await readBody(req);
  req.body = body;

  const action = ((req.query.action || (req.body && req.body.action) || "").toString()).trim();
  const method = req.method;

  const routes: Record<string, Record<string, any>> = {
    getVehicle: { GET: handleGetVehicle },
    getVehicleFleet: { GET: handleGetVehicleFleet },
    getTripByVehicle: { GET: handleGetTripByVehicle },
    getDozvolaByLocation: { GET: handleGetDozvolaByLocation },
    getInsuranceContractorInfo: { GET: handleGetInsuranceContractorInfo },
    getDeclarationFormSchema: { GET: handleGetDeclarationFormSchema },
    createDeclarationDraft: { POST: handleCreateDeclarationDraft },
    logInsuranceRequest: { POST: handleLogInsuranceRequest },
    logAgentAction: { POST: handleLogAgentAction },
    closeTrip: { POST: handleCloseTrip },
    getPlanDohod: { GET: handleGetPlanDohod },
    getCoupling: { GET: handleGetCoupling },
    pingTest: { GET: handlePingTest },
    printDeclaration: { POST: handlePrintDeclaration },
    dbGet: { GET: handleDbGet },
    dbSet: { POST: handleDbSet },
    dbPush: { POST: handleDbPush },
    dbUpdate: { POST: handleDbUpdate },
    dbRemove: { POST: handleDbRemove },
    help: { GET: handleHelp },
  };

  const route = routes[action];
  if (!route || !route[method]) {
    return sendError(res, 404, "not_found", `No agent route for action='${action}' method=${method}`);
  }
  return route[method](req, res);
}
