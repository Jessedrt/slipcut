#!/usr/bin/env node
/**
 * Restore sportybet.ts from a known-good commit, then open NBA + full market families.
 * Runs as part of `npm run build` so production always gets a complete module.
 */
import { writeFileSync } from "fs";

const GOOD =
  "https://raw.githubusercontent.com/Jessedrt/slipcut/91a53487c5b8d7889b691c82da6604b7ab74e48e/src/lib/sportybet.ts";

const res = await fetch(GOOD);
if (!res.ok) {
  console.error("Failed to fetch sportybet base", res.status);
  process.exit(1);
}
let t = await res.text();

// NBA in league prefer list
t = t.replace(
  "/euroleague|eurocup|ncaa|wnba|nbl|acb|bbl|cba|kbl|b\\.?league|fiba|world cup|olympi|eurobasket|americup|afrobasket|aba|adriatic|liga endesa|pro a|lnb|serie a|basketbol super|vtb|nbb|champions league|cebl|nbl australia/i;",
  "/\\bnba\\b|euroleague|eurocup|ncaa|wnba|nbl|acb|bbl|cba|kbl|b\\.?league|fiba|world cup|olympi|eurobasket|americup|afrobasket|aba|adriatic|liga endesa|pro a|lnb|serie a|basketbol super|vtb|nbb|champions league|cebl|nbl australia/i;",
);

// Stop stripping NBA from basketball candidates
t = t.replace(
  "  return picks.filter((p) => !/\\bnba\\b/i.test(p.league ?? \"\"));\n}",
  "  return picks;\n}",
);

// Allow all market families
const oldCook = `export function cookablePick(p: TicketPick) {
  const id = p.sporty?.marketId;
  const fam = marketFamily(id, p.market);
  if (p.sport === "basketball" && /\\bnba\\b/i.test(p.league ?? "")) return false;
  if (p.sport === "football" || p.sport === "basketball") {
    if (id === "1" || id === "60" || id === "219" || fam === "win") return false;
    if (id === "16" || id === "66" || id === "223" || fam === "hcp") return false;
  }
  if (p.sport === "football" && (fam === "gg" || id === "29" || id === "64")) return false;
  return true;
}`;
const newCook = `export function cookablePick(p: TicketPick) {
  // Full SportyBet board — user trims to best
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
  return true;
}`;
if (!t.includes(oldCook)) {
  console.error("cookablePick pattern missing");
  process.exit(1);
}
t = t.replace(oldCook, newCook);

// Drop NBA event filter in listUpcoming
t = t.replace(
  '        (sport !== "basketball" || !/\\bnba\\b/i.test(e.leagueHint ?? "")) &&\n',
  "",
);

// Expand football candidates: GG, handicap, under+over
t = t.replace(
  `  pull((m) => m.id === "1");
  pull((m) => m.id === "10");
  pull((m) => m.id === "11");
  pull((m) => m.id === "63" || /1st half.*double chance/i.test(m.desc ?? ""));

  for (const line of ["0.5", "1.5", "2", "2.5", "3", "3.5", "4.5"]) {
    pull((m) => m.id === "18" && m.specifier === \`total=\${line}\`, true);
  }
  for (const line of ["0.5", "1", "1.5"]) {
    pull((m) => m.id === "68" && m.specifier === \`total=\${line}\`, true);
  }
  pull((m) => m.id === "62" || /2nd half.*over\\/under/i.test(m.desc ?? ""), true);
  pull((m) => (m.id === "227" || m.id === "228") && /total=(0\\.5|1\\.5)/.test(m.specifier ?? ""), true);
  pull((m) => (m.id === "69" || m.id === "70") && /total=(0\\.5|1|1\\.5)/.test(m.specifier ?? ""), true);
  pull(
    (m) => /corner/i.test(m.desc ?? "") && /over\\/under|total/i.test(m.desc ?? "") && /total=(8\\.5|9\\.5|10\\.5|11\\.5)/.test(m.specifier ?? ""),
    true,
  );`,
  `  pull((m) => m.id === "1");
  pull((m) => m.id === "10");
  pull((m) => m.id === "11");
  pull((m) => m.id === "29" || /both teams|btts|gg/i.test(m.desc ?? ""));
  pull((m) => m.id === "63" || /1st half.*double chance/i.test(m.desc ?? ""));
  pull((m) => m.id === "64");
  pull((m) => m.id === "16" || m.id === "14" || m.id === "223");
  pull((m) => m.id === "66");
  for (const line of ["0.5", "1.5", "2", "2.5", "3", "3.5", "4.5"]) {
    pull((m) => m.id === "18" && m.specifier === \`total=\${line}\`);
  }
  for (const line of ["0.5", "1", "1.5", "2.5"]) {
    pull((m) => m.id === "68" && m.specifier === \`total=\${line}\`);
  }
  pull((m) => m.id === "62" || /2nd half.*over\\/under/i.test(m.desc ?? ""));
  pull((m) => m.id === "227" || m.id === "228");
  pull((m) => m.id === "69" || m.id === "70");
  pull((m) => /corner/i.test(m.desc ?? "") && /over\\/under|total/i.test(m.desc ?? ""));`,
);

// Expand basketball: moneyline + handicap + both sides of totals
t = t.replace(
  `function basketballCandidates(ev: EventDetail): TicketPick[] {
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "225")));
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "227")));
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "228")));
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "68")));
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "69")));
  pushOver(picks, ev, "basketball", lowerOverLine(markets.filter((m) => m.id === "70")));
  pushOver(
    picks,
    ev,
    "basketball",
    lowerOverLine(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))),
  );
  return picks;
}`,
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

writeFileSync("src/lib/sportybet.ts", t);
console.log("sportybet.ts restored + open markets", t.length);
