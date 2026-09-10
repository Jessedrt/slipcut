#!/usr/bin/env node
/**
 * Always write a complete sportybet.ts with the full SportyBet board open
 * (NBA + football 1X2/DC/GG/AH/O-U/team totals/corners).
 * Uses embedded source so Vercel builds never depend on external fetch.
 */
import { writeFileSync } from "fs";

const B64 = `
PLACEHOLDER_WILL_FAIL
`.replace(/\s+/g, "");

const src = Buffer.from(B64, "base64").toString("utf8");
if (src.length < 20000 || !src.includes("footballCandidates") || !src.includes("cookablePick")) {
  console.error("embedded sportybet corrupt", src.length);
  process.exit(1);
}
writeFileSync("src/lib/sportybet.ts", src);
console.log("sportybet.ts open-markets ready", src.length, "NBA+GG+HCP+1X2 open");
