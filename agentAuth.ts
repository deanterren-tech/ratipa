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

  // 1) Try Authorization: Bearer <Firebase ID token> (user-delegated)
  const header = req.headers["authorization"] || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
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
      return;
    } catch (e: any) {
      console.warn("[agentAuth] Ошибка верификации токена:", e?.message || e);
      res.status(401).json({ error: "Невалидный ID-токен: " + (e?.message || "") });
      return;
    }
  }

  // 2) Fallback: x-agent-key (agent session token from AdminAgentBlock)
  const agentKey = req.headers["x-agent-key"] as string | undefined;
  if (agentKey) {
    try {
      const snap = await adminDb
        .ref("agent_access_center/sessions")
        .orderByChild("fullToken")
        .equalTo(agentKey)
        .once("value");
      const val = snap.val();
      if (!val) {
        res.status(401).json({ error: "Невалидный agent-key: сессия не найдена" });
        return;
      }
      // Find the matching session entry
      const entry = Object.values(val as Record<string, any>).find(
        (s: any) => s.fullToken === agentKey && s.status === "active",
      );
      if (!entry) {
        res.status(401).json({ error: "Сессия неактивна или отозвана" });
        return;
      }
      // Check expiry
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        res.status(401).json({ error: "Срок действия сессии истёк" });
        return;
      }
      req.agentUser = {
        uid: entry.issuedBy || "agent",
        name: entry.issuedBy || "Agent",
        role: "agent",
        permissions: entry.permissions || {},
      };
      next();
      return;
    } catch (e: any) {
      console.warn("[agentAuth] Ошибка проверки agent-key:", e?.message || e);
      res.status(500).json({ error: "Ошибка проверки agent-key: " + (e?.message || "") });
      return;
    }
  }

  res.status(401).json({ error: "Требуется Authorization: Bearer <token> или x-agent-key" });
}
