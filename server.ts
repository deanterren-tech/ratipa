import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import fs from "fs";

// Initialize Gemini safely
let ai: GoogleGenAI | null = null;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
} catch (e) {
  console.warn(
    "Failed to initialize GoogleGenAI. Will fail gracefully on use.",
  );
}

function handleGeminiError(e: any, res: any, defaultMsg: string) {
  console.error(`${defaultMsg}:`, e);
  let errMsg = e?.message || String(e || "Ошибка при обращении к ИИ");
  
  // Check for common connection errors or geoblocks when running locally in Russia/Belarus
  const lowerMsg = errMsg.toLowerCase();
  if (
    lowerMsg.includes("fetch failed") || 
    lowerMsg.includes("econnrefused") || 
    lowerMsg.includes("econnreset") || 
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("unreachable") ||
    lowerMsg.includes("user location is not supported") ||
    lowerMsg.includes("location not supported") ||
    lowerMsg.includes("geoblock") ||
    lowerMsg.includes("blocked")
  ) {
    errMsg += " (ИИ заблокирован в вашем регионе. Если сервер запущен локально без ВПН, настройте GOOGLE_GEMINI_BASE_URL в .env или включите ВПН на сервере)";
  }
  
  res.status(500).json({ error: errMsg });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

const CITY_COORDS: { [key: string]: { lat: number; lng: number } } = {
  москва: { lat: 55.7558, lng: 37.6173 },
  moscow: { lat: 55.7558, lng: 37.6173 },
  "санкт-петербург": { lat: 59.9343, lng: 30.3351 },
  "st petersburg": { lat: 59.9343, lng: 30.3351 },
  питер: { lat: 59.9343, lng: 30.3351 },
  екатеринбург: { lat: 56.8389, lng: 60.6057 },
  ekaterinburg: { lat: 56.8389, lng: 60.6057 },
  екат: { lat: 56.8389, lng: 60.6057 },
  подольск: { lat: 55.4312, lng: 37.5458 },
  podolsk: { lat: 55.4312, lng: 37.5458 },
  минск: { lat: 53.9006, lng: 27.559 },
  minsk: { lat: 53.9006, lng: 27.559 },
  алматы: { lat: 43.2389, lng: 76.8897 },
  almaty: { lat: 43.2389, lng: 76.8897 },
  астана: { lat: 51.1694, lng: 71.4491 },
  astana: { lat: 51.1694, lng: 71.4491 },
  ташкент: { lat: 41.2995, lng: 69.2401 },
  tashkent: { lat: 41.2995, lng: 69.2401 },
  стамбул: { lat: 41.0082, lng: 28.9784 },
  istanbul: { lat: 41.0082, lng: 28.9784 },
  тбилиси: { lat: 41.7151, lng: 44.8271 },
  tbilisi: { lat: 41.7151, lng: 44.8271 },
  ереван: { lat: 40.1792, lng: 44.5152 },
  yerevan: { lat: 40.1792, lng: 44.5152 },
  новосибирск: { lat: 55.0084, lng: 82.9357 },
  novosibirsk: { lat: 55.0084, lng: 82.9357 },
  краснодар: { lat: 45.0355, lng: 38.9753 },
  krasnodar: { lat: 45.0355, lng: 38.9753 },
  челябинск: { lat: 55.1644, lng: 61.4368 },
  chelyabinsk: { lat: 55.1644, lng: 61.4368 },
  казань: { lat: 55.8304, lng: 49.0661 },
  kazan: { lat: 55.8304, lng: 49.0661 },
  "нижний новгород": { lat: 56.2965, lng: 43.936 },
  "nizhny novgorod": { lat: 56.2965, lng: 43.936 },
  самара: { lat: 53.2001, lng: 50.15 },
  samara: { lat: 53.2001, lng: 50.15 },
  ростов: { lat: 47.2357, lng: 39.7015 },
  rostov: { lat: 47.2357, lng: 39.7015 },
  уфа: { lat: 54.7388, lng: 55.9721 },
  ufa: { lat: 54.7388, lng: 55.9721 },
  красноярск: { lat: 56.0153, lng: 92.8932 },
  krasnoyarsk: { lat: 56.0153, lng: 92.8932 },
  пермь: { lat: 58.0097, lng: 56.2294 },
  perm: { lat: 58.0097, lng: 56.2294 },
  воронеж: { lat: 51.672, lng: 39.1843 },
  voronezh: { lat: 51.672, lng: 39.1843 },
  волгоград: { lat: 48.708, lng: 44.5133 },
  volgograd: { lat: 48.708, lng: 44.5133 },
  тюмень: { lat: 57.1522, lng: 65.5272 },
  tyumen: { lat: 57.1522, lng: 65.5272 },
  брест: { lat: 52.0976, lng: 23.7341 },
  brest: { lat: 52.0976, lng: 23.7341 },
  сочи: { lat: 43.5853, lng: 39.7203 },
  sochi: { lat: 43.5853, lng: 39.7203 },
  владивосток: { lat: 43.1198, lng: 131.8869 },
  vladivostok: { lat: 43.1198, lng: 131.8869 },
  хабаровск: { lat: 48.4727, lng: 135.0577 },
  khabarovsk: { lat: 48.4727, lng: 135.0577 },
  варшава: { lat: 52.2297, lng: 21.0122 },
  warsaw: { lat: 52.2297, lng: 21.0122 },
  берлин: { lat: 52.52, lng: 13.405 },
  berlin: { lat: 52.52, lng: 13.405 },
  вильнюс: { lat: 54.6872, lng: 25.2797 },
  vilnius: { lat: 54.6872, lng: 25.2797 },
  рига: { lat: 56.9496, lng: 24.1052 },
  riga: { lat: 56.9496, lng: 24.1052 },
  таллин: { lat: 59.437, lng: 24.7536 },
  tallinn: { lat: 59.437, lng: 24.7536 },
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for proxying geocoding calls safely without client-side CORS / billing issues
  app.get("/api/geocode", async (req, res) => {
    try {
      const address = ((req.query.address as string) || "").trim();
      if (!address) {
        return res
          .status(400)
          .json({ error: "Missing address query parameter" });
      }

      // Check local cache dictionary first
      const normalized = address.toLowerCase();
      for (const [cityName, coords] of Object.entries(CITY_COORDS)) {
        if (normalized.includes(cityName)) {
          return res.json({ ...coords, success: true });
        }
      }

      // Second, try Nominatim with proper identifying User-Agent headers
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        const nRes = await fetch(url, {
          headers: {
            "User-Agent":
              "CargoSchedulerApplet/1.0 (contact: deanterren@gmail.com)",
            Accept: "application/json",
          },
        });

        if (nRes.ok) {
          const data = await nRes.json();
          if (data && data[0]) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            return res.json({ lat, lng, success: true });
          }
        }
      } catch (err) {
        console.warn("Nominatim fetch proxy failed:", err);
      }

      // Third, provide a deterministic fallback lat/lng based on string hash so that
      // coordinates differ slightly but fall within key administrative regions
      let hash = 0;
      for (let i = 0; i < address.length; i++) {
        hash = address.charCodeAt(i) + ((hash << 5) - hash);
      }
      const latOffset = (Math.abs(hash % 1000) / 1000) * 10 - 5;
      const lngOffset = (Math.abs((hash >> 3) % 1000) / 1000) * 20 - 10;
      const lat = 55.7558 + latOffset;
      const lng = 37.6173 + lngOffset;

      return res.json({ lat, lng, success: true });
    } catch (e: any) {
      console.error("Geocoding handler error:", e);
      res.status(500).json({ error: e.message || "Geocoding failed" });
    }
  });

  // API Route for reverse geocoding when dragging map markers
  app.get("/api/reverse-geocode", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: "Invalid lat or lng parameters" });
      }

      // Try reverse geocoding via Nominatim
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru,en`;
        const nRes = await fetch(url, {
          headers: {
            "User-Agent":
              "CargoSchedulerApplet/1.0 (contact: deanterren@gmail.com)",
            Accept: "application/json",
          },
        });

        if (nRes.ok) {
          const data = await nRes.json();
          if (data && data.address) {
            const addr = data.address;
            const placeName =
              addr.city ||
              addr.town ||
              addr.village ||
              addr.hamlet ||
              addr.suburb ||
              addr.road ||
              addr.county ||
              "Точка на карте";
            const country = addr.country ? `, ${addr.country}` : "";
            const formatted = `${placeName}${country}`;
            return res.json({ address: formatted, success: true });
          } else if (data && data.display_name) {
            return res.json({
              address: data.display_name.split(",").slice(0, 2).join(","),
              success: true,
            });
          }
        }
      } catch (err) {
        console.warn("Nominatim reverse geocode failed:", err);
      }

      // Fallback if reverse geocoding fails
      return res.json({
        address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        success: true,
      });
    } catch (e: any) {
      console.error("Reverse geocoding error:", e);
      res.status(500).json({ error: e.message || "Reverse geocoding failed" });
    }
  });

  // API Route for parsing Dozvola scans
  app.post(
    "/api/parse-dozvola",
    upload.array("images", 10),
    async (req, res) => {
      try {
        if (!ai) {
          return res
            .status(500)
            .json({ error: "Gemini API key not configured on the server." });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({ error: "No image files provided." });
        }

        const parts = files.map((file) => {
          const base64Data = file.buffer.toString("base64");
          return {
            inlineData: {
              data: base64Data,
              mimeType: file.mimetype,
            },
          };
        });

        const typesContext = req.body.types || "";

        // We ask Gemini to parse all permits from the images and return JSON array
        const promptText = `
You are an expert logistics data extractor.
Analyze the provided images of transport permits (dozvol/дозвол). 
Extract the following information from EACH permit found:
1. "type": The abbreviation of the permit country/type. Examples: RUS, TR A, TR B, UZ 4, KZ3, GE, CHN 2. Often found as stamps or text. 
   Supported types: ${typesContext || "RUS, TR A, TR B, UZ 2, UZ 3, UZ 4, GE, AM3, KZ3, CHN 2, CHN 3"}
2. "number": The serial number of the permit (usually 3 to 8 digits long, colored red or prominently printed).
3. "car": If there is a handwritten or printed car license plate number (e.g. AB1234-5), extract it here.

Return a JSON array of objects, where each object represents one scanned permit:
[
  {
    "type": "RUS",
    "number": "123456",
    "car": "AB1234-5"
  }
]
If you cannot find some data, leave it as an empty string. Only return valid JSON. Do not return markdown blocks.`;

        const partsWithText: any[] = [{ text: promptText }, ...parts];

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: { parts: partsWithText },
          config: {
            systemInstruction:
              "You are a helpful logistics data extractor. Return only a JSON array.",
          },
        });

        let jsonStr = response.text || "";

        const jsonMatch =
          jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
          jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
        let parsed = [];
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          parsed = JSON.parse(jsonStr);
        }

        res.json({ results: parsed });
      } catch (e: any) {
        handleGeminiError(e, res, "Failed to process images");
      }
    },
  );

  // API Route for parsing driver and vehicle data text
  app.post("/api/parse-driver-data", async (req, res) => {
    try {
      if (!ai) {
        return res
          .status(500)
          .json({ error: "Gemini API key not configured on the server." });
      }

      const { text } = req.body;
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Empty text provided" });
      }

      const promptText = `
You are a helpful logistics data extractor.
Analyze the following unstructured text description of a vehicle and its driver.
Extract the fields exactly into the JSON object matching this schema:

{
  "vehicleNumbers": "The vehicle state number / trailer state number, e.g., 'AE 6052-7 / A 2453 Е-7'",
  "brands": "The vehicle brand / trailer brand, e.g., 'Volvo / KOEGEL' or 'Scania / Schmitz'",
  "driverName": "The driver's full name (usually in Cyrillic, with Latin in parentheses), e.g., 'Устинов Олег Леонидович (USTSINAU ALEH)'",
  "birthDate": "Birth date in format DD.MM.YYYY",
  "passportNumber": "Passport number, e.g., 'МР 5065058'",
  "personalId": "Passport personal identification number, e.g., '3080273A018PB6'",
  "passportStart": "Passport issue date in format DD.MM.YYYY",
  "passportEnd": "Passport expiration date in format DD.MM.YYYY",
  "passportIssuedBy": "Entity that issued the passport, e.g., 'Фрунзенским РУВД г. Минска'",
  "phone": "Driver's phone number, e.g., '+375 29 538-96-00'",
  "dispatcher": "First name of the dispatcher if mentioned, e.g. 'Юрий', 'Алексей', 'Татьяна', or keep empty if not specified"
}

Ensure all dates are converted or kept in the DD.MM.YYYY format.
If you cannot find a certain field, set its value to "".
Only return valid JSON inside a codeblock or raw. Do not return markdown except if needed, but preferably raw JSON.

Unstructured Text:
${text}
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          systemInstruction:
            "You are a precise data extractor. You must only return valid JSON matching the schema.",
        },
      });

      let jsonStr = response.text || "";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = {};
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr);
      }

      res.json({ results: parsed });
    } catch (e: any) {
      handleGeminiError(e, res, "Parse driver data API error");
    }
  });

  // API Route for text parsing as well (if you want to keep the old text assistant with AI)
  app.post("/api/parse-dozvola-text", async (req, res) => {
    try {
      // We can just keep the old one client-side if it just uses regex,
      // no need to implement here unless we want to use Gemini for it.
      res.json({ status: "ok" });
    } catch (e) {
      res.status(500).json({ error: "error" });
    }
  });

  // API Route for text parsing in Dohod (Calculation)
  app.post("/api/parse-dohod-text", async (req, res) => {
    try {
      if (!ai) {
        return res
          .status(500)
          .json({ error: "Gemini API key not configured on the server." });
      }

      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }

      const promptText = `
You are an intelligent logistics data extraction assistant for calculating transport revenue (калькуляция).
Extract structured data about the route legs and total travel time from the user's text.
Text: "${text}"

Rules for extraction:
1. Identify all segments of the route (legs). For each leg, identify the "from" city, "to" city, the freight amount, currency, and empty run (доезд км) if specified.
2. The user might write "Минск - Москва 120 тыс рос руб" -> from: Минск, to: Москва, amount: 120000, currency: RUB.
3. If they say "едем 6 дней" -> total_days: 6.
4. Currencies must be one of: EUR, USD, RUB, BYN, CNY. Guess the correct one (e.g. "рос руб" or "рублей" often means RUB, "евро" or "€" is EUR, "долларов" is USD).
5. If the user specifies an amount with "тыс" or "к", multiply it by 1000 (e.g. 120 тыс = 120000).

Return a JSON object with this structure:
{
  "legs": [
    { "from": "Минск", "to": "Москва", "amount": 120000, "currency": "RUB", "emptyRun": 0 }
  ],
  "total_days": 6 // or null if not mentioned
}
Do not return Markdown. Return raw JSON object only.
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          systemInstruction:
            "You are a helpful logistics data extractor. Return only a JSON object.",
        },
      });

      let jsonStr = response.text || "{}";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = { legs: [], total_days: null };
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr);
      }

      res.json(parsed);
    } catch (e: any) {
      handleGeminiError(e, res, "Failed to process text in dohod");
    }
  });

  // API Route for text parsing in PlanDohod
  app.post("/api/parse-plandohod-text", async (req, res) => {
    try {
      if (!ai) {
        return res
          .status(500)
          .json({ error: "Gemini API key not configured on the server." });
      }

      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }

      const promptText = `
You are an intelligent logistics data extraction assistant for calculating transport revenue planning.
Extract structured data about the route legs from the user's text.
Text: "${text}"

Rules for extraction:
1. Identify all segments of the route (legs). For each leg, identify the "from" city, "to" city, the freight rate, the km distance, empty run distance (доезд км), the ferry cost, and the coefficient.
2. Example: "Минск - Москва ставка 1200 евро, 750 км, паром 100" -> from: Минск, to: Москва, rate: 1200, km: 750, ferry: 100.
3. If any field is missing, set it to 0.

Return a JSON object with this structure:
{
  "legs": [
    { "from": "Минск", "to": "Москва", "rate": 1200, "km": 750, "emptyRunKm": 0, "ferry": 100, "coeff": 0 }
  ]
}
Do not return Markdown. Return raw JSON object only.
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          systemInstruction:
            "You are a helpful logistics data extractor. Return only a JSON object.",
        },
      });

      let jsonStr = response.text || "{}";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = { legs: [] };
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr);
      }

      res.json(parsed);
    } catch (e: any) {
      handleGeminiError(e, res, "Failed to process text in plandohod");
    }
  });

  app.post("/api/parse-analysis-text", async (req, res) => {
    try {
      if (!ai) {
        return res
          .status(500)
          .json({ error: "Gemini API key not configured on the server." });
      }

      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }

      const promptText = `
You are an intelligent logistics data extraction assistant.
Extract structured data from the following text to add to a route table.
Text: "${text}"

Fields to extract:
1. route (Маршрут): string (e.g., "Подольск - Екат")
2. rate (Ставка): string (e.g., "130 к без НДС")
3. contact (Контора и контакт): string (e.g., "Детроит - супер заявка")

Return a JSON array of objects with these fields.
[
   { "route": "...", "rate": "...", "contact": "..." }
]
Do not return Markdown. Return raw JSON array only.
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          systemInstruction:
            "You are a helpful logistics data extractor. Return only a JSON array.",
        },
      });
      let jsonStr = response.text || "[]";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = [];
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr);
      }
      // If object returned by mistake, wrap it
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }
      res.json({ results: parsed });
    } catch (e: any) {
      handleGeminiError(e, res, "Failed to process text in analysis");
    }
  });

  app.post("/api/parse-couple-data", async (req, res) => {
    try {
      const { text, image } = req.body;
      if (!ai) {
        throw new Error("Сервер не настроен: отсутствует GEMINI_API_KEY");
      }

      const promptText = `
You are an AI assistant that extracts tractor-trailer (сцепка) details for a ferry booking order from raw text messages or document screenshots.
Please parse the provided text or image carefully and extract these fields. Return a single valid JSON object containing these exact fields:

- stateNumber: String (the tractor and trailer state plate numbers, e.g. "AX1587-7/A1063E-7". Always combine tractor number and trailer number with a slash if both are present)
- model: String (the brand/model of the truck, e.g. "VOLVO", "SCANIA", "MAN", "MERCEDES")
- vehicleType: String (the trailer type, e.g. "Тент 90м3", "Рефрижератор", "Сцепка 120м3")
- dimensions: String (trailer dimensions, e.g. "13.6м x 2.45м x 2.7м")
- weight: String (cargo/vehicle weight, e.g. "15т" or "22т")
- driver1: String (Full name and passport details of Driver 1 if found)
- driver2: String (Full name and passport details of Driver 2 if found)

Do not include any Markdown wrappers (like \`\`\`json), explanations, or notes. Output ONLY the raw valid JSON.
`;

      const contents: any[] = [promptText];
      if (text) {
        contents.push(`Input Text:\n${text}`);
      }

      if (image) {
        // Extract base64 and mimeType
        const match = image.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/);
        if (match) {
          const mimeType = match[1];
          const data = match[2];
          contents.push({
            inlineData: {
              mimeType,
              data
            }
          });
        } else {
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: image
            }
          });
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
      });

      let jsonStr = response.text || "{}";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = {};
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr.trim());
      }
      res.json(parsed);
    } catch (error: any) {
      handleGeminiError(error, res, "Parse couple data API error");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
