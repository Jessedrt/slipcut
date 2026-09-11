#!/usr/bin/env node
/**
 * Quality cook filter:
 * 1) HARD allowlist — only top football/basketball leagues enter the cook pool
 * 2) Expand weak patterns as extra safety net
 * 3) Prefer safer market families (DC/GG/FT O/U) over fragile 1H Over 0.5
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
if (!existsSync(path)) {
  console.warn("sportybet.ts missing, skip quality filter");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("QUALITY_COOK_V1")) {
  console.log("quality cook filter already present");
  process.exit(0);
}

const NEW_FOOTBALL_LEAGUES = `const FOOTBALL_LEAGUES =
  /premier league|\\bepl\\b|laliga|la liga|serie a|bundesliga|ligue 1|champions league|\\bucl\\b|uefa cl|caf champions|afc champions|concacaf champions|europa league|\\buel\\b|conference league|eredivisie|primeira|liga portugal|championship|\\bmls\\b|copa libertadores|nations league|pro league|belgian|saudi|\\bnpfl\\b|turkish super|super lig|superlig|scottish premiership|liga mx|liga profesional|brasileirao|serie a brazil|allsvenskan|eliteserien|superliga|a-?league|j-?league|k-?league|egyptian premier|south african premier|caf confederation/i`;

const NEW_BASKET_LEAGUES = `const BASKETBALL_LEAGUES =
  /\\bnba\\b|euroleague|eurocup|\\bncaa\\b|\\bwnba\\b|\\bnbl\\b|\\bacb\\b|liga endesa|\\bbbl\\b|\\bcba\\b|\\bkbl\\b|b\\.?league|\\bfiba\\b|world cup|olympi|eurobasket|americup|afrobasket|\\baba\\b|adriatic|pro a|\\blnb\\b|serie a|basketbol super|\\bvtb\\b|\\bnbb\\b|champions league|\\bcebl\\b|nbl australia|greek basket|bnxt/i`;

if (/const FOOTBALL_LEAGUES =\s*\/[^/]+\//.test(t)) {
  t = t.replace(/const FOOTBALL_LEAGUES =\s*\/[^/]+\//i, NEW_FOOTBALL_LEAGUES);
  console.log("FOOTBALL_LEAGUES updated");
}
if (/const BASKETBALL_LEAGUES =\s*\/[^/]+\//.test(t)) {
  t = t.replace(/const BASKETBALL_LEAGUES =\s*\/[^/]+\//i, NEW_BASKET_LEAGUES);
  console.log("BASKETBALL_LEAGUES updated");
}

const WEAK_AND_STRONG = `
const WEAK_BASKETBALL_LEAGUE =
  /3x3|tbt\\b|the basketball tournament|development|reserve|u-?1[89]|u-?2[01]|youth|cadet|junior|amateur|friendly|liga nacional|lnbp|libobasquet|liga boliviana|liga uruguaya|liga sudamericana|bcl americas|paraguayan|venezuelan|cuban|nicaragu|hondur|kosovo|albanian|mongolian|n1 league|b2 league|east asia super|liga argentina|liga mexicana|liga chilena|liga colombiana|liga peruana|liga ecuatoriana|asean|qbl|division 2|div 2|segunda|tercer|regional|student/i;
const WEAK_FOOTBALL_LEAGUE =
  /reserve|u-?1[789]|u-?2[01]|youth|cadet|junior|amateur|friendly|primavera|regional|division 3|third division|fourth division|serie d|national league south|national league north|conference north|conference south|non.?league|county league|liga 3|liga 4|u19|u20|u21|u23|reserva|filial|b team|2nd team|development squad|academy|primera b|primera c|primera d|metropolitana|torneo federal|regional amateur|ituzaingo|comunicaciones|argentina.?b|argentina.?c|liga regional|segund[ao]|tercer[ao]|fourth tier|fifth tier|county|district|village/i;
function isWeakLeague(name: string) {
  const n = name || "";
  return WEAK_BASKETBALL_LEAGUE.test(n) || WEAK_FOOTBALL_LEAGUE.test(n);
}
function isStrongLeague(sport: BookSport, name: string) {
  const n = name || "";
  if (isWeakLeague(n) || /simulat|virtual|esoccer|e-?soccer/i.test(n)) return false;
  if (sport === "basketball") return BASKETBALL_LEAGUES.test(n);
  if (sport === "tennis") return TENNIS_LEAGUES.test(n);
  if (sport === "handball") return HANDBALL_LEAGUES.test(n);
  return FOOTBALL_LEAGUES.test(n) || /champions league|europa league|conference league/i.test(n);
}
`;

if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;/.test(t)) {
  t = t.replace(/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;\n(?:const WEAK_FOOTBALL_LEAGUE =[\s\S]*?;\n)?(?:function isWeakLeague[\s\S]*?\n\})?/, WEAK_AND_STRONG.trim() + "\n");
} else if (t.includes("const SIMULATED_LEAGUE")) {
  t = t.replace("const SIMULATED_LEAGUE", WEAK_AND_STRONG + "\nconst SIMULATED_LEAGUE");
} else {
  console.warn("could not inject weak/strong helpers");
}

if (!t.includes("function isStrongLeague")) {
  t = t.replace(
    /function isWeakLeague\(name: string\) \{[\s\S]*?\n\}/,
    (m) =>
      m +
      `\nfunction isStrongLeague(sport: BookSport, name: string) {
  const n = name || "";
  if (isWeakLeague(n) || /simulat|virtual|esoccer|e-?soccer/i.test(n)) return false;
  if (sport === "basketball") return BASKETBALL_LEAGUES.test(n);
  if (sport === "tennis") return TENNIS_LEAGUES.test(n);
  if (sport === "handball") return HANDBALL_LEAGUES.test(n);
  return FOOTBALL_LEAGUES.test(n) || /champions league|europa league|conference league/i.test(n);
}`,
  );
}

if (!t.includes("!isStrongLeague(sport, e.leagueHint") && !t.includes("isStrongLeague(sport, e.leagueHint")) {
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&\n(\s*)!isWeakLeague\(e\.leagueHint \?\? ""\) &&/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n$1isStrongLeague(sport, e.leagueHint ?? "") &&',
  );
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&\n(\s*)inCookWindow/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n$1isStrongLeague(sport, e.leagueHint ?? "") &&\n$1inCookWindow',
  );
}

if (!t.includes("isStrongLeague(sport, leagueName(ev.sport))")) {
  t = t.replace(
    /if \(SIMULATED_LEAGUE\.test\(leagueName\(ev\.sport\)\)\) continue;(\n\s*if \(isWeakLeague\(leagueName\(ev\.sport\)\)\) continue;)?/,
    'if (SIMULATED_LEAGUE.test(leagueName(ev.sport))) continue;\n      if (!isStrongLeague(sport, leagueName(ev.sport))) continue;',
  );
}

const NEW_PICK = `function pickFromEvent(cands: TicketPick[], used: Record<string, number>): TicketPick | null {
  // QUALITY_COOK_V1 — prefer solid markets over fragile 1H Over 0.5
  const pool0 = cands.filter(cookablePick);
  if (!pool0.length) return null;
  const totalUsed = Object.values(used).reduce((n, v) => n + v, 0);
  const families = [...new Set(pool0.map((p) => marketFamily(p.sporty?.marketId, p.market)))];
  const hasOu = families.includes("ou");
  const hasDc = families.includes("dc");
  const hasGg = families.includes("gg");
  const ouShare = totalUsed ? (used.ou ?? 0) / totalUsed : 0;
  const dcShare = totalUsed ? (used.dc ?? 0) / totalUsed : 0;
  const ggShare = totalUsed ? (used.gg ?? 0) / totalUsed : 0;
  families.sort(
    (a, b) =>
      (used[a] ?? 0) - (used[b] ?? 0) ||
      Number(a === "win") - Number(b === "win") ||
      Number(a === "odd") - Number(b === "odd") ||
      Number(a === "ou1h") - Number(b === "ou1h") ||
      Number(a === "hcp") - Number(b === "hcp"),
  );
  let family = families[0];
  if (hasDc && dcShare < 0.18) family = "dc";
  else if (hasGg && ggShare < 0.15) family = "gg";
  else if (hasOu && ouShare < 0.28) family = "ou";
  const pool = family
    ? pool0.filter((p) => marketFamily(p.sporty?.marketId, p.market) === family)
    : pool0;
  const score = (p: TicketPick) => {
    const fam = marketFamily(p.sporty?.marketId, p.market);
    const odds = Number(p.odds) || 9;
    const label = \`\${p.market ?? ""} \${p.selection ?? ""}\`.toLowerCase();
    let s = implied(p.odds);
    if (fam === "ou") s += 0.12;
    if (fam === "dc") s += 0.14;
    if (fam === "gg") s += 0.1;
    if (fam === "dnb") s += 0.08;
    if (fam === "ou1h") s -= 0.18;
    if (/1st half|1h/.test(label) && /over\\s*0\\.5|over\\s*1(\\.0)?\\b/.test(label)) s -= 0.25;
    if (odds >= 1.25 && odds <= 1.65) s += 0.08;
    if (odds > 2.1) s -= 0.1;
    if (p.sporty?.marketId === "225" || p.sporty?.marketId === "18") s += 0.06;
    return s;
  };
  const pick = pool.slice().sort((a, b) => score(b) - score(a))[0];
  if (pick && family) used[family] = (used[family] ?? 0) + 1;
  return pick ?? null;
}`;

const pickRe = /function pickFromEvent\(cands: TicketPick\[\], used: Record<string, number>\): TicketPick \| null \{[\s\S]*?\n\}/;
if (pickRe.test(t)) {
  t = t.replace(pickRe, NEW_PICK);
  console.log("pickFromEvent quality scoring applied");
} else {
  console.warn("pickFromEvent not found");
}

if (!t.includes("QUALITY_COOK_V1")) {
  t = "// QUALITY_COOK_V1\n" + t;
}

writeFileSync(path, t);
console.log("quality filter done", {
  strong: t.includes("isStrongLeague"),
  quality: t.includes("QUALITY_COOK_V1"),
  pick: t.includes("prefer solid markets"),
});
