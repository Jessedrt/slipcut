#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";
const p1 = "scripts/telegram.part1.txt";
const p2 = "scripts/telegram.part2.txt";

function isValid(src) {
  return (
    src &&
    src.length > 10000 &&
    src.includes("handleTelegramUpdate") &&
    src.includes("runDeskCron") &&
    src.includes("FIND_SAFER")
  );
}

if (existsSync(p1) && existsSync(p2)) {
  const src = readFileSync(p1, "utf8") + readFileSync(p2, "utf8");
  if (isValid(src)) {
    writeFileSync(path, src);
    console.log("telegram.ts assembled from parts", src.length);
    process.exit(0);
  }
  console.warn("parts invalid", src.length);
}

if (existsSync(path) && isValid(readFileSync(path, "utf8"))) {
  console.log("telegram.ts ok", readFileSync(path, "utf8").length);
  process.exit(0);
}

console.error("telegram.ts invalid");
process.exit(1);
