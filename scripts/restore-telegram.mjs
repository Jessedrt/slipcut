#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const path = "src/lib/telegram.ts";
const partsDir = "scripts";

function isValidTelegram(src) {
  return (
    typeof src === "string" &&
    src.length > 10_000 &&
    src.includes("handleTelegramUpdate") &&
    src.includes("trimCode")
  );
}

// Prefer valid source file first (so incomplete b64 cannot wipe a good bot)
if (existsSync(path)) {
  const cur = readFileSync(path, "utf8");
  if (isValidTelegram(cur)) {
    console.log("telegram.ts ok", cur.length);
    process.exit(0);
  }
}

const partFiles = readdirSync(partsDir)
  .filter((f) => /^telegram\.b64\.\d+$/.test(f))
  .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()));

if (partFiles.length) {
  try {
    const b64 = partFiles.map((f) => readFileSync(join(partsDir, f), "utf8").trim()).join("");
    const buf = Buffer.from(b64, "base64");
    const src = buf.toString("utf8");
    if (isValidTelegram(src)) {
      writeFileSync(path, buf);
      console.log("telegram.ts restored from b64 parts", buf.length);
      process.exit(0);
    }
    console.warn("telegram b64 parts invalid — skipping", buf.length);
  } catch (e) {
    console.warn("telegram b64 restore failed", e);
  }
}

if (existsSync(path) && isValidTelegram(readFileSync(path, "utf8"))) {
  console.log("telegram.ts ok", readFileSync(path, "utf8").length);
  process.exit(0);
}

console.error("telegram.ts missing handleTelegramUpdate");
process.exit(1);
