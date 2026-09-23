import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Telegram only accepts ASCII letters, digits, underscores and hyphens in
 * webhook secret_token. Derive one from the existing bot token so production
 * needs no additional secret to be manually synchronized with its webhook.
 * An explicit override is supported for secret rotation.
 * @param {string | undefined} botToken
 * @param {string | undefined} override
 * @returns {string | null}
 */
export function telegramWebhookSecret(botToken, override) {
  if (!botToken?.trim()) return null;
  if (override !== undefined && override !== "") {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(override)) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET must be 1–256 URL-safe characters");
    }
    return override;
  }
  return createHash("sha256")
    .update("slipcut-telegram-webhook-v1:")
    .update(botToken)
    .digest("hex");
}

/** @param {string | null | undefined} received @param {string | null} expected */
export function verifyTelegramWebhookSecret(received, expected) {
  if (!received || !expected) return false;
  const actual = Buffer.from(received, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * Production deployments may mutate Telegram's webhook. Some Vercel projects
 * build main as a preview and promote that immutable deployment afterwards, so
 * use the protected main branch as a Vercel-only fallback.
 * @param {string | undefined} environment
 * @param {string | undefined} gitRef
 * @param {string | undefined} isVercel
 */
export function shouldSetTelegramWebhook(environment, gitRef, isVercel) {
  return environment === "production" || (isVercel === "1" && gitRef === "main");
}
