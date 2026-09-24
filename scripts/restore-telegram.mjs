#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";

function isValid(src) {
  return (
    typeof src === "string" &&
    src.length > 10000 &&
    src.includes("handleTelegramUpdate") &&
    src.includes("runDeskCron") &&
    !src.includes("PLACEHOLDER")
  );
}

if (existsSync(path) && isValid(readFileSync(path, "utf8"))) {
  console.log("telegram.ts ok", readFileSync(path, "utf8").length);
  process.exit(0);
}

console.error("telegram.ts missing or PLACEHOLDER — build cannot continue");
process.exit(1);
