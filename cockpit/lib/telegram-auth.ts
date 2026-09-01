import { createHmac, timingSafeEqual } from "node:crypto";

export interface InitDataUser {
  id: number;
  username?: string;
  firstName?: string;
}

export interface InitDataResult {
  ok: boolean;
  reason: string;
  user: InitDataUser | null;
  authDateMs: number | null;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HASH_HEX_RE = /^[0-9a-f]{64}$/i;

function fail(reason: string, authDateMs: number | null = null): InitDataResult {
  return { ok: false, reason, user: null, authDateMs };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function safeHexEqual(expectedHex: string, receivedHex: string): boolean {
  if (!HASH_HEX_RE.test(receivedHex)) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

function parseAuthDateMs(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (!/^\d+$/.test(value)) return null;

  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return null;

  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseUser(value: string | null): InitDataUser | null {
  if (value === null || value.trim() === "") return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;

    const user: InitDataUser = { id };
    const username = getOptionalString(record.username);
    const firstName = getOptionalString(record.first_name);

    if (username !== undefined) user.username = username;
    if (firstName !== undefined) user.firstName = firstName;

    return user;
  } catch {
    return null;
  }
}

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeMs?: number; now?: number } = {},
): InitDataResult {
  try {
    if (typeof botToken !== "string" || botToken.trim() === "") {
      return fail("server misconfigured: Telegram bot token is not set");
    }

    if (typeof initData !== "string" || initData.trim() === "") {
      return fail("initData is empty");
    }

    const raw = initData.startsWith("?") ? initData.slice(1) : initData;
    const params = new URLSearchParams(raw);
    const receivedHash = params.get("hash");

    if (receivedHash === null || receivedHash === "") {
      return fail("initData is missing hash");
    }
    if (!HASH_HEX_RE.test(receivedHash)) {
      return fail("initData hash is malformed");
    }

    const fields = Array.from(params.entries()).filter(([key]) => key !== "hash");
    if (fields.length === 0) {
      return fail("initData has no signed fields");
    }

    fields.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = compareStrings(leftKey, rightKey);
      return keyOrder === 0 ? compareStrings(leftValue, rightValue) : keyOrder;
    });

    const dataCheckString = fields.map(([key, value]) => `${key}=${value}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (!safeHexEqual(expectedHash, receivedHash)) {
      return fail("initData signature is invalid");
    }

    const authDateMs = parseAuthDateMs(params.get("auth_date"));
    if (authDateMs === null) {
      return fail("auth_date is missing or malformed");
    }

    const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const now = opts.now ?? Date.now();
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      return fail("maxAgeMs is malformed", authDateMs);
    }
    if (!Number.isFinite(now)) {
      return fail("now is malformed", authDateMs);
    }
    if (now - authDateMs > maxAgeMs) {
      return fail("initData is stale: auth_date is older than maxAgeMs", authDateMs);
    }

    const user = parseUser(params.get("user"));
    if (user === null) {
      return fail("user is missing or malformed", authDateMs);
    }

    return { ok: true, reason: "ok", user, authDateMs };
  } catch {
    return fail("initData verification failed without throwing");
  }
}

export function isOwner(user: InitDataUser | null, allowedIds: number[]): boolean {
  if (user === null || allowedIds.length === 0) return false;
  return allowedIds.includes(user.id);
}
