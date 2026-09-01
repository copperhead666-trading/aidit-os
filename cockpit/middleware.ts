import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "__founderos_cockpit_session";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN_AHMAD";
const ALLOWED_TELEGRAM_USER_IDS_ENV = "COCKPIT_ALLOWED_TELEGRAM_USER_IDS";

interface SessionPayload {
  uid: number;
  iat: number;
}

function isPublicPath(pathname: string): boolean {
  return pathname === "/enter" || pathname === "/api/session" || pathname.startsWith("/_next/");
}

function redirectToEnter(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/enter", request.url));
}

function parseAllowedIds(raw: string | undefined): number[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === "")) return null;

  const ids = parts.map((part) => Number(part));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;

  return Array.from(new Set(ids));
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function parsePayload(payloadBase64: string): SessionPayload | null {
  try {
    const payloadBytes = base64UrlToBytes(payloadBase64);
    if (payloadBytes === null) return null;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function verifySignature(signedValue: string, receivedSignature: string, botToken: string): Promise<boolean> {
  try {
    const signatureBytes = base64UrlToBytes(receivedSignature);
    if (signatureBytes === null) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(botToken),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    return crypto.subtle.verify("HMAC", key, toArrayBuffer(signatureBytes), encoder.encode(signedValue));
  } catch {
    return false;
  }
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const botToken = process.env[TELEGRAM_BOT_TOKEN_ENV];
  if (typeof botToken !== "string" || botToken.trim() === "") return false;

  const allowedIds = parseAllowedIds(process.env[ALLOWED_TELEGRAM_USER_IDS_ENV]);
  if (allowedIds === null || allowedIds.length === 0) return false;

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (typeof cookieValue !== "string" || cookieValue.trim() === "") return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const [, payloadBase64, receivedSignature] = parts;
  const payload = parsePayload(payloadBase64);
  if (payload === null) return false;

  const signatureOk = await verifySignature(`v1.${payloadBase64}`, receivedSignature, botToken);
  if (!signatureOk) return false;

  const now = Date.now();
  if (payload.iat > now + 5 * 60 * 1000) return false;
  if (now - payload.iat > SESSION_MAX_AGE_MS) return false;

  return allowedIds.includes(payload.uid);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (await hasValidSession(request)) {
    return NextResponse.next();
  }

  return redirectToEnter(request);
}

export const config = {
  matcher: ["/:path*"],
};
