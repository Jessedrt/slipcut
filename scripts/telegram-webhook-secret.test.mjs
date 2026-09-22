import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldSetTelegramWebhook,
  telegramWebhookSecret,
  verifyTelegramWebhookSecret,
} from "./telegram-webhook-secret.mjs";

test("derives stable Telegram-compatible secret from the bot token", () => {
  const first = telegramWebhookSecret("12345:example");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, telegramWebhookSecret("12345:example"));
  assert.notEqual(first, telegramWebhookSecret("54321:example"));
  assert.ok(!first.includes(":example"));
});

test("explicit webhook secret overrides derived value", () => {
  assert.equal(telegramWebhookSecret("12345:example", "custom_secret-1"), "custom_secret-1");
});

test("rejects missing tokens and invalid explicit secrets", () => {
  assert.equal(telegramWebhookSecret(""), null);
  assert.equal(telegramWebhookSecret(undefined), null);
  assert.throws(() => telegramWebhookSecret("token", "invalid secret"));
  assert.throws(() => telegramWebhookSecret("token", "x".repeat(257)));
});

test("requires a matching, nonempty webhook header", () => {
  const expected = telegramWebhookSecret("12345:example");
  assert.equal(verifyTelegramWebhookSecret(expected, expected), true);
  assert.equal(verifyTelegramWebhookSecret(expected + "x", expected), false);
  assert.equal(verifyTelegramWebhookSecret("incorrect", expected), false);
  assert.equal(verifyTelegramWebhookSecret(null, expected), false);
  assert.equal(verifyTelegramWebhookSecret(expected, null), false);
});

test("never registers webhooks in previews or local development", () => {
  assert.equal(shouldSetTelegramWebhook("production"), true);
  for (const env of ["preview", "development", undefined, "staging"]) {
    assert.equal(shouldSetTelegramWebhook(env), false);
  }
});
