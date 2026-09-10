#!/usr/bin/env node
/**
 * Write complete sportybet.ts (full SportyBet board: NBA + all football/basketball markets).
 * Source is embedded as base64 next to this script so builds never depend on GitHub raw fetch.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const b64Path = join(__dirname, "sporty-chunks", "sporty.full.b64");

if (!existsSync(b64Path)) {
  console.error("missing", b64Path);
  process.exit(1);
}
const b64 = readFileSync(b64Path, "utf8").replace(/\s+/g, "");
const src = Buffer.from(b64, "base64").toString("utf8");
if (src.length < 20000 || !src.includes("footballCandidates") || !src.includes("cookablePick")) {
  console.error("decoded sportybet corrupt", src.length);
  process.exit(1);
}
writeFileSync("src/lib/sportybet.ts", src);
console.log("sportybet.ts open-markets ready", src.length, "NBA+GG+HCP+1X2 open");
