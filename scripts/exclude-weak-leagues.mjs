#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
const path = "src/lib/sportybet.ts";
if (existsSync(path) && readFileSync(path, "utf8").includes("QUALITY_COOK_V4")) {
  console.log("weak-league filter baked into sportybet.ts");
  process.exit(0);
}
console.warn("skip exclude-weak-leagues — source is canonical");
process.exit(0);
