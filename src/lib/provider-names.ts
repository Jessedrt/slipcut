import { normalizeName } from "./bookmakers/normalize";

// Verified native SportyBet/FlashScore basketball aliases. No fuzzy matching:
// fixture matching still requires both teams, competition and kickoff.
const BASKETBALL_ALIASES: Record<string, string> = {
  "bk decin": "decin",
  "basket brno": "brno",
  "bk nova hut ostrava": "nh ostrava",
  "bk gapa hradec kralove": "hradec kralove",
  "sk slavia prague": "slavia prague era nbk",
  "bk olomoucko": "olomoucko",
  "cb san pablo burgos": "san pablo burgos",
  "kk cedevita olimpija ljubljana": "cedevita olimpija",
  "panathinaikos bc": "panathinaikos",
  "asvel lyon villeurbanne": "lyon villeurbanne",
  "napoli basket": "basket napoli",
  "jl bourg basket": "jl bourg",
  "cb 1939 canarias": "tenerife",
  "universitatea cluj": "cluj napoca",
  "besiktas jk": "besiktas",
  "cs dinamo bucuresti": "dinamo bucharest",
  "kb peja": "peja",
  // Verified from production mapping diagnostics on 2026-09-30.
  "sluneta usti nad labem": "usti n labem",
  "bk opava": "opava",
  "sokol pisek": "srsni pisek",
  "bk pardubice": "pardubice",
  "paok bc": "paok",
  "basquet manresa": "manresa",
  "bc lietkabelis panevezys": "lietkabelis",
  "kk bosna royal sarajevo": "kk bosna",
  "ratiopharm ulm": "ulm",
  "balkan botevgrad": "balkan",
  "derthona basket": "tortona",
  "bahcesehir koleji": "bahcesehir kol",
  "bc roma spqr": "bc roma",
  "sydney kings": "sydney",
};
export function providerTeamName(value: string, sport: string): string {
  const name = normalizeName(value);
  return sport === "basketball" ? BASKETBALL_ALIASES[name] ?? name : name;
}
export function providerCountryName(value: string): string {
  const name = normalizeName(value);
  return name === "czech republic" ? "czechia" : name;
}
