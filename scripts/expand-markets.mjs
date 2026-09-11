#!/usr/bin/env node
/**
 * Expand football + basketball market options so cook has more legs to pick from.
 * Safe to run every build; idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
if (!existsSync(path)) {
  console.warn("sportybet.ts missing, skip expand-markets");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("EXPAND_MARKETS_V2")) {
  console.log("expand-markets already applied");
  process.exit(0);
}

const NEW_FOOTBALL = `function footballCandidates(ev: EventDetail): TicketPick[] {
  // EXPAND_MARKETS_V2 — wider board for safer cooking
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];
  const pull = (pred: (m: EventMarket) => boolean, oversOnly = false) => {
    for (const market of markets) {
      if (!pred(market)) continue;
      if (oversOnly) pushOver(picks, ev, "football", market);
      else pushMarket(picks, ev, "football", market);
    }
  };

  // Result markets
  pull((m) => m.id === "1"); // 1X2
  pull((m) => m.id === "10"); // Double chance
  pull((m) => m.id === "11"); // Draw no bet
  pull((m) => m.id === "63" || /1st half.*double chance/i.test(m.desc ?? ""));
  pull((m) => m.id === "60" || /1st half.*1x2|1st half result/i.test(m.desc ?? ""));

  // BTTS / GG
  pull((m) => m.id === "29" || /both teams|btts|gg\\/ng|gg ng/i.test(m.desc ?? ""));
  pull((m) => m.id === "64" || /1st half.*(btts|both teams|gg)/i.test(m.desc ?? ""));

  // Handicaps (all lines in book window)
  pull((m) => m.id === "16" || m.id === "14" || m.id === "223" || m.id === "66");
  pull((m) => /asian handicap|handicap/i.test(m.desc ?? "") && !/corner/i.test(m.desc ?? ""));

  // Full-time O/U — many lines
  for (const line of ["0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5.5"]) {
    pull((m) => m.id === "18" && (m.specifier === \`total=\${line}\` || m.specifier === \`total=\${line}.0\`));
  }
  // Any remaining FT totals via balanced pick
  {
    const ou = lowerOverLine(markets.filter((m) => m.id === "18")) || mostBalanced(markets.filter((m) => m.id === "18"));
    if (ou) pushOver(picks, ev, "football", ou);
  }

  // 1H / 2H totals
  for (const line of ["0.5", "1", "1.5", "2", "2.5"]) {
    pull((m) => m.id === "68" && m.specifier === \`total=\${line}\`, true);
  }
  pull((m) => m.id === "62" || /2nd half.*over\\/under|2nd half.*total/i.test(m.desc ?? ""), true);
  pull((m) => /1st half.*over\\/under|1st half.*total/i.test(m.desc ?? "") && m.id !== "68", true);

  // Team totals (home/away)
  pull((m) => (m.id === "227" || m.id === "228") && /total=(0\\.5|1|1\\.5|2|2\\.5)/.test(m.specifier ?? ""), true);
  pull((m) => (m.id === "69" || m.id === "70") && /total=(0\\.5|1|1\\.5)/.test(m.specifier ?? ""), true);

  // Corners O/U (common lines)
  pull(
    (m) =>
      /corner/i.test(m.desc ?? "") &&
      /over\\/under|total/i.test(m.desc ?? "") &&
      /total=(7\\.5|8\\.5|9\\.5|10\\.5|11\\.5|12\\.5)/.test(m.specifier ?? ""),
    true,
  );
  // Cards / bookings if present
  pull(
    (m) =>
      /card|booking/i.test(m.desc ?? "") &&
      /over\\/under|total/i.test(m.desc ?? "") &&
      /total=(2\\.5|3\\.5|4\\.5)/.test(m.specifier ?? ""),
    true,
  );

  // Odd/Even goals
  pull((m) => m.id === "8" || /odd\\/even|odd or even/i.test(m.desc ?? ""));

  return picks;
}`;

const NEW_BASKET = `function basketballCandidates(ev: EventDetail): TicketPick[] {
  // EXPAND_MARKETS_V2 — wider board for safer cooking
  const markets = (ev.markets ?? []).filter((m) => m.status === 0);
  const picks: TicketPick[] = [];

  // Moneyline
  pushMarket(picks, ev, "basketball", markets.find((m) => m.id === "219") || markets.find((m) => m.id === "186"));
  // Handicap — all balanced lines
  for (const id of ["223", "14", "16", "66"]) {
    const best = mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
  }
  // Also pull extra handicap lines in book window
  for (const m of markets) {
    if (m.id === "223" || m.id === "14" || m.id === "16") pushMarket(picks, ev, "basketball", m);
  }

  // Game totals — many lines + lower-over preference
  for (const id of ["225", "18"]) {
    const best = lowerOverLine(markets.filter((m) => m.id === id)) || mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
    for (const m of markets.filter((x) => x.id === id)) pushOver(picks, ev, "basketball", m);
  }

  // Team totals
  for (const id of ["227", "228"]) {
    const best = lowerOverLine(markets.filter((m) => m.id === id)) || mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
  }

  // 1H totals / team totals
  for (const id of ["68", "69", "70"]) {
    const best = lowerOverLine(markets.filter((m) => m.id === id)) || mostBalanced(markets.filter((m) => m.id === id));
    if (best) pushMarket(picks, ev, "basketball", best);
  }

  // 1st quarter totals
  pushMarket(
    picks,
    ev,
    "basketball",
    lowerOverLine(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))) ||
      mostBalanced(markets.filter((m) => m.id === "236" && (m.specifier ?? "").includes("quarternr=1"))),
  );

  // 1H moneyline / handicap if present
  for (const m of markets) {
    if (/1st half|first half/i.test(m.desc ?? "") && (m.id === "186" || m.id === "219" || m.id === "223" || m.id === "14")) {
      pushMarket(picks, ev, "basketball", m);
    }
  }

  return picks;
}`;

const fbRe = /function footballCandidates\(ev: EventDetail\): TicketPick\[] \{[\s\S]*?\n\}/;
if (!fbRe.test(t)) {
  console.warn("footballCandidates not found");
} else {
  t = t.replace(fbRe, NEW_FOOTBALL);
  console.log("footballCandidates expanded");
}

const bbRe = /function basketballCandidates\(ev: EventDetail\): TicketPick\[] \{[\s\S]*?\n\}/;
if (!bbRe.test(t)) {
  console.warn("basketballCandidates not found");
} else {
  t = t.replace(bbRe, NEW_BASKET);
  console.log("basketballCandidates expanded");
}

writeFileSync(path, t);
console.log("expand-markets done", t.includes("EXPAND_MARKETS_V2"));
