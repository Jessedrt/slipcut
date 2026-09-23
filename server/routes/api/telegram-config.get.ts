import { defineHandler } from "nitro";

const DEFAULT_PUBLIC_BASE = "https://slipcut-jesse-5780.vercel.app";

type TelegramResult<T> = {
  ok?: boolean;
  result?: T;
};

async function telegramGet<T>(token: string, method: string): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json()) as TelegramResult<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(`Telegram rejected ${method}`);
  }
  return payload.result;
}

export default defineHandler(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return Response.json(
      { ok: false, code: "configuration_error", error: "Telegram is not configured." },
      { status: 503 },
    );
  }

  const publicBase = (process.env.SLIPCUT_PUBLIC_URL || DEFAULT_PUBLIC_BASE).replace(/\/$/, "");
  const expectedWebhookUrl = `${publicBase}/api/telegram`;
  const expectedMiniAppPrefix = `${publicBase}/app`;

  try {
    const [webhook, menu] = await Promise.all([
      telegramGet<{ url?: unknown }>(token, "getWebhookInfo"),
      telegramGet<{ type?: unknown; web_app?: { url?: unknown } }>(token, "getChatMenuButton"),
    ]);
    const webhookUrl = typeof webhook.url === "string" ? webhook.url : "";
    const miniAppUrl =
      menu.type === "web_app" && typeof menu.web_app?.url === "string" ? menu.web_app.url : "";

    return Response.json({
      ok: true,
      webhook: {
        configured: Boolean(webhookUrl),
        matches: webhookUrl === expectedWebhookUrl,
        url: webhookUrl,
        expectedUrl: expectedWebhookUrl,
      },
      miniApp: {
        configured: Boolean(miniAppUrl),
        matches:
          miniAppUrl === expectedMiniAppPrefix || miniAppUrl.startsWith(`${expectedMiniAppPrefix}?`),
        url: miniAppUrl,
        expectedPrefix: expectedMiniAppPrefix,
      },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        code: "provider_unavailable",
        error: "Telegram configuration could not be checked right now.",
      },
      { status: 503 },
    );
  }
});
