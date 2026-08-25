import type { SportKind, TicketPick } from "./types";

const VS = /\s+(?:vs\.?|v\.?|[-–—])\s+/i;

const FOOTBALL_HINT =
  /\b(football|soccer|epl|premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa|afcon|npfl|eredivisie|liga mx|mls|world cup|ucl|uel)\b/i;
const BASKETBALL_HINT =
  /\b(basketball|nba|wnba|ncaa|euroleague|fiba|nbl|cba|acb|bbl)\b/i;
const OTHER_HINT =
  /\b(table tennis|volleyball|ice hockey|virtual|esport|cricket|rugby|handball|snooker|darts|mma|ufc|boxing|baseball|nfl|nhl)\b/i;

function guessSport(blob: string): SportKind {
  if (/\btennis\b/i.test(blob)) return "tennis";
  if (BASKETBALL_HINT.test(blob)) return "basketball";
  if (OTHER_HINT.test(blob) && !FOOTBALL_HINT.test(blob)) return "other";
  if (FOOTBALL_HINT.test(blob)) return "football";
  return "football";
}

function clean(s: string) {
  return s.replace(/\s+/g, " ").replace(/^[\d.)\-\s]+/, "").trim();
}

function parseOdds(chunk: string): number | undefined {
  const m = chunk.match(/@\s*(\d+(?:\.\d+)?)|\bodd(?:s)?\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i);
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : undefined;
}

function splitSelection(rest: string): { market: string; selection: string } {
  const raw = rest.replace(/@\s*\d+(?:\.\d+)?/g, "").trim();
  const lower = raw.toLowerCase();

  const over = raw.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/i);
  if (over) {
    return { market: `Total ${over[1]} ${over[2]}`, selection: `${over[1]} ${over[2]}` };
  }
  if (/\b(gg|btts|both teams? to score)\b/i.test(raw)) {
    const yes = !/\b(ng|no|against)\b/i.test(lower);
    return { market: "Both teams to score", selection: yes ? "Yes" : "No" };
  }
  if (/\bdraw no bet\b|\bdnb\b/i.test(raw)) {
    return { market: "Draw no bet", selection: raw };
  }
  if (/\bdouble chance\b|\bdc\b|\b1x\b|\bx2\b|\b12\b/i.test(raw)) {
    return { market: "Double chance", selection: raw };
  }
  if (/\b(ml|moneyline|winner|to win)\b/i.test(raw)) {
    return { market: "Winner", selection: raw };
  }
  if (/\b1x2\b|\bhome\b|\baway\b|\bdraw\b|\b1\b|\bx\b|\b2\b/i.test(raw) || raw.length < 40) {
    return { market: "1X2 / Winner", selection: raw || "Unspecified" };
  }
  return { market: "Selection", selection: raw || "Unspecified" };
}

export function extractShareCode(raw: string): string | null {
  const url = raw.match(/shareCode=([A-Za-z0-9]{4,16})/i);
  if (url) return url[1].toUpperCase();
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9]{4,16}$/.test(trimmed)) return trimmed.toUpperCase();
  const labeled = trimmed.match(/\b(?:code|booking)\s*[:=]?\s*([A-Za-z0-9]{4,16})\b/i);
  if (labeled) return labeled[1].toUpperCase();
  return null;
}

export function parseTicketText(raw: string): TicketPick[] {
  const text = raw.replace(/\r/g, "").trim();
  if (!text) return [];

  const blocks = text
    .split(/\n{2,}|^\s*\d+[.)]\s+/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const picks: TicketPick[] = [];
  let idx = 0;

  const pushFromLines = (lines: string[], sportHint: string) => {
    const joined = lines.join(" ");
    const vsLine = lines.find((l) => VS.test(l)) ?? (VS.test(joined) ? joined : "");
    if (!vsLine) return;
    const parts = vsLine.split(VS);
    if (parts.length < 2) return;
    const home = clean(parts[0].replace(/@\s*\d+(?:\.\d+)?/g, ""));
    const awayPart = parts.slice(1).join(" vs ");
    const away = clean(awayPart.split(/[@\n]/)[0] ?? "");
    if (!home || !away || home.length > 60 || away.length > 60) return;

    const restLines = lines.filter((l) => l !== vsLine).join(" ");
    const rest = (restLines || awayPart.replace(away, "")).trim();
    const { market, selection } = splitSelection(rest || "Home");
    const leagueLine = lines.find(
      (l) =>
        !VS.test(l) &&
        /league|cup|nba|wnba|serie|liga|division|premier|championship/i.test(l),
    );

    picks.push({
      id: `p${idx++}`,
      sport: guessSport(`${sportHint} ${joined} ${leagueLine ?? ""}`),
      league: leagueLine ? clean(leagueLine) : "",
      home,
      away,
      market,
      selection: clean(selection),
      odds: parseOdds(joined),
    });
  };

  if (blocks.length <= 1) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const grouped: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (VS.test(line) && current.length) {
        grouped.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) grouped.push(current);
    for (const g of grouped) pushFromLines(g, text);
  } else {
    for (const block of blocks) {
      pushFromLines(block.split("\n").map((l) => l.trim()).filter(Boolean), block);
    }
  }

  const seen = new Set<string>();
  return picks.filter((p) => {
    const key = `${p.home}|${p.away}|${p.selection}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatCleanSlip(picks: TicketPick[]) {
  return picks
    .map((p, i) => {
      const match = `${p.home} vs ${p.away}`;
      const league = p.league ? ` · ${p.league}` : "";
      return `${i + 1}. ${match}${league}\n   ${p.market} — ${p.selection}`;
    })
    .join("\n");
}
