import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../src/routes/__root.tsx", import.meta.url);
const miniApp = new URL("../src/components/mini-app-refresh.tsx", import.meta.url);
const telegram = new URL("../src/lib/telegram.ts", import.meta.url);

test("loads Telegram Mini App SDK before application scripts", async () => {
  const source = await readFile(root, "utf8");
  const sdk = source.indexOf("https://telegram.org/js/telegram-web-app.js");
  const scripts = source.indexOf("<Scripts />");
  assert.ok(sdk >= 0, "Telegram Mini App SDK is missing");
  assert.ok(sdk < scripts, "Telegram Mini App SDK must load before application scripts");
});

test("hydrates signed Telegram initData after the Web App SDK is ready", async () => {
  const source = await readFile(miniApp, "utf8");
  assert.match(source, /useSyncExternalStore\(subscribeTelegramInitData, telegramInitData/);
  assert.match(source, /telegramWebApp\(\)\?\.initData \?\? ""/);
});

test("bot removes the repetitive persistent keyboard", async () => {
  const source = await readFile(telegram, "utf8");
  assert.doesNotMatch(source, /function deskKeyboard\(\)/);
  assert.doesNotMatch(source, /is_persistent:\s*true/);
  assert.match(source, /REMOVE_DESK_KEYBOARD = \{ remove_keyboard: true \}/);
  assert.match(source, /reply_markup: REMOVE_DESK_KEYBOARD/);
});

test("unknown messages do not repeat the full help options", async () => {
  const source = await readFile(telegram, "utf8");
  assert.match(source, /I couldn't understand that\./);
  assert.doesNotMatch(source, /await tg\("sendMessage", \{ chat_id: chatId, text: HELP \}\)/);
});

test("specific odds requests are resolved before general sport requests", async () => {
  const source = await readFile(telegram, "utf8");
  const odds = source.indexOf("const oddsMatch = lower.match(/(?:cook");
  const general = source.indexOf("// Resolve general build requests once");
  assert.ok(odds >= 0 && odds < general);
});
