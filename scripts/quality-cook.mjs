#!/usr/bin/env node
/**
 * QUALITY_COOK_V3 — strict top-league allowlist + block soft 1H overs
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
if (!existsSync(path)) {
  console.warn("sportybet.ts missing, skip quality filter");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("QUALITY_COOK_V3")) {
  console.log("quality cook V3 already present");
  process.exit(0);
}

t = t.replace(/\/\/ QUALITY_COOK_V[12]\n?/g, "");

const NEW_FOOTBALL = `const FOOTBALL_LEAGUES =
  /\\bpremier league\\b|\\bepl\\b|\\blaliga\\b|\\bla liga\\b|\\bserie a\\b(?!\\s*(brazil|brazil|b\\b))|\\bbundesliga\\b|\\bligue 1\\b|\\bchampions league\\b|\\bucl\\b|uefa champions|\\beuropa league\\b|\\buel\\b|\\bconference league\\b|\\beredivisie\\b|\\bprimeira liga\\b|\\bliga portugal\\b|\\befl championship\\b|english championship|\\bmls\\b|major league soccer|\\bcopa libertadores\\b|\\bnations league\\b|\\bbelgian pro league\\b|jupiler|\\bsaudi pro league\\b|roshn saudi|\\bnpfl\\b|nigeria professional|\\bturkish super lig\\b|\\bsuper lig\\b|\\bscottish premiership\\b|\\bliga mx\\b|\\bbrasileir[aã]o\\b|brazil serie a|\\ballsvenskan\\b|\\beliteserien\\b|denmark superliga|\\ba-league\\b|\\bj-league\\b|\\bk-league\\b|egyptian premier|south african premier|\\bcaf champions\\b|\\bcaf confederation\\b|\\bafc champions\\b|\\bconcacaf champions\\b/i`;

const NEW_BASKET = `const BASKETBALL_LEAGUES =
  /\\bnba\\b|\\beuroleague\\b|\\beurocup\\b|\\bncaa\\b|\\bwnba\\b|\\bacb\\b|liga endesa|\\bbbl\\b|\\bcba\\b|\\bkbl\\b|\\bfiba\\b|\\beurobasket\\b|\\baba\\b|adriatic|\\bpro a\\b|\\blnb\\b|basketbol super|\\bvtb\\b|\\bnbb\\b|\\bcebl\\b|greek basket|\\bbnxt\\b/i`;

t = t.replace(/const FOOTBALL_LEAGUES =\s*\/[^/\n]+\/[gimuy]*/i, NEW_FOOTBALL);
t = t.replace(/const BASKETBALL_LEAGUES =\s*\/[^/\n]+\/[gimuy]*/i, NEW_BASKET);
console.log("strict FOOTBALL/BASKETBALL leagues set");

const WEAK_AND_STRONG = `
const WEAK_BASKETBALL_LEAGUE =
  /3x3|tbt\\b|development|reserve|u-?1[89]|u-?2[01]|youth|cadet|junior|amateur|friendly|liga nacional|lnbp|libobasquet|paraguayan|venezuelan|cuban|nicaragu|hondur|kosovo|albanian|mongolian|n1 league|b2 league|division 2|div 2|regional|student/i;
const WEAK_FOOTBALL_LEAGUE =
  /reserve|u-?1[789]|u-?2[01]|youth|cadet|junior|amateur|friendly|primavera|regional|division 3|third division|fourth division|serie [cd]\\b|serie d|national league|conference north|conference south|non.?league|county league|liga [34]\\b|u19|u20|u21|u23|reserva|filial|b team|2nd team|academy|primera [bcd]\\b|metropolitana|torneo federal|argentina.?[bcd]|liga regional|segund[ao]|tercer[ao]|cearense|paulista|carioca|mineiro|gaucho|goiano|paranaense|baiano|pernambucano|serie c|serie d|liga 2|liga 3|primera federacion|segunda federacion|tercera|national 2|national 3|vanarama|italian serie c|serie c group|liga expansion|categoria primera b|primera nacional|federal a|sudan|zambian|ghana premier|botola|mozambican/i;
function isWeakLeague(name: string) {
  const n = name || "";
  return WEAK_BASKETBALL_LEAGUE.test(n) || WEAK_FOOTBALL_LEAGUE.test(n);
}
function isStrongLeague(sport: BookSport, name: string) {
  const n = name || "";
  if (!n.trim()) return false;
  if (isWeakLeague(n) || /simulat|virtual|esoccer|e-?soccer/i.test(n)) return false;
  if (sport === "basketball") return BASKETBALL_LEAGUES.test(n);
  if (sport === "tennis") return TENNIS_LEAGUES.test(n);
  if (sport === "handball") return HANDBALL_LEAGUES.test(n);
  return FOOTBALL_LEAGUES.test(n);
}
`;

if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?function isStrongLeague[\s\S]*?\n\}/.test(t)) {
  t = t.replace(/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?function isStrongLeague[\s\S]*?\n\}/, WEAK_AND_STRONG.trim());
} else if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;/.test(t)) {
  t = t.replace(/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;\n(?:const WEAK_FOOTBALL_LEAGUE =[\s\S]*?;\n)?(?:function isWeakLeague[\s\S]*?\n\})?(?:\nfunction isStrongLeague[\s\S]*?\n\})?/, WEAK_AND_STRONG.trim() + "\n");
} else if (t.includes("const SIMULATED_LEAGUE")) {
  t = t.replace("const SIMULATED_LEAGUE", WEAK_AND_STRONG + "\nconst SIMULATED_LEAGUE");
}

if (!t.includes("function isStrongLeague")) {
  console.warn("isStrongLeague missing after inject");
}

if (!t.includes("isStrongLeague(sport, e.leagueHint")) {
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&\n(\s*)(!isWeakLeague\(e\.leagueHint \?\? ""\) &&\n\s*)?/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n$1isStrongLeague(sport, e.leagueHint ?? "") &&\n$1',
  );
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&\n(\s*)inCookWindow/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n$1isStrongLeague(sport, e.leagueHint ?? "") &&\n$1inCookWindow',
  );
}
if (!t.includes("isStrongLeague(sport, leagueName(ev.sport))")) {
  t = t.replace(
    /if \(SIMULATED_LEAGUE\.test\(leagueName\(ev\.sport\)\)\) continue;(\n\s*if \(!?isWeakLeague\(leagueName\(ev\.sport\)\)\) continue;)?(\n\s*if \(!isStrongLeague\(sport, leagueName\(ev\.sport\)\)\) continue;)?/,
    'if (SIMULATED_LEAGUE.test(leagueName(ev.sport))) continue;\n      if (!isStrongLeague(sport, leagueName(ev.sport))) continue;',
  );
}

const NEW_COOKABLE = `export function cookablePick(p: TicketPick) {
  // QUALITY_COOK_V3
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
  const label = \`\${p.market ?? ""} \${p.selection ?? ""}\`.toLowerCase();
  if (/1st half|1h|first half/.test(label) && /over\\s*(0\\.5|1(\\.0)?|1\\.5)\\b/.test(label)) return false;
  if (/2nd half|2h|second half/.test(label) && /over\\s*(0\\.5|1(\\.0)?)\\b/.test(label)) return false;
  return true;
}`;

if (/export function cookablePick\(p: TicketPick\) \{[\s\S]*?\n\}/.test(t)) {
  t = t.replace(/export function cookablePick\(p: TicketPick\) \{[\s\S]*?\n\}/, NEW_COOKABLE);
  console.log("cookablePick hardened");
}

const NEW_PICK = `function pickFromEvent(cands: TicketPick[], used: Record<string, number>): TicketPick | null {
  // QUALITY_COOK_V3 — DC / GG / FT O/U first; never soft 1H
  const pool0 = cands.filter(cookablePick);
  if (!pool0.length) return null;
  const totalUsed = Object.values(used).reduce((n, v) => n + v, 0);
  const families = [...new Set(pool0.map((p) => marketFamily(p.sporty?.marketId, p.market)))];
  const hasOu = families.includes("ou");
  const hasDc = families.includes("dc");
  const hasGg = families.includes("gg");
  const hasDnb = families.includes("dnb");
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
  if (hasDc && dcShare < 0.22) family = "dc";
  else if (hasGg && ggShare < 0.18) family = "gg";
  else if (hasOu && ouShare < 0.32) family = "ou";
  else if (hasDnb && (used.dnb ?? 0) < 2) family = "dnb";
  const pool = family
    ? pool0.filter((p) => marketFamily(p.sporty?.marketId, p.market) === family)
    : pool0;
  const score = (p: TicketPick) => {
    const fam = marketFamily(p.sporty?.marketId, p.market);
    const odds = Number(p.odds) || 9;
    let s = implied(p.odds);
    if (fam === "dc") s += 0.16;
    if (fam === "gg") s += 0.12;
    if (fam === "ou") s += 0.14;
    if (fam === "dnb") s += 0.1;
    if (fam === "ou1h") s -= 0.3;
    if (odds >= 1.28 && odds <= 1.7) s += 0.1;
    if (odds > 2.05) s -= 0.12;
    if (p.sporty?.marketId === "225" || p.sporty?.marketId === "18") s += 0.08;
    return s;
  };
  const pick = pool.slice().sort((a, b) => score(b) - score(a))[0];
  if (pick && family) used[family] = (used[family] ?? 0) + 1;
  return pick ?? null;
}`;

if (/function pickFromEvent\(cands: TicketPick\[\], used: Record<string, number>\): TicketPick \| null \{[\s\S]*?\n\}/.test(t)) {
  t = t.replace(/function pickFromEvent\(cands: TicketPick\[\], used: Record<string, number>\): TicketPick \| null \{[\s\S]*?\n\}/, NEW_PICK);
  console.log("pickFromEvent V3 applied");
}

if (!t.includes("QUALITY_COOK_V3")) {
  t = "// QUALITY_COOK_V3\n" + t;
}

writeFileSync(path, t);
console.log("quality V3 done", {
  strong: t.includes("isStrongLeague"),
  v3: t.includes("QUALITY_COOK_V3"),
  cookable: t.includes("QUALITY_COOK_V3"),
});
