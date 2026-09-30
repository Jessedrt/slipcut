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
};
export function providerTeamName(value: string, sport: string): string {
  const name = normalizeName(value);
  return sport === "basketball" ? BASKETBALL_ALIASES[name] ?? name : name;
}
export function providerCountryName(value: string): string {
  const name = normalizeName(value);
  return name === "czech republic" ? "czechia" : name;
}
