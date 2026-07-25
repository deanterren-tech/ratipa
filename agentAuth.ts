// Middleware авторизации Agent API (delegated-режим).
// Бот передаёт Firebase ID-токен реального пользователя в заголовке
//   Authorization: Bearer <idToken>
// Сервер верифицирует токен (admin.auth) и резолвит профиль из users_list/{uid}.
// user/role/permissions НЕ берутся из тела запроса — только из верифицированного токена.

import type { Request, Response, NextFunction } from "express";
import { adminAuth, adminDb } from "./firebaseAdmin.ts";
import type { AgentUser } from "./permissions.ts";

export interface AgentRequest extends Request {
  agentUser?: AgentUser;
}

export async function agentAuthMiddleware(
  req: AgentRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!adminAuth || !adminDb) {
    res.status(503).json({
      error:
        "Agent API недоступен: Firebase Admin SDK не инициализирован. " +
        "Задайте FIREBASE_SERVICE_ACCOUNT в .env сервера.",
    });
    return;
  }

  const header = req.headers["authorization"] || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Требуется Authorization: Bearer <idToken>" });
    return;
  }
  const idToken = match[1].trim();

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const snap = await adminDb.ref(`users_list/${uid}`).once("value");
    const profile = snap.val();
    if (!profile) {
      res.status(403).json({ error: "Профиль пользователя не найден" });
      return;
    }
    if (profile.role === "none") {
      res.status(403).json({ error: "Нет доступа (role=none)" });
      return;
    }

    req.agentUser = {
      uid,
      name: profile.name || decoded.name || uid,
      email: profile.email || decoded.email || undefined,
      role: profile.role,
      permissions: profile.permissions,
    };
    next();
  } catch (e: any) {
    console.warn("[agentAuth] Ошибка верификации токена:", e?.message || e);
    res.status(401).json({ error: "Невалидный ID-токен: " + (e?.message || "") });
    return;
  }
}
