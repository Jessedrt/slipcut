#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
const path = "src/lib/sportybet.ts";
if (existsSync(path) && readFileSync(path, "utf8").includes("QUALITY_COOK_V4")) {
  console.log("expand-markets skipped — QUALITY_COOK_V4 source is canonical");
  process.exit(0);
}
console.warn("skip expand-markets — source is canonical");
process.exit(0);
