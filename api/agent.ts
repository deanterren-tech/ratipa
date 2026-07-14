import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, push } from "firebase/database";

// ---- Firebase init (inlined) ----
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDwUpBu4bWhkQ0wylQ88zZ7nohgw",
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

// ---- Router (flat: /api/agent?action=...) ----
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  const action = (req.query.action || "").toString();
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
    printDeclaration: { POST: handlePrintDeclaration },
  };

  const route = routes[action];
  if (!route || !route[method]) {
    return sendError(res, 404, "not_found", `No agent route for action='${action}' method=${method}`);
  }
  return route[method](req, res);
}
