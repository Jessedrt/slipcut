import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSlip,
  validateBuildRequest,
  type BuildDependencies,
  type BuildSlipRequest,
} from "./build-slip";
import { canonicalMarket, automaticMarketAllowed, riskOddsAllowed, SELECTION_POLICIES } from "./selection-policy";
import { assessEvidence, beforeResearchDeadline, summarize, type Evidence, type HistoryRow } from "./selection-evidence";
import { mintReviewedSlip } from "./book-slip";
import { clearSportyCacheForTests, listUpcomingPicks } from "./sportybet";
import type { TicketPick } from "./types";
const base: BuildSlipRequest = {
  sport: "football",
  risk: "balanced",
  mode: "games",
  games: 5,
  window: "upcoming",
};
function pick(id: string, odds = 1.6, overrides: Partial<TicketPick> = {}): TicketPick {
  return {
    id,
    sport: "football",
    league: "England Premier League",
    home: `Home ${id}`,
    away: `Away ${id}`,
    market: "Over/Under 2.5",
    selection: "Over 2.5",
    odds,
    kickoff: Date.now() + 86400_000,
    sporty: { eventId: id, marketId: "18", outcomeId: "over", specifier: "total=2.5" },
    ...overrides,
  };
}
function history(p: TicketPick, n = 10, values?: number[]): Evidence {
  const c = canonicalMarket(p),
    line = c.line ?? 2.5;
  const rows: HistoryRow[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(Date.now() - (i + 1) * 86400_000).toISOString();
    const team = c.family === "team_total";
    const v = values?.[i] ?? Math.ceil(line) + 5;
    rows.push({
      id: `h${i}`,
      date,
      home: p.home,
      away: `Other H ${i}`,
      homeValue: team ? v : Math.ceil(v / 2),
      awayValue: team ? v : Math.floor(v / 2),
      source: "https://www.espn.com/result",
      period: c.period,
      metric: "score",
      corroborated: true,
    });
    rows.push({
      id: `a${i}`,
      date,
      home: `Other A ${i}`,
      away: p.away,
      homeValue: team ? v : Math.ceil(v / 2),
      awayValue: team ? v : Math.floor(v / 2),
      source: "https://www.espn.com/result",
      period: c.period,
      metric: "score",
      corroborated: true,
    });
  }
  return { rows, checkedAt: Date.now() };
}
function deps(rows: TicketPick[], override: Partial<BuildDependencies> = {}): BuildDependencies {
  return {
    discover: async () => rows,
    refresh: async (ps) => ({ available: ps, unavailable: [] }),
    record: async () => ({ available: false, rows: [] }),
    evidence: async (ps) => new Map(ps.map((p) => [p.id, history(p)])),
    ...override,
  };
}

describe("risk boundaries through backend build", () => {
  for (const [risk, cases] of Object.entries({
    conservative: [
      [1.19, false],
      [1.2, true],
      [1.3, true],
      [1.4, true],
      [1.41, false],
      [1.65, false],
    ],
    balanced: [
      [1.28, false],
      [1.39, false],
      [1.4, true],
      [1.6, true],
      [1.8, true],
      [1.81, false],
    ],
  }) as Array<["conservative" | "balanced", Array<[number, boolean]>]>) {
    for (const [odds, accept] of cases)
      it(`${risk} ${odds}: ${accept ? "accept" : "reject"}`, async () => {
        const p = pick("a", odds);
        const result = await buildSlip({ ...base, risk }, deps([p]));
        assert.equal(riskOddsAllowed(odds, risk), accept);
        assert.equal(result.ok, accept);
        if (result.ok) assert.equal(result.selections[0]!.odds, odds);
      });
  }
  it("rejects basketball team totals without both offense and opponent-defense samples", async () => {
    const p = { ...pick("team-total", 1.4), market: "Home Team Total Over 70.5", line: 70.5 };
    const oneSided = history(p, 3);
    oneSided.rows = oneSided.rows.filter((row) => row.home === p.home || row.away === p.home);
    const r = await buildSlip(
      { ...base, risk: "conservative" },
      deps([p], { evidence: async () => new Map([[p.id, oneSided]]) }),
    );
    assert.equal(r.ok, false);
  });

  it("does not enforce fixed 10/8 history-count gates", async () => {
    const p = pick("a", 1.4);
    const d = deps([p], { evidence: async () => new Map([[p.id, history(p, 3)]]) });
    assert.equal((await buildSlip({ ...base, risk: "conservative" }, d)).ok, true);
    assert.equal((await buildSlip(base, d)).ok, true);
  });
  it("missing history is not expressed as a fixture-coverage gate", async () => {
    const p = pick("missing", 1.3);
    const r = await buildSlip({ ...base, risk: "conservative" }, deps([p], { evidence: async () => new Map() }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "no_eligible_markets");
      assert.doesNotMatch(r.error, /matched \d+ of \d+ fixtures|coverage/i);
    }
  });
  it("Balanced accepts supported moderate variance rejected by Conservative", () => {
    const p = pick("a", 1.4, { sport: "basketball" });
    const e = history(p, 10, [6, 6, 6, 6, 6, 6, 6, 6, 12, 12]);
    assert.equal(assessEvidence(p, e, "conservative"), null);
    assert.ok(assessEvidence(p, e, "balanced"));
  });
});
describe("canonical market eligibility", () => {
  for (const alias of [
    "Under 2.5",
    "U2.5",
    "1",
    "2",
    "Home Win",
    "Away Win",
    "Home DNB",
    "Away DNB",
    "1X",
    "X2",
    "Home or Draw",
    "Draw or Away",
    "Draw No Bet Home",
    "Draw No Bet Away",
  ])
    it(`blocks football alias ${alias}`, () =>
      assert.equal(
        automaticMarketAllowed(pick("a", 1.5, { market: "Provider alias", selection: alias })),
        false,
      ));
  it("keeps legitimate single markets discoverable", () => {
    for (const [market, selection] of [
      ["Both Teams To Score", "Yes"],
      ["Corners Over/Under 9.5", "Over 9.5"],
      ["Total Cards 3.5", "Over 3.5"],
      ["Correct Score", "1:0"],
      ["Double Chance", "Home or Away"],
    ])
      assert.ok(
        automaticMarketAllowed(
          pick("a", 1.5, {
            market,
            selection,
            sporty: { eventId: "a", marketId: "999", outcomeId: "o" },
          }),
        ),
      );
  });
  it("normalizes equivalent first half aliases and never parses 1H as the line", () => {
    const cs = ["1st Half Total Goals Over 0.5", "First Half Goals O0.5", "1H Over 0.5"].map((m) =>
      canonicalMarket(
        pick("a", 1.5, {
          market: m,
          selection: "Over 0.5",
          sporty: { eventId: "a", marketId: "999", outcomeId: "over" },
        }),
      ),
    );
    assert.deepEqual(cs[0], cs[1]);
    assert.deepEqual(cs[1], cs[2]);
    assert.equal(cs[0]!.line, 0.5);
    assert.equal(cs[0]!.period, "first_half");
  });
  for (const period of ["", "1st Half ", "2nd Half ", "Q1 ", "Q2 ", "Q3 ", "Q4 "])
    for (const scope of ["", "Home Team ", "Away Team "])
      it(`basketball ${period}${scope}Over permitted`, () => {
        assert.ok(
          automaticMarketAllowed(
            pick("b", 1.6, {
              sport: "basketball",
              market: `${period}${scope}Total 40.5`,
              selection: "Over 40.5",
              sporty: { eventId: "b", marketId: "999", outcomeId: "over", specifier: "total=40.5" },
            }),
          ),
        );
      });
  for (const [market, selection] of [
    ["Moneyline", "Home"],
    ["Winner", "Away"],
    ["Handicap", "Home -2.5"],
    ["Total 162.5", "Under 162.5"],
    ["Draw", "Draw"],
    ["Player Total", "Over 20.5"],
  ])
    it(`basketball rejects ${market} ${selection}`, () =>
      assert.equal(
        automaticMarketAllowed(
          pick("b", 1.6, {
            sport: "basketball",
            market,
            selection,
            sporty: { eventId: "b", marketId: "999", outcomeId: "o", specifier: "total=162.5" },
          }),
        ),
        false,
      ));
});
describe("exact scope and robust statistics", () => {
  it("uses the requested minimum analysis scores, with stronger Conservative evidence", () => {
    assert.equal(SELECTION_POLICIES.conservative.minModelScore, 50);
    assert.equal(SELECTION_POLICIES.balanced.minModelScore, 45);
    const p = pick("scores", 1.4, { sport: "basketball", market: "Total (incl. overtime) 162.5", selection: "Over 162.5",
      sporty: { eventId: "scores", marketId: "225", outcomeId: "over", specifier: "total=162.5" } });
    const minimum = history(p, 10, [162, 162, 162, 162, 162, 164, 164, 164, 164, 164]);
    assert.equal(assessEvidence(p, minimum, "conservative")?.score, 50);
    const moderate = history(p, 10, [140, 140, 140, 140, 140, 190, 190, 190, 190, 190]);
    assert.equal(assessEvidence(p, moderate, "balanced")?.score, 50);
    assert.equal(assessEvidence(p, moderate, "conservative"), null);
  });
  const team = pick("b", 1.6, {
    sport: "basketball",
    market: "Home team total 82.5",
    selection: "Over 82.5",
    sporty: { eventId: "b", marketId: "227", outcomeId: "over", specifier: "total=82.5" },
  });
  it("counts exact line hits", () => {
    const s = summarize([162, 163, 164, 160, 170, 175, 180, 167, 161, 169], 162.5);
    assert.equal(s.hits, 7);
    assert.equal(s.sample, 10);
  });
  it("team totals use offense and opponent allowed, never game total", () => {
    const e = history(team);
    assert.ok(assessEvidence(team, e, "balanced"));
    e.rows.forEach((r) => {
      r.homeValue = r.home === team.home ? 78 : 70;
      r.awayValue = 100;
    });
    assert.equal(assessEvidence(team, e, "balanced"), null);
  });
  it("away team total uses away offense and home defense", () => {
    const p = {
      ...team,
      market: "Away team total 82.5",
      sporty: { ...team.sporty!, marketId: "228" },
    };
    const e = history(p);
    e.rows.filter((r) => r.home === p.home).forEach((r) => (r.awayValue = 70));
    assert.equal(assessEvidence(p, e, "balanced"), null);
  });
  it("detects outlier-inflated scoring", () => {
    const e = history(team, 10, [78, 81, 79, 80, 82, 77, 81, 79, 125, 130]);
    const a = summarize([78, 81, 79, 80, 82, 77, 81, 79, 125, 130], 82.5);
    assert.equal(a.outliers, 2);
    assert.equal(a.hits, 2);
    assert.equal(assessEvidence(team, e, "balanced"), null);
  });
  it("does not discard ordinary wins and silently raise the configured hit-rate threshold", () => {
    const p = pick("ordinary", 1.3, { sport: "basketball", market: "Total (incl. overtime) 162.5",
      selection: "Over 162.5", sporty: { eventId: "ordinary", marketId: "225", outcomeId: "over", specifier: "total=162.5" } });
    const conservative = history(p, 10, [160, 161, 163, 164, 165, 166, 167, 168, 169, 170]);
    assert.equal(summarize([160, 161, 163, 164, 165, 166, 167, 168, 169, 170], 162.5).outliers, 0);
    assert.ok(assessEvidence(p, conservative, "conservative"));
    const balanced = history(p, 10, [159, 160, 161, 163, 164, 165, 166, 167, 168, 169]);
    assert.ok(assessEvidence(p, balanced, "balanced"));
    assert.ok(assessEvidence(p, balanced, "conservative"));
  });
  it("rejects an otherwise qualifying Over when detected high outliers are carrying its hit rate", () => {
    const p = pick("inflated", 1.3, { sport: "basketball", market: "Total (incl. overtime) 162.5",
      selection: "Over 162.5", sporty: { eventId: "inflated", marketId: "225", outcomeId: "over", specifier: "total=162.5" } });
    const values = [160, 161, 161, 162, 162, 164, 165, 166, 250, 260];
    assert.equal(summarize(values, 162.5).hitRate, 0.5);
    assert.equal(summarize(values, 162.5).outliers, 2);
    assert.equal(assessEvidence(p, history(p, 10, values), "balanced"), null);
  });
  for (const period of ["1st Half", "2nd Half", "Q1", "Q2", "Q3", "Q4"])
    it(`${period} rejects full game evidence`, () => {
      const p = {
        ...team,
        market: `${period} Total 82.5`,
        sporty: { ...team.sporty!, marketId: "999" },
      };
      const e = history(p);
      e.rows.forEach((r) => (r.period = "match"));
      assert.equal(assessEvidence(p, e, "balanced"), null);
      assert.ok(assessEvidence(p, history(p), "balanced"));
    });
  it("rejects fabricated/unconfirmed and future results, duplicates and thin samples", () => {
    for (const mutate of [
      (e: Evidence) => e.rows.forEach((r) => (r.corroborated = false)),
      (e: Evidence) =>
        e.rows.forEach((r) => (r.date = new Date(Date.now() + 86400_000).toISOString())),
      (e: Evidence) => e.rows.forEach((r) => (r.date = e.rows[0]!.date)),
    ]) {
      const e = history(team);
      mutate(e);
      if (e.rows[0]!.date === e.rows[1]!.date)
        e.rows.forEach((r) => {
          r.home = team.home;
          r.away = team.away;
        });
      assert.equal(assessEvidence(team, e, "balanced"), null);
    }
  });
});
describe("complete build to booking behavior", () => {
  it("one best selection per event without forced family rotation", async () => {
    const a = pick("a"),
      alt = pick("alt", 1.7, {
        sporty: { eventId: "a", marketId: "18", outcomeId: "over", specifier: "total=2.5" },
      }),
      b = pick("b");
    const r = await buildSlip(base, deps([a, alt, b]));
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.actualGames, 2);
      assert.equal(r.analysis.rejected.duplicateEvents, 1);
      assert.match(r.notice!, /only 2/);
    }
  });
  for (const target of [2, 3, 5, 10, 20, 50])
    it(`target ${target} never relaxes Conservative range`, async () => {
      const rows = Array.from({ length: 5 }, (_, i) => pick(`${i}`, 1.3));
      const r = await buildSlip(
        { ...base, mode: "odds", risk: "conservative", targetOdds: target },
        deps(rows),
      );
      assert.ok(r.ok);
      if (r.ok) {
        assert.ok(r.selections.every((p) => p.odds! >= 1.2 && p.odds! <= 1.4));
        assert.ok(r.actualGames <= 15);
        if (target > 4) assert.match(r.notice!, /No odds range/);
      }
    });
  it("does not approve odds/AI-score only evidence", async () => {
    const r = await buildSlip(
      base,
      deps([pick("a")], {
        evidence: async () => new Map(),
        review: async (ps) => ({
          reviews: ps.map((p) => ({
            pickId: p.id,
            score: 99,
            summary: "Confident",
            reasons: [],
            risks: [],
          })),
          attemptedEvents: 1,
          reviewedEvents: 1,
        }),
      }),
    );
    assert.equal(r.ok, false);
  });
  it("rejects suspended/unavailable events before analysis", async () => {
    const p = pick("a");
    let called = false;
    const r = await buildSlip(
      base,
      deps([p], {
        refresh: async () => ({ available: [], unavailable: [{ pick: p, reason: "closed" }] }),
        evidence: async () => {
          called = true;
          return new Map();
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });
  it("rechecks range after provider refresh", async () => {
    const p = pick("a", 1.3);
    const r = await buildSlip(
      { ...base, risk: "conservative" },
      deps([p], { refresh: async () => ({ available: [{ ...p, odds: 1.41 }], unavailable: [] }) }),
    );
    assert.equal(r.ok, false);
  });
  it("times out research without manufacturing selections", async () => {
    const r = await buildSlip(
      base,
      deps([pick("a")], { analysisTimeoutMs: 5, evidence: async () => new Promise(() => {}) }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "analysis_failed");
  });
  it("retains risk and exact analysed IDs through real booking function", async () => {
    const p = pick("a", 1.3),
      r = await buildSlip({ ...base, risk: "conservative" }, deps([p]));
    assert.ok(r.ok);
    if (!r.ok) return;
    let minted = false;
    const book = await mintReviewedSlip(r.selections, "ng", {
      refresh: async (ps) => ({
        available: ps.map((p) => ({ ...p, odds: 1.41 })),
        unavailable: [],
      }),
      mint: async () => {
        minted = true;
        return { error: "must not mint" };
      },
    });
    assert.equal(book.ok, false);
    assert.equal(minted, false);
    const good = await mintReviewedSlip(r.selections, "ng", {
      refresh: async (ps) => ({ available: ps, unavailable: [] }),
      mint: async (selections) => {
        assert.deepEqual(selections, [p.sporty]);
        return { shareCode: "PROVIDER_CODE", shareURL: "https://sportybet.com", unavailable: 0 };
      },
    });
    assert.ok(good.ok);
  });
  it("provider discovery -> normalization -> evidence -> construction -> mint IDs", async () => {
    const original = globalThis.fetch;
    clearSportyCacheForTests();
    const p = pick("pipeline", 1.3);
    const event = {
      eventId: p.sporty!.eventId,
      status: 0,
      banned: false,
      estimateStartTime: p.kickoff,
      homeTeamName: p.home,
      awayTeamName: p.away,
      sport: {
        id: "sr:sport:1",
        name: "Football",
        category: { name: "England", tournament: { name: p.league } },
      },
      markets: [
        {
          id: "18",
          desc: "Over/Under",
          specifier: "total=2.5",
          status: 0,
          outcomes: [
            { id: "over", desc: "Over 2.5", odds: "1.30", isActive: 1 },
            { id: "under", desc: "Under 2.5", odds: "1.30", isActive: 1 },
          ],
        },
      ],
    };
    try {
      globalThis.fetch = async (url) =>
        new Response(
          JSON.stringify({
            bizCode: 10000,
            data: String(url).includes("/factsCenter/event?")
              ? event
              : { totalNum: 1, tournaments: [{ events: [event] }] },
          }),
        );
      const r = await buildSlip(
        { ...base, risk: "conservative" },
        { discover: listUpcomingPicks, evidence: deps([]).evidence, record: deps([]).record },
      );
      assert.ok(r.ok);
      if (!r.ok) return;
      const booked = await mintReviewedSlip(r.selections, "ng", {
        refresh: async (ps) => ({ available: ps, unavailable: [] }),
        mint: async (ids) => {
          assert.equal(ids[0]!.outcomeId, "over");
          return {
            shareCode: "ACTUAL_PROVIDER_RESULT",
            shareURL: "https://sportybet.com",
            unavailable: 0,
          };
        },
      });
      assert.ok(booked.ok);
    } finally {
      globalThis.fetch = original;
      clearSportyCacheForTests();
    }
  });
  it("validates request boundaries", () => {
    assert.ok(validateBuildRequest(base).ok);
    assert.equal(validateBuildRequest({ ...base, games: 16 }).ok, false);
    assert.equal(validateBuildRequest({ ...base, mode: "odds", targetOdds: 5001 }).ok, false);
  });
});

describe("structured score-source contracts", () => {
  it("accepts published final score objects and excludes incomplete games", async () => {
    const { evidenceFromEspn } = await import("./espn-history");
    const p = pick("b", 1.6, {
      sport: "basketball",
      home: "Indiana Fever",
      away: "New York Liberty",
      market: "Over/Under (incl. overtime) 162.5",
      selection: "Over 162.5",
      sporty: { eventId: "b", marketId: "225", outcomeId: "over", specifier: "total=162.5" },
    });
    const event = {
      id: "123",
      date: new Date(Date.now() - 86400_000).toISOString(),
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            { homeAway: "home", team: { displayName: p.home }, score: { value: 91 } },
            { homeAway: "away", team: { displayName: p.away }, score: { value: 109 } },
          ],
        },
      ],
    };
    const e = evidenceFromEspn(p, "basketball/wnba", [event]);
    assert.equal(e.rows[0]!.homeValue, 91);
    assert.equal(e.rows[0]!.awayValue, 109);
    event.competitions[0]!.status.type.completed = false;
    assert.equal(evidenceFromEspn(p, "basketball/wnba", [event]).rows.length, 0);
  });
  it("derives exact halves and quarters only from complete period arrays", async () => {
    const { evidenceFromEspn } = await import("./espn-history");
    const p = pick("b", 1.6, {
      sport: "basketball",
      home: "Indiana Fever",
      away: "New York Liberty",
      market: "1st Half Total 82.5",
      selection: "Over 82.5",
      sporty: { eventId: "b", marketId: "999", outcomeId: "over", specifier: "total=82.5" },
    });
    const event = {
      id: "123",
      date: new Date(Date.now() - 86400_000).toISOString(),
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            {
              homeAway: "home",
              team: { displayName: p.home },
              score: "100",
              linescores: [
                { period: 1, value: 25 },
                { period: 2, value: 30 },
                { period: 3, value: 20 },
                { period: 4, value: 25 },
              ],
            },
            {
              homeAway: "away",
              team: { displayName: p.away },
              score: "90",
              linescores: [
                { period: 1, value: 20 },
                { period: 2, value: 25 },
                { period: 3, value: 20 },
                { period: 4, value: 25 },
              ],
            },
          ],
        },
      ],
    };
    const e = evidenceFromEspn(p, "basketball/wnba", [event]);
    assert.equal(e.rows[0]!.homeValue, 55);
    assert.equal(e.rows[0]!.awayValue, 45);
    const q = {
      ...p,
      market: "Q3 Total 40.5",
      selection: "Over 40.5",
      sporty: { ...p.sporty!, specifier: "total=40.5" },
    };
    assert.equal(evidenceFromEspn(q, "basketball/wnba", [event]).rows[0]!.homeValue, 20);
    event.competitions[0]!.competitors[0]!.linescores = [];
    assert.equal(evidenceFromEspn(p, "basketball/wnba", [event]).rows.length, 0);
  });
  it("does not reuse NCAA half scores as quarter scores", async () => {
    const { evidenceFromEspn } = await import("./espn-history");
    const p = pick("b", 1.6, {
      sport: "basketball",
      market: "Q1 Total 40.5",
      selection: "Over 40.5",
      sporty: { eventId: "b", marketId: "999", outcomeId: "over", specifier: "total=40.5" },
    });
    const e = {
      id: "123",
      date: new Date(Date.now() - 86400_000).toISOString(),
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [
            {
              homeAway: "home",
              team: { displayName: p.home },
              score: "90",
              linescores: [
                { period: 1, value: 40 },
                { period: 2, value: 50 },
              ],
            },
            {
              homeAway: "away",
              team: { displayName: p.away },
              score: "90",
              linescores: [
                { period: 1, value: 40 },
                { period: 2, value: 50 },
              ],
            },
          ],
        },
      ],
    };
    assert.equal(evidenceFromEspn(p, "basketball/mens-college-basketball", [e]).rows.length, 0);
  });
  it("never silently replaces provider selections during booking refresh", async () => {
    let mint = false;
    const p = pick("a");
    const r = await mintReviewedSlip([p], "ng", {
      refresh: async () => ({ available: [pick("unrelated")], unavailable: [] }),
      mint: async () => {
        mint = true;
        return { error: "must not run" };
      },
    });
    assert.equal(r.ok, false);
    assert.equal(mint, false);
  });
});

describe("football count consistency", () => {
  it("accepts ordinary low-count goal dispersion without applying a basketball point-CV threshold", () => {
    const p = pick("goals", 1.3, { market: "Total Goals", selection: "Over 1.5",
      sporty: { eventId: "goals", marketId: "18", outcomeId: "over", specifier: "total=1.5" } });
    const e = history(p, 10, [3, 2, 2, 0, 3, 4, 3, 5, 0, 4]);
    assert.ok(summarize([3, 2, 2, 0, 3, 4, 3, 5, 0, 4], 1.5).variation > 0.25);
    assert.ok(assessEvidence(p, e, "conservative"));
    assert.equal(assessEvidence(p, history(p, 8), "conservative"), null);
    assert.equal(assessEvidence(p, history(p, 10, [0, 0, 0, 0, 0, 0, 0, 0, 8, 9]), "balanced"), null);
  });
});

it("actual builder compares every qualified fixture option and diversifies only equal scores", async () => {
  const a = pick("equal-a", 1.3), b = pick("equal-b", 1.3);
  const alternate = { ...b, id: "b-btts", market: "Both Teams To Score", selection: "Yes",
    sporty: { eventId: "equal-b", marketId: "29", outcomeId: "yes", specifier: "" } };
  const r = await buildSlip({ ...base, risk: "conservative" }, deps([a, b, alternate]));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.actualGames, 2);
    assert.deepEqual(r.selections.map(p => canonicalMarket(p).family).sort(), ["btts", "total"]);
    assert.equal(new Set(r.selections.map(p => p.sporty?.eventId)).size, 2);
    assert.equal(r.analysis.marketOptionsReviewed, 3);
  }
});

it("optional research deadline preserves already corroborated fixture history", async () => {
  const p = pick("completed", 1.3), evidence = history(p);
  const result = new Map([[p.id, evidence]]);
  const optional = await beforeResearchDeadline(() => new Promise<void>(() => {}), Date.now() + 20);
  assert.equal(optional, undefined);
  assert.ok(assessEvidence(p, result.get(p.id), "conservative"));
  assert.equal(await beforeResearchDeadline(async () => "fast", Date.now() + 1000), "fast");
});

it("never analyses arbitrary football minute intervals with final scores", async () => {
  for (const market of ["Total Goals Over/Under from 1 to 40 minute 0.5", "Goals Over/Under 1-15", "First 10 Minutes Total Goals"]) {
    const p = pick("interval", 1.34, { market, selection: "Over 0.5",
      sporty: { eventId: "interval", marketId: "999", outcomeId: "over", specifier: "total=0.5" } });
    assert.equal(canonicalMarket(p).period, "unknown");
    assert.equal(automaticMarketAllowed(p), false);
    assert.equal(assessEvidence(p, history(p), "conservative"), null);
    assert.equal((await buildSlip({ ...base, risk: "conservative" }, deps([p]))).ok, false);
  }
});
it("team-named provider Over labels use team scoring, never the full-game total", () => {
  const p = pick("named", 1.3, { home: "Cerro Porteno", away: "Rubio Nu", market: "Cerro Porteno Over/Under 0.5",
    selection: "Over 0.5", sporty: { eventId: "named", marketId: "999", outcomeId: "over", specifier: "total=0.5" } });
  assert.equal(canonicalMarket(p).family, "team_total");
  assert.equal(canonicalMarket(p).scope, "home");
  const evidence = history(p);
  evidence.rows.forEach(r => { r.homeValue = 0; r.awayValue = 4; });
  assert.equal(assessEvidence(p, evidence, "conservative"), null);
  assert.equal(canonicalMarket({ ...p, market: "Rubio Nu Over/Under 0.5" }).scope, "away");
  assert.equal(canonicalMarket({ ...p, market: "Cerro Porteno Total Corners" }).scope, "home");
});

it("reports upstream history limits instead of blaming risk evidence", async () => {
  const p = pick("limited", 1.6);
  const r = await buildSlip(base, deps([p], { evidence: async () => Object.assign(new Map(), {
    sourceFailures: ["Parse HTTP 429: request rate or quota limit"],
  }) }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "analysis_failed");
    assert.match(r.error, /Parse HTTP 429/);
    assert.match(r.error, /SportyBet supplied 1 eligible fixtures/);
    assert.doesNotMatch(r.error, /none passed/);
  }
});
