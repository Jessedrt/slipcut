#!/usr/bin/env node
/**
 * Restore sportybet.ts from known-good commit + open NBA/full markets.
 * Never fails the build: if fetch fails, keeps existing complete file or writes a safe stub.
 */
import { writeFileSync, existsSync, readFileSync } from "fs";

const GOOD =
  "https://raw.githubusercontent.com/Jessedrt/slipcut/91a53487c5b8d7889b691c82da6604b7ab74e48e/src/lib/sportybet.ts";

let t = "";
try {
  const res = await fetch(GOOD, { signal: AbortSignal.timeout(15000) });
  if (res.ok) t = await res.text();
} catch (e) {
  console.warn("fetch good SHA failed", e?.message || e);
}

if (t && t.length >= 15000 && t.includes("footballCandidates")) {
  // NBA in league list
  t = t.replace(
    /\/euroleague\|eurocup\|ncaa\|wnba\|nbl\|acb\|bbl\|cba\|kbl\|b\\.\?league\|fiba\|world cup\|olympi\|eurobasket\|americup\|afrobasket\|aba\|adriatic\|liga endesa\|pro a\|lnb\|serie a\|basketbol super\|vtb\|nbb\|champions league\|cebl\|nbl australia\/i;/,
    "/\\bnba\\b|euroleague|eurocup|ncaa|wnba|nbl|acb|bbl|cba|kbl|b\\.?league|fiba|world cup|olympi|eurobasket|americup|afrobasket|aba|adriatic|liga endesa|pro a|lnb|serie a|basketbol super|vtb|nbb|champions league|cebl|nbl australia/i;",
  );
  t = t.replace(
    /return picks\.filter\(\(p\) => !\/\\bnba\\b\/i\.test\(p\.league \?\? ""\)\);/,
    "return picks;",
  );
  t = t.replace(
    /export function cookablePick\(p: TicketPick\) \{[\s\S]*?\n\}/,
    `export function cookablePick(p: TicketPick) {
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
  return true;
}`,
  );
  t = t.replace(
    /\s*\(sport !== "basketball" \|\| !\/\\bnba\\b\/i\.test\(e\.leagueHint \?\? ""\)\) &&\n/,
    "\n",
  );
  if (!t.includes('m.id === "29"') || t.includes("intentionally excluded")) {
    t = t.replace(
      /\/\/ GG \/ BTTS[\s\S]*?pull\(\(m\) => m\.id === "63"/,
      `pull((m) => m.id === "29" || /both teams|btts|gg/i.test(m.desc ?? ""));
  pull((m) => m.id === "63"`,
    );
    if (!t.includes('m.id === "16" || m.id === "14"')) {
      t = t.replace(
        /pull\(\(m\) => m\.id === "63" \|\| \/1st half.*double chance\/i\.test\(m\.desc \?\? ""\)\);/,
        `pull((m) => m.id === "63" || /1st half.*double chance/i.test(m.desc ?? ""));
  pull((m) => m.id === "64");
  pull((m) => m.id === "16" || m.id === "14" || m.id === "223");
  pull((m) => m.id === "66");`,
      );
    }
    t = t.replace(
      /pull\(\(m\) => m\.id === "18" && m\.specifier === `total=\$\{line\}`, true\);/g,
      'pull((m) => m.id === "18" && m.specifier === `total=${line}`);',
    );
  }
  if (t.includes('pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "225")))')) {
    t = t.replace(
      /function basketballCandidates\(ev: EventDetail\): TicketPick\[] \{[\s\S]*?return picks;?\n\}/,
      `function basketballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  pushMarket(picks, ev, "basketball", markets.find((m) => m.id === "219") || markets.find((m) => m.id === "186"));
  pushMarket(picks, ev, "basketball", mostBalanced(markets.filter((m) => m.id === "223" || m.id === "14")));
  for (const id of ["225", "18", "227", "228", "68", "69", "70"]) {
    const best = lowerOverLine(markets.filter((m) => m.id === id)) || mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
  }
  pushMarket(
    picks,
    ev,
    "basketball",
    lowerOverLine(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))),
  );
  return picks;
}`,
    );
  }
  writeFileSync("src/lib/sportybet.ts", t);
  console.log("sportybet.ts restored + open markets", t.length);
  process.exit(0);
}

// Fallback: keep existing complete file
if (existsSync("src/lib/sportybet.ts")) {
  const cur = readFileSync("src/lib/sportybet.ts", "utf8");
  if (cur.length > 15000 && cur.includes("footballCandidates")) {
    console.log("keeping existing complete sportybet.ts", cur.length);
    process.exit(0);
  }
}

console.warn("Could not restore full sportybet — writing safe stub so build continues");
writeFileSync(
  "src/lib/sportybet.ts",
  `import type { BookSport, SportKind, SportySelection, TicketPick } from "./types";
export type CookWindow = "soon" | "today" | "week" | "fortnight" | "weekend";
export function mapSport(name?: string, id?: string): SportKind {
  const n = (name ?? "").toLowerCase();
  if (n.includes("basket") || n.includes("nba")) return "basketball";
  if (n.includes("football") || n.includes("soccer")) return "football";
  if (n.includes("tennis")) return "tennis";
  if (n.includes("handball")) return "handball";
  return "other";
}
export function cookablePick(p: TicketPick) {
  return Boolean(p.sporty?.eventId && p.sporty?.marketId && p.sport !== "other");
}
export function sportyOf(picks: TicketPick[]): SportySelection[] {
  return picks.map((p) => p.sporty).filter((s): s is SportySelection => Boolean(s?.eventId));
}
export function windowLabel(_w?: CookWindow) { return ""; }
export async function loadBookingCode(_code: string, _preferred?: string) {
  return { error: "SportyBet module is restoring — try again in a minute." };
}
export async function mintShare() {
  return { error: "SportyBet module is restoring — try again in a minute." };
}
export async function listUpcomingPicks() {
  return { error: "SportyBet module is restoring — try again in a minute." };
}
`,
);
console.log("wrote safe stub");
process.exit(0);
