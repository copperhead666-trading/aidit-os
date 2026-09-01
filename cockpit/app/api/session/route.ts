import { NextResponse } from "next/server";
import { isOwner, verifyInitData } from "@/lib/telegram-auth";
import {
  ALLOWED_TELEGRAM_USER_IDS_ENV,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_SECONDS,
  mintSessionCookieValue,
  parseAllowedTelegramUserIds,
} from "@/lib/session";

const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN_AHMAD";

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ ok: false, reason }, { status: 401 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const botToken = process.env[TELEGRAM_BOT_TOKEN_ENV];
  if (typeof botToken !== "string" || botToken.trim() === "") {
    return unauthorized(`${TELEGRAM_BOT_TOKEN_ENV} is not configured`);
  }

  const allowedIds = parseAllowedTelegramUserIds(process.env[ALLOWED_TELEGRAM_USER_IDS_ENV]);
  if (!allowedIds.ok) {
    return unauthorized(allowedIds.reason);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return unauthorized("request body is malformed");
  }

  const initData =
    typeof body === "object" && body !== null && typeof (body as { initData?: unknown }).initData === "string"
      ? (body as { initData: string }).initData
      : "";

  const verified = verifyInitData(initData, botToken, { maxAgeMs: SESSION_MAX_AGE_MS });
  if (!verified.ok) {
    return unauthorized(verified.reason);
  }
  const user = verified.user;
  if (user === null || !isOwner(user, allowedIds.ids)) {
    return unauthorized("Telegram user is not in the allowlist");
  }

  const session = mintSessionCookieValue(user.id, botToken);
  if (!session.ok || session.value === null) {
    return unauthorized(session.reason);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
