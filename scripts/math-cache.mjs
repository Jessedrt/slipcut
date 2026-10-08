#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/lib/engine.ts";
let source = readFileSync(path, "utf8");
const target = 'const ENGINE_POLICY_VERSION = "odds-target-ladder-v8-robust-math";';
if (source.includes(target)) {
  console.log("robust math engine cache: already applied");
  process.exit(0);
}
const next = source.replace(
  /const ENGINE_POLICY_VERSION = "[^"]+";/,
  target,
);
if (next === source) throw new Error("robust math engine cache: version marker not found");
writeFileSync(path, next);
console.log("robust math engine cache: applied");
