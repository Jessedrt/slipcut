#!/usr/bin/env node
/**
 * Write complete sportybet.ts (full SportyBet board: NBA + all football/basketball markets).
 * Source is split base64 parts next to this script so Vercel builds stay reliable.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const parts = [];
for (let i = 0; i < 5; i++) {
  const p = join(__dirname, "sporty-chunks", `sporty.part${i}.b64`);
  if (!existsSync(p)) {
    console.error("missing", p);
    process.exit(1);
  }
  parts.push(readFileSync(p, "utf8").replace(/\s+/g, ""));
}
const b64 = parts.join("");
const src = Buffer.from(b64, "base64").toString("utf8");
if (src.length < 20000 || !src.includes("footballCandidates") || !src.includes("cookablePick")) {
  console.error("decoded sportybet corrupt", src.length);
  process.exit(1);
}
writeFileSync("src/lib/sportybet.ts", src);
console.log("sportybet.ts open-markets ready", src.length, "NBA+GG+HCP+1X2 open");
