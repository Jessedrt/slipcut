#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
const path = "src/lib/telegram.ts";
const chunks = readdirSync("scripts")
  .filter((f) => /^tchunk\d+$/.test(f))
  .sort((a, b) => Number(a.replace("tchunk", "")) - Number(b.replace("tchunk", "")));
if (chunks.length) {
  const b64 = chunks.map((f) => readFileSync("scripts/" + f, "utf8").trim()).join("");
  const buf = Buffer.from(b64, "base64");
  const src = buf.toString("utf8");
  if (
    src.includes("handleTelegramUpdate") &&
    src.includes("runDeskCron") &&
    src.includes("FIND_SAFER") &&
    src.length > 10000
  ) {
    writeFileSync(path, buf);
    console.log("telegram.ts from tchunks", buf.length);
    process.exit(0);
  }
  console.warn("tchunks invalid", buf.length);
}
if (existsSync(path)) {
  const cur = readFileSync(path, "utf8");
  if (cur.includes("handleTelegramUpdate") && cur.includes("runDeskCron") && cur.length > 10000) {
    console.log("telegram.ts ok", cur.length);
    process.exit(0);
  }
}
console.error("telegram.ts invalid");
process.exit(1);
