import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramMiniAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramMiniAppAuth = {
  user: TelegramMiniAppUser;
  authDate: number;
  queryId?: string;
};

export type TelegramAuthResult =
  | { ok: true; auth: TelegramMiniAppAuth }
  | { ok: false; code: "auth_required" | "auth_invalid" | "auth_expired"; error: string };

function safeHexEqual(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string | undefined,
  options: { nowSeconds?: number; maxAgeSeconds?: number } = {},
): TelegramAuthResult {
  if (!initData?.trim() || !botToken?.trim()) {
    return {
      ok: false,
      code: "auth_required",
      error: "Open SlipCut from @slipcut_bot to authenticate this request.",
    };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  if (!safeHexEqual(hash, expected)) {
    return { ok: false, code: "auth_invalid", error: "Telegram authentication could not be verified." };
  }

  const authDate = Number(params.get("auth_date"));
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 86_400;
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > maxAge) {
    return {
      ok: false,
      code: "auth_expired",
      error: "This Telegram Mini App session has expired. Close and reopen SlipCut.",
    };
  }

  let user: TelegramMiniAppUser;
  try {
    user = JSON.parse(params.get("user") ?? "null") as TelegramMiniAppUser;
  } catch {
    return { ok: false, code: "auth_invalid", error: "Telegram user data is malformed." };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    return { ok: false, code: "auth_invalid", error: "Telegram user data is missing." };
  }
  return {
    ok: true,
    auth: { user, authDate, queryId: params.get("query_id") ?? undefined },
  };
}

export function initDataFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (/^tma\s+/i.test(authorization)) return authorization.replace(/^tma\s+/i, "").trim();
  return request.headers.get("x-telegram-init-data")?.trim() ?? "";
}

export function authenticateMiniAppRequest(request: Request): TelegramAuthResult {
  return verifyTelegramInitData(
    initDataFromRequest(request),
    process.env.TELEGRAM_BOT_TOKEN,
  );
}
