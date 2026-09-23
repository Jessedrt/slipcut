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

test("persistent bot keyboard excludes Predict and UCL", async () => {
  const source = await readFile(telegram, "utf8");
  const start = source.indexOf("function deskKeyboard()");
  const end = source.indexOf("\n}\n", start);
  const keyboard = source.slice(start, end);
  assert.doesNotMatch(keyboard, /text: "Predict"/);
  assert.doesNotMatch(keyboard, /text: "UCL"/);
  assert.match(source, /reply_markup: deskKeyboard\(\)/);
});
