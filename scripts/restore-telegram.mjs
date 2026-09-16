#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";
const b64Path = "scripts/telegram_full.b64";

function isValid(src) {
  return (
    src &&
    src.length > 10000 &&
    src.includes("handleTelegramUpdate") &&
    src.includes("runDeskCron") &&
    src.includes("FIND_SAFER")
  );
}

if (existsSync(b64Path)) {
  try {
    const buf = Buffer.from(readFileSync(b64Path, "utf8").trim(), "base64");
    const src = buf.toString("utf8");
    if (isValid(src)) {
      writeFileSync(path, buf);
      console.log("telegram.ts restored from telegram_full.b64", buf.length);
      process.exit(0);
    }
    console.warn("telegram_full.b64 invalid", buf.length);
  } catch (e) {
    console.warn("b64 restore failed", e);
  }
}

if (existsSync(path) && isValid(readFileSync(path, "utf8"))) {
  console.log("telegram.ts ok", readFileSync(path, "utf8").length);
  process.exit(0);
}

console.error("telegram.ts invalid");
process.exit(1);
