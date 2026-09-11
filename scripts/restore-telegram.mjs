#!/usr/bin/env node
/**
 * If telegram.ts was truncated, restore from last known-good commit.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";

const GOOD =
  "https://raw.githubusercontent.com/Jessedrt/slipcut/5f8bcb21071fbd07ad79284cc40d8c2ec8924b32/src/lib/telegram.ts";

const path = "src/lib/telegram.ts";
let need = true;
if (existsSync(path)) {
  const cur = readFileSync(path, "utf8");
  if (cur.length > 15000 && cur.includes("handleTelegramUpdate") && cur.includes("trimCode")) {
    console.log("telegram.ts ok", cur.length);
    need = false;
  }
}
if (!need) process.exit(0);

try {
  const res = await fetch(GOOD, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("fetch " + res.status);
  const t = await res.text();
  if (t.length < 15000 || !t.includes("handleTelegramUpdate")) throw new Error("bad body");
  writeFileSync(path, t);
  console.log("telegram.ts restored", t.length);
} catch (e) {
  console.error("telegram restore failed", e);
  process.exit(1);
}
