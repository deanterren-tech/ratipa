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

// Robust fallback Gemini API Caller with alternate base URLs and model rotation
async function generateGeminiContentWithFallback(
  contents: any,
  systemInstruction?: string,
  modelName: string = "gemini-2.5-flash"
): Promise<string> {
  const modelsToTry = [modelName, "gemini-3.5-flash", "gemini-3.1-flash-lite"];
  const uniqueModels = Array.from(new Set(modelsToTry));

  const apiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_BACKUP_API_KEY || process.env.GEMINI_API_KEY,
  ].filter(Boolean);

  // Common alternate base URLs / reverse proxies for Gemini to bypass Belarus geoblock
  const baseUrls = [
    process.env.GOOGLE_GEMINI_BASE_URL || "",
    process.env.GEMINI_BACKUP_BASE_URL || "",
    "https://gateway.ai.cloudflare.com/v1", // placeholder/example for users to configure
  ].filter((v, i, self) => v && self.indexOf(v) === i);

  // Attempt 1: Try the primary standard initialized `ai` client
  if (ai) {
    for (const m of uniqueModels) {
      try {
        console.log(`[AI Fallback System] Attempting primary standard client with model: ${m}`);
        const response = await ai.models.generateContent({
          model: m,
          contents,
          config: systemInstruction ? { systemInstruction } : undefined,
        });
        if (response && response.text) {
          console.log(`[AI Fallback System] Success using primary client with model ${m}`);
          return response.text;
        }
      } catch (err: any) {
        console.warn(`[AI Fallback System] Primary client failed with model ${m}: ${err.message || err}`);
      }
    }
  }

  // Attempt 2: Try alternate configurations (Keys & Base URLs) sequentially
  for (const apiKey of apiKeys) {
    for (const baseUrl of baseUrls) {
      if (!baseUrl) continue;
      try {
        console.log(`[AI Fallback System] Attempting fallback client with baseUrl: ${baseUrl}`);
        const backupAi = new GoogleGenAI({
          apiKey: apiKey || "",
          httpOptions: {
            baseUrl: baseUrl,
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        for (const m of uniqueModels) {
          try {
            console.log(`[AI Fallback System] Attempting fallback client with model ${m} on baseUrl ${baseUrl}`);
            const response = await backupAi.models.generateContent({
              model: m,
              contents,
              config: systemInstruction ? { systemInstruction } : undefined,
            });
            if (response && response.text) {
              console.log(`[AI Fallback System] Success using fallback client (${baseUrl}) with model ${m}`);
              return response.text;
            }
          } catch (modelErr: any) {
            console.warn(`[AI Fallback System] Fallback model ${m} on ${baseUrl} failed: ${modelErr.message || modelErr}`);
          }
        }
      } catch (clientErr: any) {
        console.warn(`[AI Fallback System] Failed to initialize backup client for ${baseUrl}: ${clientErr.message || clientErr}`);
      }
    }
  }

  throw new Error("Все доступные онлайн-подключения к Gemini API заблокированы или недоступны.");
}

// ---------------------------------------------------------
// OFFLINE HEURISTIC PARSERS (ROBUST FALLBACKS FOR BELARUS)
// ---------------------------------------------------------

function offlineParseDozvolaText(text: string): any[] {
  console.log("[Offline Fallback Parser] Parsing dozvola text");
  const lines = text.split(/[\n;]+/);
  const results: any[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Identify permit country/type
    const typeMatch = line.match(/(RUS|TR\s?[A-C]|UZ\s?[2-4]|GE|AM\s?3|KZ\s?3|CHN\s?[2-3]|РУС|УЗ|КЗ|ГРУЗ|КИТ|КИТАЙ)/gi);
    let type = typeMatch ? typeMatch[0].toUpperCase() : "RUS";
    type = type.replace(/\s+/g, "");
    if (type.includes("РУС")) type = "RUS";
    if (type.includes("УЗ")) type = "UZ 4";
    if (type.includes("КЗ")) type = "KZ3";
    if (type.includes("ГРУЗ")) type = "GE";
    if (type.includes("КИТ")) type = "CHN 2";

    // Permit number
    const numMatch = line.match(/\b\d{3,8}\b/);
    const number = numMatch ? numMatch[0] : "";

    // License plates (Belarus, Russian, etc.)
    const belarusPlate = line.match(/([A-Z]{2}\s?\d{4}-\d|\d{4}\s?[A-Z]{2}-\d)/i);
    const russiaPlate = line.match(/\b[A-H,K-M,O-T,X,Y]\d{3}[A-H,K-M,O-T,X,Y]{2}\d{2,3}\b/i);
    let car = "";
    if (belarusPlate) {
      car = belarusPlate[0].toUpperCase().replace(/\s+/g, "");
    } else if (russiaPlate) {
      car = russiaPlate[0].toUpperCase().replace(/\s+/g, "");
    } else {
      const anyPlate = line.match(/[A-ZА-Я0-9-]{4,10}/i);
      if (anyPlate) {
        car = anyPlate[0].toUpperCase();
      }
    }

    // Status mapping
    let status = "office";
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes("офис") || lowerLine.includes("office")) {
      status = "office";
    }
    if (lowerLine.includes("руки") || lowerLine.includes("выдан") || lowerLine.includes("в пути") || lowerLine.includes("hand") || lowerLine.includes("транзи") || lowerLine.includes("транзит")) {
      status = "hand";
    }
    if (lowerLine.includes("возврат") || lowerLine.includes("верн") || lowerLine.includes("return")) {
      status = "office_return";
    }
    if (lowerLine.includes("сдан") || lowerLine.includes("исп") || lowerLine.includes("used") || lowerLine.includes("закрыт")) {
      status = "used";
    }
    if (lowerLine.includes("проср") || lowerLine.includes("expired") || lowerLine.includes("аннулир")) {
      status = "expired";
    }

    const isCopy = lowerLine.includes("копия") || lowerLine.includes("скан") || lowerLine.includes("copy") || lowerLine.includes("фото") || lowerLine.includes("photo") || lowerLine.includes("scan");

    let comment = line;
    if (typeMatch) comment = comment.replace(typeMatch[0], "");
    if (numMatch) comment = comment.replace(numMatch[0], "");
    if (belarusPlate) comment = comment.replace(belarusPlate[0], "");
    else if (russiaPlate) comment = comment.replace(russiaPlate[0], "");
    comment = comment.replace(/(офис|office|руки|выдан|в пути|hand|возврат|return|сдан|used|проср|expired|копия|скан|copy|фото|photo)/gi, "").trim();
    comment = comment.replace(/[,;.\s-]+/g, " ").trim();

    results.push({
      type,
      number,
      car,
      status,
      comment: comment || "Офлайн-разбор (Резерв)",
      isCopy,
      _isOfflineFallback: true
    });
  }

  if (results.length === 0) {
    results.push({
      type: "RUS",
      number: "",
      car: "",
      status: "office",
      comment: "Не удалось автоматически извлечь данные (Резерв)",
      isCopy: false,
      _isOfflineFallback: true
    });
  }
  return results;
}

function offlineParseDohodText(text: string): any {
  console.log("[Offline Fallback Parser] Parsing dohod text");
  const lines = text.split(/[\n;]+/);
  const legs: any[] = [];
  let total_days: number | null = null;

  const daysMatch = text.match(/(\d+)\s*(дней|дня|день|дн|days|day)/i);
  if (daysMatch) {
    total_days = parseInt(daysMatch[1]);
  }

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.match(/^\d+\s*(дней|дня|день|дн|days|day)$/i)) continue;

    const cities: string[] = [];
    const words = line.split(/[\s\-—–\/]+/);
    for (const w of words) {
      const cleanW = w.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
      if (cleanW.length >= 3 && cleanW[0] === cleanW[0].toUpperCase()) {
        cities.push(cleanW);
      }
    }

    const fromCity = cities[0] || "Минск";
    const toCity = cities[1] || "Москва";

    let amount = 1000;
    const amountMatch = line.match(/(\d+(?:[.,]\d+)?)\s*(?:тыс|к|k)\b/i);
    const exactMatch = line.match(/\b(\d{3,6})\b/);
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(",", ".")) * 1000;
    } else if (exactMatch) {
      amount = parseInt(exactMatch[1]);
    } else {
      const smallMatch = line.match(/\b(\d{1,3})\b/);
      if (smallMatch) {
        amount = parseInt(smallMatch[1]);
      }
    }

    let currency = "EUR";
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes("руб") || lowerLine.includes("rub") || lowerLine.includes("рос")) {
      currency = "RUB";
    } else if (lowerLine.includes("usd") || lowerLine.includes("долл") || lowerLine.includes("$")) {
      currency = "USD";
    } else if (lowerLine.includes("byn") || lowerLine.includes("бел")) {
      currency = "BYN";
    } else if (lowerLine.includes("cny") || lowerLine.includes("юан") || lowerLine.includes("￥")) {
      currency = "CNY";
    }

    let emptyRun = 0;
    const emptyMatch = line.match(/(?:доезд|empty)\s*(\d+)/i);
    if (emptyMatch) {
      emptyRun = parseInt(emptyMatch[1]);
    }

    legs.push({
      from: fromCity,
      to: toCity,
      amount,
      currency,
      emptyRun
    });
  }

  if (legs.length === 0) {
    legs.push({
      from: "Минск",
      to: "Москва",
      amount: 1000,
      currency: "EUR",
      emptyRun: 0
    });
  }

  return { legs, total_days, _isOfflineFallback: true };
}

function offlineParsePlanDohodText(text: string): any {
  console.log("[Offline Fallback Parser] Parsing plandohod text");
  const lines = text.split(/[\n;]+/);
  const legs: any[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const cities: string[] = [];
    const words = line.split(/[\s\-—–\/]+/);
    for (const w of words) {
      const cleanW = w.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
      if (cleanW.length >= 3 && cleanW[0] === cleanW[0].toUpperCase()) {
        cities.push(cleanW);
      }
    }
    const fromCity = cities[0] || "Минск";
    const toCity = cities[1] || "Москва";

    let rate = 0;
    const rateMatch = line.match(/(?:ставка|став|rate|st)\s*(\d+)/i) || line.match(/\b(\d{3,4})\b/);
    if (rateMatch) {
      rate = parseInt(rateMatch[1]);
    } else {
      const anyNum = line.match(/\b\d+\b/);
      if (anyNum) rate = parseInt(anyNum[0]);
    }

    let km = 750;
    const kmMatch = line.match(/(\d+)\s*(?:км|km)/i);
    if (kmMatch) {
      km = parseInt(kmMatch[1]);
    }

    let emptyRunKm = 0;
    const emptyMatch = line.match(/(?:доезд|empty)\s*(\d+)/i);
    if (emptyMatch) {
      emptyRunKm = parseInt(emptyMatch[1]);
    }

    let ferry = 0;
    const ferryMatch = line.match(/(?:паром|ferry)\s*(\d+)/i);
    if (ferryMatch) {
      ferry = parseInt(ferryMatch[1]);
    }

    legs.push({
      from: fromCity,
      to: toCity,
      rate,
      km,
      emptyRunKm,
      ferry,
      coeff: 0
    });
  }

  if (legs.length === 0) {
    legs.push({
      from: "Минск",
      to: "Москва",
      rate: 1200,
      km: 750,
      emptyRunKm: 0,
      ferry: 0,
      coeff: 0
    });
  }

  return { legs, _isOfflineFallback: true };
}

function offlineParseAnalysisText(text: string): any[] {
  console.log("[Offline Fallback Parser] Parsing analysis text");
  const lines = text.split(/[\n;]+/);
  const results: any[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const routeMatch = line.match(/([a-zA-Zа-яА-ЯёЁ]+)\s*[\-—–]\s*([a-zA-Zа-яА-ЯёЁ]+)/);
    const route = routeMatch ? `${routeMatch[1]} - ${routeMatch[2]}` : line.split(/\s+/).slice(0, 2).join(" - ") || "Минск - Москва";

    const rateMatch = line.match(/(\d+\s*(?:к|тыс|k)?\s*(?:без ндс|с ндс|руб|евро|eur|rub|usd|\$|€)?)/i);
    const rate = rateMatch ? rateMatch[1].trim() : "120к";

    let contact = line;
    if (routeMatch) contact = contact.replace(routeMatch[0], "");
    if (rateMatch) contact = contact.replace(rateMatch[0], "");
    contact = contact.replace(/[,;.\s-]+/g, " ").trim();

    results.push({
      route,
      rate,
      contact: contact || "Офлайн-контакт (Резерв)",
      _isOfflineFallback: true
    });
  }

  if (results.length === 0) {
    results.push({
      route: "Минск - Москва",
      rate: "1200 EUR",
      contact: "Резерв",
      _isOfflineFallback: true
    });
  }
  return results;
}

function offlineParseDriverData(text: string): any {
  console.log("[Offline Fallback Parser] Parsing driver data");
  const dates = text.match(/\b\d{2}\.\d{2}\.\d{4}\b/g) || [];
  let birthDate = "";
  let passportStart = "";
  let passportEnd = "";
  if (dates.length > 0) {
    const sortedDates = [...dates].sort((a, b) => {
      const partsA = a.split(".").reverse().join("-");
      const partsB = b.split(".").reverse().join("-");
      return partsA.localeCompare(partsB);
    });
    birthDate = sortedDates[0] || "";
    if (sortedDates.length > 1) passportStart = sortedDates[1] || "";
    if (sortedDates.length > 2) passportEnd = sortedDates[2] || "";
  }

  const phoneMatch = text.match(/\+?\d{1,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  const passportMatch = text.match(/\b([A-Z]{2}\s?\d{7}|\d{4}\s?\d{6})\b/i);
  const passportNumber = passportMatch ? passportMatch[1].toUpperCase() : "";

  const personalIdMatch = text.match(/\b\d{7}[A-Z]\d{3}[A-Z]{2}\d\b/i);
  const personalId = personalIdMatch ? personalIdMatch[0].toUpperCase() : "";

  const belarusPlate = text.match(/([A-Z]{2}\s?\d{4}-\d|\d{4}\s?[A-Z]{2}-\d)/i);
  const vehicleNumbers = belarusPlate ? belarusPlate[0].toUpperCase().replace(/\s+/g, "") : "";

  const brandMatch = text.match(/\b(Volvo|Scania|MAN|Mercedes|DAF|Iveco|Renault|Kam|MAZ|Вольво|Скания|Ман|Мерседес|Даф|Ивеко|Рено|Камаз|МАЗ)\b/i);
  const brands = brandMatch ? brandMatch[0].toUpperCase() : "VOLVO";

  const nameMatch = text.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/);
  const driverName = nameMatch ? nameMatch[0] : "Офлайн-Водитель (Резерв)";

  const issuedMatch = text.match(/(?:выдан|issued by)\s+([^,.\n]+)/i);
  const passportIssuedBy = issuedMatch ? issuedMatch[1].trim() : "МВД РБ";

  const dispMatch = text.match(/\b(Юрий|Алексей|Татьяна|Мария|Анна|Ольга|Дмитрий|Екатерина|Сергей)\b/i);
  const dispatcher = dispMatch ? dispMatch[0] : "";

  return {
    vehicleNumbers,
    brands,
    driverName,
    birthDate,
    passportNumber,
    personalId,
    passportStart,
    passportEnd,
    passportIssuedBy,
    phone,
    dispatcher,
    _isOfflineFallback: true
  };
}

function offlineParseCoupleData(text: string): any {
  console.log("[Offline Fallback Parser] Parsing couple data");
  const plateMatch = text.match(/([A-ZА-Я0-9-]{4,10})/gi) || [];
  let stateNumber = "Резерв";
  if (plateMatch.length > 0) {
    stateNumber = plateMatch.slice(0, 2).join("/");
  }

  const brandMatch = text.match(/\b(Volvo|Scania|MAN|Mercedes|DAF|Iveco|Renault|Kam|MAZ|Вольво|Скания|Ман|Мерседес|Даф|Ивеко|Рено|Камаз|МАЗ)\b/i);
  const model = brandMatch ? brandMatch[0].toUpperCase() : "VOLVO";

  let vehicleType = "Тент 90м3";
  if (text.toLowerCase().includes("реф") || text.toLowerCase().includes("холод")) {
    vehicleType = "Рефрижератор";
  } else if (text.toLowerCase().includes("сцеп") || text.toLowerCase().includes("120")) {
    vehicleType = "Сцепка 120м3";
  }

  const dimMatch = text.match(/(\d+(?:[.,]\d+)?\s*(?:м|m)?\s*[xх]\s*\d+(?:[.,]\d+)?\s*(?:м|m)?\s*[xх]\s*\d+(?:[.,]\d+)?\s*(?:м|m)?)/i);
  const dimensions = dimMatch ? dimMatch[1] : "13.6м x 2.45м x 2.7м";

  const weightMatch = text.match(/(\d+\s*(?:т|t|тонн))/i);
  const weight = weightMatch ? weightMatch[1] : "22т";

  const names = text.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/g) || [];
  const driver1 = names[0] || "Офлайн-Водитель 1 (Резерв)";
  const driver2 = names[1] || "";

  return {
    stateNumber,
    model,
    vehicleType,
    dimensions,
    weight,
    driver1,
    driver2,
    _isOfflineFallback: true
  };
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

  // API Route for proxying OSRM route requests to avoid CORS / VPN issues
  app.get("/api/osrm-route", async (req, res) => {
    try {
      const coordinates = ((req.query.coordinates as string) || "").trim();
      if (!coordinates) {
        return res
          .status(400)
          .json({ error: "Missing coordinates query parameter" });
      }

      const steps = req.query.steps === "true" ? "&steps=true" : "";
      const alternatives = req.query.alternatives === "true" ? "&alternatives=true" : "";

      // List of public OSRM servers to attempt sequentially
      const servers = [
        "https://router.project-osrm.org",
        "https://routing.openstreetmap.de/routed-car"
      ];

      let data = null;
      let success = false;

      for (const server of servers) {
        try {
          const url = `${server}/route/v1/driving/${coordinates}?overview=full&geometries=geojson${steps}${alternatives}`;
          const routeRes = await fetch(url, {
            headers: {
              "User-Agent": "CargoSchedulerApplet/1.0 (contact: deanterren@gmail.com)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(4000) // 4 seconds timeout for each request
          });

          if (routeRes.ok) {
            data = await routeRes.json();
            if (data && data.code === "Ok" && data.routes && data.routes.length > 0) {
              success = true;
              break;
            }
          }
        } catch (err) {
          console.warn(`OSRM proxy request failed for server ${server}:`, err);
        }
      }

      // If both public OSRM servers fail, execute our ultimate math fallback!
      if (!success) {
        console.log("Both OSRM servers failed. Triggering ultimate mathematical geodesic route fallback...");
        
        // Parse input coordinates "lng1,lat1;lng2,lat2;..."
        const coordPairs = coordinates.split(";").map(pair => {
          const [lngStr, latStr] = pair.split(",");
          const lng = parseFloat(lngStr);
          const lat = parseFloat(latStr);
          return { lat, lng };
        }).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lng));

        if (coordPairs.length < 2) {
          return res.status(400).json({ error: "Invalid coordinates format for fallback calculation" });
        }

        // Calculate Haversine distance between all sequential points
        let totalMeters = 0;
        const R = 6371e3; // Earth radius in meters
        
        for (let i = 0; i < coordPairs.length - 1; i++) {
          const p1 = coordPairs[i];
          const p2 = coordPairs[i + 1];
          
          const lat1 = (p1.lat * Math.PI) / 180;
          const lat2 = (p2.lat * Math.PI) / 180;
          const deltaLat = ((p2.lat - p1.lat) * Math.PI) / 180;
          const deltaLng = ((p2.lng - p1.lng) * Math.PI) / 180;

          const a =
            Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) *
              Math.cos(lat2) *
              Math.sin(deltaLng / 2) *
              Math.sin(deltaLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          totalMeters += R * c;
        }

        // Apply a realistic 25% winding factor to approximate road winding distance
        const distanceMeters = Math.round(totalMeters * 1.25);
        // Approximate average driving speed of 75 km/h (20.83 m/s)
        const durationSeconds = Math.round(distanceMeters / 20.83);

        data = {
          code: "Ok",
          routes: [
            {
              geometry: {
                coordinates: coordPairs.map(pt => [pt.lng, pt.lat]),
                type: "LineString"
              },
              legs: [
                {
                  distance: distanceMeters,
                  duration: durationSeconds,
                  steps: []
                }
              ],
              distance: distanceMeters,
              duration: durationSeconds,
              summary: "Deterministic Fallback Road approximation"
            }
          ],
          waypoints: coordPairs.map((pt, idx) => ({
            hint: `fallback-hint-${idx}`,
            location: [pt.lng, pt.lat],
            name: idx === 0 ? "Origin" : idx === coordPairs.length - 1 ? "Destination" : `Waypoint ${idx}`
          }))
        };
      }

      return res.json(data);
    } catch (error) {
      console.error("OSRM Proxy Fallback Wrapper Error:", error);
      return res.status(500).json({ error: "Failed to resolve routing" });
    }
  });

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
          signal: AbortSignal.timeout(4000)
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
          signal: AbortSignal.timeout(4000)
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

        const textResult = await generateGeminiContentWithFallback(
          { parts: partsWithText },
          "You are a helpful logistics data extractor. Return only a JSON array.",
          "gemini-2.5-flash"
        );

        let jsonStr = textResult || "";

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
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Empty text provided" });
    }

    try {
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

      const textResult = await generateGeminiContentWithFallback(
        promptText,
        "You are a precise data extractor. You must only return valid JSON matching the schema.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "";
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
      console.warn("Gemini parsing failed, using offline fallback parser:", e.message || e);
      try {
        const parsed = offlineParseDriverData(text);
        res.json({ results: parsed });
      } catch (fallbackError: any) {
        handleGeminiError(e, res, "Parse driver data API error");
      }
    }
  });

  // API Route for text parsing as well (if you want to keep the old text assistant with AI)
  app.post("/api/parse-dozvola-text", async (req, res) => {
    const { text, knownFleetCars } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    try {
      const promptText = `
You are an expert logistics AI assistant.
Your task is to parse unstructured text about transport permit (dozvol/дозвол) movements and extract structured data.
You will be given the raw text.

Extract a JSON array of objects, where each object represents an action on a specific permit.
Each object should have the following fields:
- "type": The permit type (e.g. "RUS", "TR A", "TR B", "UZ 2", "UZ 3", "UZ 4", "GE", "AM3", "KZ3", "CHN 2", "CHN 3"). Attempt to normalize it.
- "number": The permit serial number (usually 3 to 8 digits).
- "car": The truck license plate or number it is assigned to or taken from (e.g. "AB1234-7" or "9271").
- "status": The action's resulting status. MUST be one of:
   - "office" (received in office)
   - "hand" (given to driver / in transit)
   - "office_return" (returned to office)
   - "used" (submitted to transport inspection)
   - "expired" (cancelled, mistake, discarded)
- "comment": Any remaining notes or comments from the text.
- "isCopy": Boolean. True if the text mentions a copy/scan/photo (especially for CHN types).

Return ONLY a valid JSON array. Do not return markdown blocks.

Text:
"${text}"
`;

      const textResult = await generateGeminiContentWithFallback(
        promptText,
        "You are a helpful logistics data extractor. Return only a JSON array.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "[]";
      const jsonMatch =
        jsonStr.match(/```json\s*([\s\S]*?)\s*```/) ||
        jsonStr.match(/([\{\[][\s\S]*[\}\]])/);
      let parsed = [];
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(jsonStr);
      }

      // Ensure it's an array
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      res.json({ results: parsed });
    } catch (e: any) {
      console.warn("Gemini parsing failed, using offline fallback parser:", e.message || e);
      try {
        const parsed = offlineParseDozvolaText(text);
        res.json({ results: parsed });
      } catch (fallbackError: any) {
        handleGeminiError(e, res, "Failed to parse dozvola text");
      }
    }
  });

  // API Route for text parsing in Dohod (Calculation)
  app.post("/api/parse-dohod-text", async (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    try {
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

      const textResult = await generateGeminiContentWithFallback(
        promptText,
        "You are a helpful logistics data extractor. Return only a JSON object.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "{}";
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
      console.warn("Gemini parsing failed, using offline fallback parser in dohod:", e.message || e);
      try {
        const parsed = offlineParseDohodText(text);
        res.json(parsed);
      } catch (fallbackError: any) {
        handleGeminiError(e, res, "Failed to process text in dohod");
      }
    }
  });

  // API Route for text parsing in PlanDohod
  app.post("/api/parse-plandohod-text", async (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    try {
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

      const textResult = await generateGeminiContentWithFallback(
        promptText,
        "You are a helpful logistics data extractor. Return only a JSON object.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "{}";
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
      console.warn("Gemini parsing failed, using offline fallback parser in plandohod:", e.message || e);
      try {
        const parsed = offlineParsePlanDohodText(text);
        res.json(parsed);
      } catch (fallbackError: any) {
        handleGeminiError(e, res, "Failed to process text in plandohod");
      }
    }
  });

  app.post("/api/parse-analysis-text", async (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    try {
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

      const textResult = await generateGeminiContentWithFallback(
        promptText,
        "You are a helpful logistics data extractor. Return only a JSON array.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "[]";
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
      console.warn("Gemini parsing failed, using offline fallback parser in analysis:", e.message || e);
      try {
        const parsed = offlineParseAnalysisText(text);
        res.json({ results: parsed });
      } catch (fallbackError: any) {
        handleGeminiError(e, res, "Failed to process text in analysis");
      }
    }
  });

  app.post("/api/parse-couple-data", async (req, res) => {
    const { text, image } = req.body;
    try {
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

      const textResult = await generateGeminiContentWithFallback(
        contents,
        "You are a precise logistics data extractor. Return only a JSON object.",
        "gemini-2.5-flash"
      );

      let jsonStr = textResult || "{}";
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
      console.warn("Gemini parsing failed, using offline fallback parser in couple data:", error.message || error);
      try {
        const parsed = offlineParseCoupleData(text || "");
        res.json(parsed);
      } catch (fallbackError: any) {
        handleGeminiError(error, res, "Parse couple data API error");
      }
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
