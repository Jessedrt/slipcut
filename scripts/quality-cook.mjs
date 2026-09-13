#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
const path = "src/lib/sportybet.ts";
if (existsSync(path) && readFileSync(path, "utf8").includes("QUALITY_COOK_V4")) {
  console.log("QUALITY_COOK_V4 already baked into sportybet.ts");
  process.exit(0);
}
console.warn("QUALITY_COOK_V4 marker missing — source must include the allowlist");
process.exit(0);
