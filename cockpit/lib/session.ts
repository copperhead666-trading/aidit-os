import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "__founderos_cockpit_session";
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;
export const ALLOWED_TELEGRAM_USER_IDS_ENV = "COCKPIT_ALLOWED_TELEGRAM_USER_IDS";
// Source of truth: ops-watcher/telegram-client.mjs exports OWNER_CHAT_ID = "8987077084".
// If the owner id changes, update both files together.
const DEFAULT_OWNER_TELEGRAM_USER_ID = 8987077084;

interface SessionPayload {
  uid: number;
  iat: number;
}

export interface SessionResult {
  ok: boolean;
  reason: string;
  userId: number | null;
  issuedAtMs: number | null;
}

export interface AllowedTelegramIdsResult {
  ok: boolean;
  reason: string;
  ids: number[];
}

function fail(reason: string, userId: number | null = null, issuedAtMs: number | null = null): SessionResult {
  return { ok: false, reason, userId, issuedAtMs };
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function base64UrlDecode(value: string): Buffer | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function sign(value: string, botToken: string): string {
  return createHmac("sha256", botToken).update(value).digest("base64url");
}

function safeEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);

  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, receivedBytes);
}

function parsePayload(value: Buffer): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(value.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const uid = record.uid;
    const iat = record.iat;

    if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid <= 0) return null;
    if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat <= 0) return null;

    return { uid, iat };
  } catch {
    return null;
  }
}

export function parseAllowedTelegramUserIds(raw: string | undefined): AllowedTelegramIdsResult {
  try {
    if (typeof raw === "undefined") {
      return { ok: true, reason: "ok", ids: [DEFAULT_OWNER_TELEGRAM_USER_ID] };
    }

    if (typeof raw !== "string" || raw.trim() === "") {
      return { ok: false, reason: `${ALLOWED_TELEGRAM_USER_IDS_ENV} allowlist is not configured`, ids: [] };
    }

    const parts = raw.split(",").map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => part === "")) {
      return { ok: false, reason: `${ALLOWED_TELEGRAM_USER_IDS_ENV} allowlist is malformed`, ids: [] };
    }

    const ids = parts.map((part) => Number(part));
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return { ok: false, reason: `${ALLOWED_TELEGRAM_USER_IDS_ENV} allowlist is malformed`, ids: [] };
    }

    return { ok: true, reason: "ok", ids: Array.from(new Set(ids)) };
  } catch {
    return { ok: false, reason: `${ALLOWED_TELEGRAM_USER_IDS_ENV} allowlist could not be parsed`, ids: [] };
  }
}

export function mintSessionCookieValue(
  userId: number,
  botToken: string,
  opts: { now?: number } = {},
): SessionResult & { value: string | null } {
  try {
    if (typeof botToken !== "string" || botToken.trim() === "") {
      return { ...fail("Telegram bot token is not configured"), value: null };
    }
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return { ...fail("Telegram user id is malformed"), value: null };
    }

    const now = opts.now ?? Date.now();
    if (!Number.isFinite(now) || !Number.isSafeInteger(now)) {
      return { ...fail("session issued-at is malformed"), value: null };
    }

    const payload = base64UrlEncode(Buffer.from(JSON.stringify({ uid: userId, iat: now }), "utf8"));
    const signedValue = `v1.${payload}`;
    const signature = sign(signedValue, botToken);

    return {
      ok: true,
      reason: "ok",
      userId,
      issuedAtMs: now,
      value: `${signedValue}.${signature}`,
    };
  } catch {
    return { ...fail("session cookie could not be minted"), value: null };
  }
}

export function verifySessionCookieValue(
  cookieValue: string | undefined,
  botToken: string | undefined,
  opts: { now?: number; allowedIds?: number[] } = {},
): SessionResult {
  try {
    if (typeof botToken !== "string" || botToken.trim() === "") {
      return fail("Telegram bot token is not configured");
    }
    if (typeof cookieValue !== "string" || cookieValue.trim() === "") {
      return fail("session cookie is missing");
    }

    const parts = cookieValue.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") {
      return fail("session cookie is malformed");
    }

    const [, payloadBase64, receivedSignature] = parts;
    const payloadBytes = base64UrlDecode(payloadBase64);
    if (payloadBytes === null) {
      return fail("session cookie payload is malformed");
    }

    const payload = parsePayload(payloadBytes);
    if (payload === null) {
      return fail("session cookie payload is malformed");
    }

    const expectedSignature = sign(`v1.${payloadBase64}`, botToken);
    if (!safeEqual(expectedSignature, receivedSignature)) {
      return fail("session cookie signature is invalid", payload.uid, payload.iat);
    }

    const now = opts.now ?? Date.now();
    if (!Number.isFinite(now)) {
      return fail("session clock is malformed", payload.uid, payload.iat);
    }
    if (payload.iat > now + 5 * 60 * 1000) {
      return fail("session cookie was issued in the future", payload.uid, payload.iat);
    }
    if (now - payload.iat > SESSION_MAX_AGE_MS) {
      return fail("session cookie is expired", payload.uid, payload.iat);
    }
    if (opts.allowedIds && !opts.allowedIds.includes(payload.uid)) {
      return fail("Telegram user is not in the allowlist", payload.uid, payload.iat);
    }

    return { ok: true, reason: "ok", userId: payload.uid, issuedAtMs: payload.iat };
  } catch {
    return fail("session cookie verification failed");
  }
}
