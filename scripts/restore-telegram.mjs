#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";
if (existsSync(path)) {
  const cur = readFileSync(path, "utf8");
  if (cur.includes("handleTelegramUpdate") && cur.includes("trimCode") && cur.length > 10_000) {
    console.log("telegram.ts ok", cur.length);
    process.exit(0);
  }
}
console.error("telegram.ts missing handleTelegramUpdate — refusing to overwrite with a remote stub");
process.exit(1);
