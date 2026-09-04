import { cap, doc, head, RULE, stats, table, tail } from "./tg-format.ts";

/**
 * Market-family accuracy engine (greenpicks-style stats).
 *
 * The desk records every leg it mints in `desk_predictions` (with the market
 * family, sport and the price) and the settlement loop (`studyCode` →
 * `settlePredictions`) marks each row won/lost when the match finishes. This
 * module aggregates that settled history per (family, sport) and answers the
 * one question that gates the cook:
 *
 *   a family may enter the cook pool only if
 *     hit_rate >= max(engine_average, QUALIFYING_BAR)
 *   once it has MIN_SAMPLE settled legs; until a family has that sample the
 *   desk falls back to the conservative default allow-list (DC + O/U only).
 *
 * Plain winner (1/2) and handicap are never allowed, whatever their history —
 * they are how the weak long-shot slips used to be built.
 */

/** A family must hit at least this often (once it has enough history). */
export const QUALIFYING_BAR = 0.75;
/** Settled legs a family needs before its hit rate is trusted. */
export const MIN_SAMPLE = 30;
/** Default allow-list while a family is still under MIN_SAMPLE. */
export const DEFAULT_ALLOW = new Set(["dc", "ou", "ou1h"]);
/** Families that never enter the cook pool, history or not. */
export const NEVER_ALLOW = new Set(["win", "hcp"]);
/** Ladder card targets for the default cook. */
export const LADDER_TARGETS = [20, 50, 100, 500, 1000];
/** The short-odds band the default cards are built from. */
export const SHORT_ODDS = { min: 1.2, max: 1.65 } as const;

export type MarketStat = {
  family: string;
  sport: string;
  settled: number;
  wins: number;
  losses: number;
  /** 0-1 */
  hitRate: number;
  /** Average price of the legs that WON — the money the family actually pays. */
  avgWinOdds: number | null;
};

export type GateStatus = "pass" | "bootstrap" | "locked-sample" | "below-bar" | "never";

export type GateResult = {
  allowed: boolean;
  status: GateStatus;
  /** Hit rate once settled (null when the family has no settled legs). */
  hitRate: number | null;
  settled: number;
  /** The bar the family must clear: max(engine average, QUALIFYING_BAR). */
  bar: number;
};

/**
 * The engine's own hit rate across every settled leg. This is the
 * "engine_average" of the qualifying rule — a family must beat the desk's
 * overall performance, not just the static 75%.
 */
export function engineAverage(stats: MarketStat[]): number {
  const settled = stats.reduce((s, r) => s + r.settled, 0);
  const wins = stats.reduce((s, r) => s + r.wins, 0);
  return settled ? wins / settled : 0;
}

/**
 * Settled per-(family, sport) history from the prediction table.
 * Never throws — a sick database means "no history yet", and the cook then
 * runs on the bootstrap allow-list instead of dying.
 */
export async function loadMarketStats(): Promise<MarketStat[]> {
  try {
    // Imported on demand: the db module boots the embedded PGLite in Node the
    // moment it loads, which plain unit tests (and the web bundle) must not
    // pay for just to ask for the gate rules.
    const { getSql } = await import("./db.ts");
    const sql = await getSql();
    const rows = await sql<{
      family: string;
      sport: string;
      settled: number;
      wins: number;
      losses: number;
      avg_win_odds: number | null;
    }>`
      select
        family,
        sport,
        count(*)::int as settled,
        count(*) filter (where result = 'won')::int as wins,
        count(*) filter (where result = 'lost')::int as losses,
        avg(odds) filter (where result = 'won') as avg_win_odds
      from desk_predictions
      where result in ('won', 'lost')
        and family <> ''
        and odds is not null
      group by family, sport
      order by settled desc
    `;
    return rows.map((r) => {
      const settled = Number(r.settled) || 0;
      const wins = Number(r.wins) || 0;
      return {
        family: r.family,
        sport: r.sport,
        settled,
        wins,
        losses: Number(r.losses) || 0,
        hitRate: settled ? wins / settled : 0,
        avgWinOdds: r.avg_win_odds == null ? null : Number(r.avg_win_odds),
      };
    });
  } catch {
    return [];
  }
}

/**
 * The qualifying rule, applied to one (family, sport).
 *
 *   hit_rate >= max(engine_average, QUALIFYING_BAR)  with >= MIN_SAMPLE legs
 *
 * Under MIN_SAMPLE the family is still "locked": only the default allow-list
 * (DC + O/U) is usable, so a brand-new desk cooks safe short markets instead
 * of guessing.
 */
export function familyGate(
  stats: MarketStat[],
  family: string,
  sport: string,
): GateResult {
  const bar = Math.max(engineAverage(stats), QUALIFYING_BAR);
  const row = stats.find((s) => s.family === family && s.sport === sport);
  const settled = row?.settled ?? 0;
  const hitRate = row ? row.hitRate : null;

  // Handicap is off the desk everywhere; plain 1/2 (home/away win) is off for
  // football and basketball. Tennis keeps its winner market — "1/2" in the
  // exclusions means the football 1X2, not a tennis match winner.
  if (family === "hcp" || (family === "win" && sport !== "tennis")) {
    return { allowed: false, status: "never", hitRate, settled, bar };
  }
  if (settled < MIN_SAMPLE) {
    const allowed = DEFAULT_ALLOW.has(family);
    return {
      allowed,
      status: allowed ? "bootstrap" : "locked-sample",
      hitRate,
      settled,
      bar,
    };
  }
  const allowed = (hitRate ?? 0) >= bar;
  return { allowed, status: allowed ? "pass" : "below-bar", hitRate, settled, bar };
}

/**
 * Per-leg probability for honest card maths: the family's own hit rate when
 * it has history, otherwise the book's implied probability (which keeps EV
 * honest — margin included, never a fake +60%).
 */
export function legProbability(
  stats: MarketStat[],
  family: string,
  sport: string,
  odds?: number | null,
): number | null {
  const row = stats.find((s) => s.family === family && s.sport === sport);
  if (row && row.settled >= 10) return row.hitRate;
  if (odds && odds > 1) return Math.min(0.97, Math.max(0.02, 1 / odds));
  return null;
}

/**
 * The /accuracy card: engine hit rate, the bar, and every family's settled
 * record with its status. The greenpicks stats card, in Pidgin.
 */
export function formatMarketStats(rows: MarketStat[]): string {
  const settled = rows.reduce((s, r) => s + r.settled, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const avg = settled ? wins / settled : 0;
  const bar = Math.max(avg, QUALIFYING_BAR);

  if (!settled) {
    return cap(
      doc(
        head("accuracy", "market bar"),
        `No settled legs yet — the desk dey run the bootstrap list: DC + O/U only.`,
        RULE,
        stats([
          ["engine", "—"],
          ["bar", `${Math.round(QUALIFYING_BAR * 100)}%`],
          ["sample", `${settled}/${MIN_SAMPLE}`],
        ]),
        tail("study the slips after the games; the bar unlocks by itself."),
      ),
    );
  }

  const famLabel: Record<string, string> = {
    dc: "double chance",
    ou: "over/under",
    ou1h: "1st half O/U",
    gg: "GG",
    dnb: "DNB",
    win: "1X2 / winner",
    hcp: "handicap",
    teamou: "team O/U",
  };
  const top = [...rows]
    .sort((a, b) => b.settled - a.settled)
    .slice(0, 12);
  const body = table(
    ["market", "hit", "legs", "win odds", "status"],
    top.map((r) => {
      const gate = familyGate(rows, r.family, r.sport);
      const status =
        gate.status === "pass"
          ? "PASS"
          : gate.status === "bootstrap"
            ? "OPEN"
            : gate.status === "locked-sample"
              ? `lock ${r.settled}/${MIN_SAMPLE}`
              : gate.status === "below-bar"
                ? "FAIL"
                : "off";
      return [
        `${famLabel[r.family] ?? r.family} ${r.sport === "football" ? "" : r.sport}`,
        `${Math.round(r.hitRate * 100)}%`,
        `${r.wins}-${r.losses}`,
        r.avgWinOdds ? r.avgWinOdds.toFixed(2) : "—",
        status,
      ];
    }),
  );

  return cap(
    doc(
      head("accuracy", `${settled} settled legs`),
      stats([
        ["engine", `${Math.round(avg * 100)}%`],
        ["bar", `${Math.round(bar * 100)}%`],
        ["sample", `${settled}/${MIN_SAMPLE} per market`],
      ]),
      RULE,
      body,
      tail(
        `PASS = hits above ${Math.round(bar * 100)}% with ${MIN_SAMPLE}+ legs · OPEN = bootstrap list (DC/O/U) · lock = sample dey grow · FAIL = below the bar, no fit cook`,
      ),
    ),
  );
}
