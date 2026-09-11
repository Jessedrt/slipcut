#!/usr/bin/env node
/**
 * QUALITY_COOK_V4 — ultra-strict SportyBet tournament names + block soft 1H
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
if (!existsSync(path)) {
  console.warn("sportybet.ts missing");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("QUALITY_COOK_V4")) {
  console.log("V4 already present");
  process.exit(0);
}
t = t.replace(/\/\/ QUALITY_COOK_V[123]\n?/g, "");

const NEW_FOOTBALL =
  "const FOOTBALL_LEAGUES =\n" +
  "  /(?:^|\\b)(Premier League|LaLiga|La Liga|Serie A|Bundesliga|Ligue 1|UEFA Champions League|UEFA Europa League|UEFA Conference League|UEFA Nations League|Eredivisie|Liga Portugal|Championship|MLS|Copa Libertadores|Belgian Pro League|Jupiler Pro League|Saudi Pro League|NPFL|Super Lig|Scottish Premiership|Liga MX|Brasileiro Serie A|Allsvenskan|Eliteserien|Egyptian Premier|CAF Champions|AFC Champions)(?:\\b|$)/i";

const NEW_BASKET =
  "const BASKETBALL_LEAGUES =\n" +
  "  /(?:^|\\b)(NBA|Euroleague|EuroLeague|Eurocup|NCAA|WNBA|ACB|Liga Endesa|BBL|CBA|KBL|FIBA|EuroBasket|ABA League|Pro A|LNB|VTB|NBB|CEBL|BNXT)(?:\\b|$)/i";

t = t.replace(/const FOOTBALL_LEAGUES =\s*\/[^/\n]+\/[gimuy]*/i, NEW_FOOTBALL);
t = t.replace(/const BASKETBALL_LEAGUES =\s*\/[^/\n]+\/[gimuy]*/i, NEW_BASKET);
console.log("V4 leagues set");

const HELPERS = `
const WEAK_BASKETBALL_LEAGUE =
  /3x3|tbt\\b|development|reserve|u-?1[89]|u-?2[01]|youth|cadet|junior|amateur|friendly|next pro|g league|liga nacional|division 2|regional|student/i;
const WEAK_FOOTBALL_LEAGUE =
  /next pro|northern premier|southern league|isthmian|vanarama|national league|serie [bcd]\\b|2\\.?\\s*bundesliga|3\\.\\s*liga|laliga hypermotion|liga portugal [23]|u-?1[789]|u-?2[01]|youth|reserve|amateur|friendly|primera [bcdcn]|metropolitana|federal|cearense|paulista|carioca|mineiro|gaucho|serie c group|primera federacion|segunda federacion|liga 2|liga 3|league one|league two|usl |cymru|division 2|primera lpf|primera nacional|categoria primera b|sudan|zambian|botola|liga dimayor|premier division|ekstraklasa|veikkausliiga|kakkonen|ettan|tweede|vtora|parva liga|china league|\\bsrl\\b|simulation/i;
function isWeakLeague(name: string) {
  const n = (name || "").trim();
  if (!n) return true;
  return WEAK_BASKETBALL_LEAGUE.test(n) || WEAK_FOOTBALL_LEAGUE.test(n);
}
function isStrongLeague(sport: BookSport, name: string) {
  const n = (name || "").trim();
  if (!n || isWeakLeague(n) || /simulat|virtual|esoccer|e-?soccer|\\bsrl\\b/i.test(n)) return false;
  if (/next pro|northern premier|hypermotion|liga portugal [23]|2\\.?\\s*bundesliga|serie [bcd]|league one|league two|national league|usl |cymru|carioca|paulista|u20|u19/i.test(n)) return false;
  if (sport === "basketball") return BASKETBALL_LEAGUES.test(n);
  if (sport === "tennis") return TENNIS_LEAGUES.test(n);
  if (sport === "handball") return HANDBALL_LEAGUES.test(n);
  return FOOTBALL_LEAGUES.test(n);
}
`;

if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?function isStrongLeague[\s\S]*?\n\}/.test(t)) {
  t = t.replace(/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?function isStrongLeague[\s\S]*?\n\}/, HELPERS.trim());
} else if (/const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;/.test(t)) {
  t = t.replace(
    /const WEAK_BASKETBALL_LEAGUE =[\s\S]*?;\n(?:const WEAK_FOOTBALL_LEAGUE =[\s\S]*?;\n)?(?:function isWeakLeague[\s\S]*?\n\})?(?:\nfunction isStrongLeague[\s\S]*?\n\})?/,
    HELPERS.trim() + "\n",
  );
} else if (t.includes("const SIMULATED_LEAGUE")) {
  t = t.replace("const SIMULATED_LEAGUE", HELPERS + "\nconst SIMULATED_LEAGUE");
}

if (!t.includes("isStrongLeague(sport, e.leagueHint")) {
  t = t.replace(
    /!SIMULATED_LEAGUE\.test\(e\.leagueHint \?\? ""\) &&\n(\s*)/,
    '!SIMULATED_LEAGUE.test(e.leagueHint ?? "") &&\n$1isStrongLeague(sport, e.leagueHint ?? "") &&\n$1',
  );
}
t = t.replace(
  /isStrongLeague\(sport, e\.leagueHint \?\? ""\) &&\n(\s*)isStrongLeague\(sport, e\.leagueHint \?\? ""\) &&\n/g,
  'isStrongLeague(sport, e.leagueHint ?? "") &&\n$1',
);

if (!t.includes("isStrongLeague(sport, leagueName(ev.sport))")) {
  t = t.replace(
    /if \(SIMULATED_LEAGUE\.test\(leagueName\(ev\.sport\)\)\) continue;(\n\s*if \(!?is(?:Weak|Strong)League[\s\S]*?continue;)*/,
    "if (SIMULATED_LEAGUE.test(leagueName(ev.sport))) continue;\n      if (!isStrongLeague(sport, leagueName(ev.sport))) continue;",
  );
}

const cookableSrc = `export function cookablePick(p: TicketPick) {
  // QUALITY_COOK_V4
  if (!p.sporty?.eventId || !p.sporty?.marketId) return false;
  if (p.sport === "other") return false;
  const league = (p as { league?: string }).league ?? "";
  if (league && !isStrongLeague(p.sport as BookSport, league)) return false;
  const label = \`\${p.market ?? ""} \${p.selection ?? ""}\`.toLowerCase();
  if (/1st half|1h|first half/.test(label) && /over\\s*(0\\.5|1(\\.0)?|1\\.5)\\b/.test(label)) return false;
  if (/2nd half|2h|second half/.test(label) && /over\\s*(0\\.5|1(\\.0)?)\\b/.test(label)) return false;
  return true;
}`;

if (/export function cookablePick\(p: TicketPick\) \{[\s\S]*?\n\}/.test(t)) {
  t = t.replace(/export function cookablePick\(p: TicketPick\) \{[\s\S]*?\n\}/, cookableSrc);
  console.log("cookablePick V4");
}

const pickSrc = `function pickFromEvent(cands: TicketPick[], used: Record<string, number>): TicketPick | null {
  // QUALITY_COOK_V4
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
      Number(a === "ou1h") - Number(b === "ou1h") ||
      Number(a === "hcp") - Number(b === "hcp"),
  );
  let family = families[0];
  if (hasDc && dcShare < 0.25) family = "dc";
  else if (hasGg && ggShare < 0.2) family = "gg";
  else if (hasOu && ouShare < 0.35) family = "ou";
  else if (hasDnb && (used.dnb ?? 0) < 2) family = "dnb";
  const pool = family
    ? pool0.filter((p) => marketFamily(p.sporty?.marketId, p.market) === family)
    : pool0;
  const score = (p: TicketPick) => {
    const fam = marketFamily(p.sporty?.marketId, p.market);
    const odds = Number(p.odds) || 9;
    let s = implied(p.odds);
    if (fam === "dc") s += 0.18;
    if (fam === "gg") s += 0.14;
    if (fam === "ou") s += 0.16;
    if (fam === "dnb") s += 0.1;
    if (fam === "ou1h") s -= 0.35;
    if (odds >= 1.28 && odds <= 1.72) s += 0.1;
    if (odds > 2.0) s -= 0.12;
    return s;
  };
  const pick = pool.slice().sort((a, b) => score(b) - score(a))[0];
  if (pick && family) used[family] = (used[family] ?? 0) + 1;
  return pick ?? null;
}`;

if (/function pickFromEvent\(cands: TicketPick\[\], used: Record<string, number>\): TicketPick \| null \{[\s\S]*?\n\}/.test(t)) {
  t = t.replace(
    /function pickFromEvent\(cands: TicketPick\[\], used: Record<string, number>\): TicketPick \| null \{[\s\S]*?\n\}/,
    pickSrc,
  );
  console.log("pickFromEvent V4");
}

if (!t.includes("QUALITY_COOK_V4")) t = "// QUALITY_COOK_V4\n" + t;
writeFileSync(path, t);
console.log("V4 done", {
  v4: t.includes("QUALITY_COOK_V4"),
  strong: t.includes("isStrongLeague"),
});
