import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { db, now } from "./db.js";

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TgUser;
    }
  }
}

const webAppSecret = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
const tokenSecret = crypto.createHash("sha256").update("telestorage-media:" + config.botToken).digest();

/** Проверка подписи initData по https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function validateInitData(initData: string): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const expected = crypto.createHmac("sha256", webAppSecret).update(dataCheckString).digest("hex");
  if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) {
    return null;
  }
  const authDate = Number(params.get("auth_date") || 0);
  if (now() - authDate > config.initDataTtlSec) return null;
  try {
    const user = JSON.parse(params.get("user") || "null") as TgUser | null;
    return user && typeof user.id === "number" ? user : null;
  } catch {
    return null;
  }
}

export function isAllowed(userId: number) {
  return config.allowedUserIds.length === 0 || config.allowedUserIds.includes(userId);
}

export function upsertUser(user: TgUser) {
  db.prepare(
    `INSERT INTO users (id, first_name, username, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`,
  ).run(user.id, user.first_name ?? null, user.username ?? null, now());
}

const seen = new Set<number>();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  const user = initData ? validateInitData(initData) : null;
  if (!user) return res.status(401).json({ error: "Откройте приложение из Telegram" });
  if (!isAllowed(user.id)) return res.status(403).json({ error: "Доступ запрещён" });
  if (!seen.has(user.id)) {
    upsertUser(user);
    seen.add(user.id);
  }
  req.user = user;
  next();
}

/**
 * Короткоживущий подписанный токен для <img>/<video>, которым нельзя передать заголовок Authorization.
 */
export function signMediaToken(fileId: number, userId: number, ttlSec = 6 * 3600) {
  const exp = now() + ttlSec;
  const payload = `${fileId}.${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyMediaToken(token: string, fileId: number): number | null {
  const [fid, uid, exp, sig] = token.split(".");
  if (!sig || Number(fid) !== fileId || Number(exp) < now()) return null;
  const expected = crypto.createHmac("sha256", tokenSecret).update(`${fid}.${uid}.${exp}`).digest("base64url").slice(0, 32);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  return Number(uid);
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("base64url");
}
