#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const path = "src/lib/telegram.ts";
const partsDir = "scripts";

const partFiles = readdirSync(partsDir)
  .filter((f) => /^telegram\.b64\.\d+$/.test(f))
  .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()));

if (partFiles.length) {
  const b64 = partFiles.map((f) => readFileSync(join(partsDir, f), "utf8").trim()).join("");
  const buf = Buffer.from(b64, "base64");
  writeFileSync(path, buf);
  console.log("telegram.ts restored from b64 parts", buf.length);
  process.exit(0);
}

if (existsSync(path)) {
  const cur = readFileSync(path, "utf8");
  if (cur.includes("handleTelegramUpdate") && cur.includes("trimCode") && cur.length > 10_000) {
    console.log("telegram.ts ok", cur.length);
    process.exit(0);
  }
}
console.error("telegram.ts missing handleTelegramUpdate");
process.exit(1);
