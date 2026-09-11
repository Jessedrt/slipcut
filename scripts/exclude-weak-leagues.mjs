#!/usr/bin/env node
/**
 * Hard-exclude weak / amateur / youth / reserve leagues from the cook pool.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
if (!existsSync(path)) {
  console.warn("sportybet.ts missing, skip weak-league patch");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("function isWeakLeague") && t.includes("!isWeakLeague(e.leagueHint")) {
  console.log("weak-league filter already present");
  process.exit(0);
}

const WEAK_BLOCK = `
const WEAK_BASKETBALL_LEAGUE =
  /3x3|tbt\\b|the basketball tournament|development|reserve|u-?1[89]|u-?2[01]|youth|cadet|junior|amateur|friendly|liga nacional|lnbp|libobasquet|liga boliviana|liga uruguaya|liga sudamericana|bcl americas|paraguayan|venezuelan|cuban|nicaragu|hondur|kosovo|albanian|mongolian|n1 league|b2 league|east asia super|liga argentina|liga mexicana|liga chilena|liga colombiana|liga peruana|liga ecuatoriana|asean|qbl|division 2|div 2|segunda|tercer|regional|student/i;
const WEAK_FOOTBALL_LEAGUE =
  /reserve|u-?1[789]|u-?2[01]|youth|cadet|junior|amateur|friendly|primavera|regional|division 3|third division|fourth division|serie d|national league south|national league north|conference north|conference south|non.?league|county league|liga 3|liga 4|u19|u20|u21|u23|reserva|filial|b team|2nd team|development squad|academy/i;
function isWeakLeague(name: string) {
  const n = name || "";
  return WEAK_BASKETBALL_LEAGUE.test(n) || WEAK_FOOTBALL_LEAGUE.test(n);
}
`;

if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;/.test(t)) {
  t = t.replace(/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;/, WEAK_BLOCK.trim());
} else if (t.includes("const SIMULATED_LEAGUE")) {
  t = t.replace("const SIMULATED_LEAGUE", WEAK_BLOCK + "\nconst SIMULATED_LEAGUE");
} else {
  console.warn("could not inject WEAK block");
}

if (!t.includes("!isWeakLeague(e.leagueHint")) {
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n        !isWeakLeague(e.leagueHint ?? "") &&',
  );
}
if (!t.includes("isWeakLeague(leagueName(ev.sport))")) {
  t = t.replace(
    /if \(SIMULATED_LEAGUE\.test\(leagueName\(ev\.sport\)\)\) continue;/,
    'if (SIMULATED_LEAGUE.test(leagueName(ev.sport))) continue;\n      if (isWeakLeague(leagueName(ev.sport))) continue;',
  );
}

writeFileSync(path, t);
console.log("weak leagues excluded from cook pool", t.includes("isWeakLeague"));
