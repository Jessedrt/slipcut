#!/usr/bin/env node
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
const p1 = "src/bot/handlers.b64.1";
const p2 = "src/bot/handlers.b64.2";
if (!existsSync(p1) || !existsSync(p2)) {
  console.log("handlers b64 missing, skip");
  process.exit(0);
}
const a = readFileSync(p1, "utf8").trim();
const b = readFileSync(p2, "utf8").trim();
mkdirSync("src/bot", { recursive: true });
const buf = Buffer.from(a + b, "base64");
writeFileSync("src/bot/handlers.ts", buf);
console.log("handlers restored", buf.length);
