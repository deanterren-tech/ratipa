const admin = require("firebase-admin");
const fs = require("fs");
const https = require("https");

// --- Source: ratipa-panel (read) ---
const saSource = JSON.parse(fs.readFileSync("/Users/sergei/ratipa-firebase-admin.json", "utf8"));
if (saSource.private_key && saSource.private_key.includes("\\n")) {
  saSource.private_key = saSource.private_key.replace(/\\n/g, "\n");
}

let sourceApp;
try {
  sourceApp = admin.initializeApp({
    credential: admin.credential.cert(saSource),
    databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  }, "ratipa-panel");
} catch (e) {
  console.log("SOURCE_INIT_ERR:", e.message);
  process.exit(1);
}
const sourceDb = sourceApp.database();

async function migrate() {
  // Read from source
  let data;
  try {
    const snap = await sourceDb.ref("knownDistancesList").once("value");
    data = snap.val();
  } catch (e) {
    console.log("SOURCE_READ_ERR:", e.message);
    process.exit(1);
  }

  if (!data) {
    console.log("SOURCE_EMPTY: knownDistancesList is empty");
    process.exit(0);
  }

  const keys = Object.keys(data);
  console.log("SOURCE: found", keys.length, "records");

  // --- Write to ratipa-portal via REST API (uses Admin SDK or database secret) ---
  // Try using the ratipa-panel SA to also write to ratipa-portal (if it has access)
  // Or use the database URL directly with a PUT request

  const targetUrl = "https://ratipa-portal-default-rtdb.firebaseio.com/knownDistancesList.json";

  // Try writing via REST — the RTDB rules might allow it if properly configured
  try {
    const body = JSON.stringify(data);
    await new Promise((resolve, reject) => {
      const req = https.request(targetUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
      }, (res) => {
        let resp = "";
        res.on("data", (chunk) => resp += chunk);
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log("TARGET: written via REST, status", res.statusCode);
            resolve();
          } else {
            console.log("TARGET_REST_ERR:", res.statusCode, resp.slice(0, 200));
            reject(new Error(resp));
          }
        });
      });
      req.on("error", (e) => reject(e));
      req.write(body);
      req.end();
    });
  } catch (e) {
    console.log("REST_WRITE_ERR:", e.message);
    // Fallback: try Admin SDK with target SA
    try {
      const saTarget = JSON.parse(fs.readFileSync("/Users/sergei/ratipa-portal-admin.json", "utf8"));
      let pk = saTarget.private_key;
      // Various fixes for private key
      pk = pk.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      if (pk.includes("\\n")) pk = pk.replace(/\\n/g, "\n");
      saTarget.private_key = pk;
      const targetApp = admin.initializeApp({
        credential: admin.credential.cert(saTarget),
        databaseURL: "https://ratipa-portal-default-rtdb.firebaseio.com",
      }, "ratipa-portal");
      const targetDb = targetApp.database();
      await targetDb.ref("knownDistancesList").set(data);
      console.log("TARGET: written via Admin SDK,", keys.length, "records");
    } catch (e2) {
      console.log("TARGET_ADMIN_ERR:", e2.message);
      // Last resort: save to file for manual import
      fs.writeFileSync("/tmp/distances_export.json", JSON.stringify(data, null, 2));
      console.log("EXPORTED to /tmp/distances_export.json");
    }
  }
  process.exit(0);
}

migrate();