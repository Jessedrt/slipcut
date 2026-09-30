import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearFlashscoreCacheForTests, evidenceFromFlashscore, matchFlashscoreFixture, researchFlashscoreEvidence } from "./parse-flashscore";
import { assessEvidence } from "./selection-evidence";
import type { TicketPick } from "./types";

const now = Date.now();
const pick: TicketPick = { id: "p", home: "Arsenal", away: "Chelsea", sport: "football",
  league: "England Premier League", country: "England", kickoff: now + 3600_000,
  market: "Total Goals", selection: "Over 1.5", odds: 1.3,
  sporty: { eventId: "sporty", marketId: "18", outcomeId: "over", specifier: "total=1.5" } };
const fixture = { match_id: "flash", status: "not_started", start_time: new Date(pick.kickoff!).toISOString(),
  home_team: { name: "Arsenal" }, away_team: { name: "Chelsea" },
  competition: { name: "ENGLAND: Premier League", country: "England" } };
const history = Array.from({ length: 12 }, (_, i) => ({ match_id: `past-${i}`,
  date: new Date(now - (i + 1) * 86400_000).toISOString(), home_team: i % 2 ? "Other" : "Arsenal",
  away_team: i % 2 ? "Chelsea" : "Other", score: "2:2", home_score: "2", away_score: "2" }));
const preview = { match_id: "flash", home_team: "Arsenal", away_team: "Chelsea",
  home_form: history, away_form: history, h2h: [] };
beforeEach(clearFlashscoreCacheForTests);
test("verified basketball team and international-country aliases preserve fixture identity and history scoring", () => {
  const p: TicketPick = { ...pick, sport: "basketball", home: "CB San Pablo Burgos", away: "KK Cedevita Olimpija Ljubljana",
    league: "Eurocup", country: "International", market: "Total Points Including Overtime" };
  const f = { ...fixture, home_team: { name: "San Pablo Burgos" }, away_team: { name: "Cedevita Olimpija" },
    competition: { name: "EUROPE: Eurocup", country: "Europe" } };
  assert.equal(matchFlashscoreFixture(p, [f]), f);
  assert.equal(matchFlashscoreFixture({ ...p, league: "NBL" }, [f]), undefined);
  assert.equal(matchFlashscoreFixture({ ...p, country: "France" }, [f]), undefined);
  assert.equal(matchFlashscoreFixture(p, [f, f]), undefined);
  const e = evidenceFromFlashscore(p, { match_id: "flash", home_team: "San Pablo Burgos", away_team: "Cedevita Olimpija",
    home_form: [{ match_id: "historical", date: new Date(now - 86400_000).toISOString(),
      home_team: "Cedevita Olimpija", away_team: "San Pablo Burgos", score: "87:79" }] }, now);
  assert.equal(e.rows[0]?.home, p.away);
  assert.equal(e.rows[0]?.away, p.home);
  assert.equal(e.rows[0]?.awayValue, 79);
});
test("Czech Republic and Czechia map to the same domestic country, preserving both teams", () => {
  const p: TicketPick = { ...pick, sport: "basketball", home: "BK Decin", away: "Basket Brno", league: "NBL", country: "Czechia" };
  const f = { ...fixture, home_team: { name: "Decin" }, away_team: { name: "Brno" }, competition: { name: "CZECH REPUBLIC: NBL", country: "Czech Republic" } };
  assert.equal(matchFlashscoreFixture(p, [f]), f);
  assert.equal(matchFlashscoreFixture({ ...p, country: "Australia" }, [f]), undefined);
});
test("maps verified production basketball naming variants without fuzzy matching", () => {
  const cases = [
    ["Sluneta Usti nad Labem", "BK Opava", "Usti n. Labem", "Opava", "NBL", "Czechia", "CZECH REPUBLIC: NBL", "Czech Republic"],
    ["PAOK BC", "Basquet Manresa", "PAOK", "Manresa", "Eurocup", "International", "EUROPE: Eurocup", "Europe"],
    ["BC Lietkabelis Panevezys", "KK Bosna Royal Sarajevo", "Lietkabelis", "KK Bosna", "Eurocup", "International", "EUROPE: Eurocup", "Europe"],
    ["Ratiopharm Ulm", "Balkan Botevgrad", "Ulm", "Balkan", "Eurocup", "International", "EUROPE: Eurocup", "Europe"],
    ["Rigas Zelli", "Derthona Basket", "Rigas Zelli", "Tortona", "Eurocup", "International", "EUROPE: Eurocup", "Europe"],
    ["Bahcesehir Koleji", "BC Roma Spqr", "Bahcesehir Kol.", "BC Roma", "Eurocup", "International", "EUROPE: Eurocup", "Europe"],
  ] as const;
  for (const [home, away, flashHome, flashAway, league, country, competition, flashCountry] of cases) {
    const p: TicketPick = { ...pick, sport: "basketball", home, away, league, country };
    const f = { ...fixture, home_team: { name: flashHome }, away_team: { name: flashAway },
      competition: { name: competition, country: flashCountry } };
    assert.equal(matchFlashscoreFixture(p, [f]), f);
  }
});

test("matches exact fixture identity and rejects ambiguity, wrong country, competition or time", () => {
  assert.equal(matchFlashscoreFixture(pick, [fixture]), fixture);
  assert.equal(matchFlashscoreFixture(pick, [fixture, fixture]), undefined);
  for (const f of [{ ...fixture, competition: { name: "ENGLAND: Championship", country: "England" } },
    { ...fixture, competition: { ...fixture.competition, country: "France" } },
    { ...fixture, start_time: new Date(now + 86400_000).toISOString() },
    { ...fixture, status: "live" }, { ...fixture, home_team: { name: "Arsenal Women" } }])
    assert.equal(matchFlashscoreFixture(pick, [f]), undefined);
});
test("retains final scores, deduplicates history, skips missing/conflicting/future/live rows", () => {
  const evidence = evidenceFromFlashscore(pick, { ...preview, h2h: [
    { ...history[0]!, match_id: "future", date: new Date(now + 1).toISOString() },
    { ...history[0]!, match_id: "live", status: "live" },
    { ...history[0]!, match_id: "missing", score: "", home_score: "" },
    { ...history[0]!, match_id: "conflict", home_score: "9" },
  ] }, now);
  assert.equal(evidence.rows.length, 12);
  assert.equal(evidence.rows[0]!.homeValue, 2);
  assert.equal(evidence.rows[0]!.period, "match");
  assert.equal(evidenceFromFlashscore(pick, { ...preview, away_team: "Wrong" }, now).rows.length, 0);
});
test("does not use final scores for halves, quarters, corners or regulation basketball", () => {
  for (const market of ["First Half Total Goals", "Second Half Total Goals", "Q1 Total Points", "Total Corners"])
    assert.equal(evidenceFromFlashscore({ ...pick, market }, preview, now).rows.length, 0);
  assert.equal(evidenceFromFlashscore({ ...pick, sport: "basketball", market: "Total Points" }, preview, now).rows.length, 0);
  assert.equal(evidenceFromFlashscore({ ...pick, sport: "basketball", market: "Total Points Including Overtime" }, preview, now).rows.length, 12);
});
test("team totals use selected team scoring and opponent allowed rather than combined score", () => {
  const teamPick = { ...pick, market: "Home Team Total Goals", selection: "Over 2.5", sporty: undefined };
  const strong = Array.from({ length: 20 }, (_, i) => ({ ...history[0]!, match_id: `t${i}`,
    date: new Date(now - (i + 1) * 86400_000).toISOString(),
    home_team: i < 10 ? "Arsenal" : "Other", away_team: i < 10 ? "Other" : "Chelsea",
    score: "3:0", home_score: "3", away_score: "0" }));
  const evidence = evidenceFromFlashscore(teamPick, { ...preview, home_form: strong, away_form: [] }, now);
  assert.ok(assessEvidence(teamPick, evidence, "conservative"));
  const weak = strong.map((r) => ({ ...r, score: "0:3", home_score: "0", away_score: "3" }));
  assert.equal(assessEvidence(teamPick, evidenceFromFlashscore(teamPick, { ...preview, home_form: weak, away_form: [] }, now), "conservative"), null);
});
test("server adapter authenticates, shares fixture history across lines, preserves Sporty odds and caches calls", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const endpoint = String(url).split("/").at(-1)!; calls.push(endpoint);
    assert.equal((init?.headers as Record<string, string>)["X-API-Key"], "test-key");
    assert.equal(init?.method, "POST");
    assert.equal(JSON.parse(String(init?.body)).limit, undefined);
    return Response.json({ status: "success", data: endpoint === "get_daily_fixtures"
      ? { sport: "football", matches: [fixture] } : { ...preview, odds: { home_win: "999" } } });
  };
  const options = { apiKey: "test-key", fetcher, now };
  const result = await researchFlashscoreEvidence([pick, { ...pick, id: "p2", selection: "Over 2.5" }], options);
  assert.equal(result.size, 2); assert.equal(pick.odds, 1.3); assert.equal(pick.sporty?.eventId, "sporty");
  await researchFlashscoreEvidence([pick], options);
  assert.deepEqual(calls, ["get_daily_fixtures", "get_match_preview"]);
});
test("one slow history request does not block another fixture or duplicate daily calls", { timeout: 2000 }, async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const other: TicketPick = { ...pick, id: "two", home: "Home Two", away: "Away Two", sporty: { ...pick.sporty!, eventId: "two" } };
  let dailyCalls = 0, historyCalls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("get_daily_fixtures")) {
      dailyCalls++;
      return Response.json({ status: "success", data: { sport: "football", matches: [fixture,
        { ...fixture, match_id: "two", home_team: { name: other.home }, away_team: { name: other.away } }] } });
    }
    historyCalls++;
    const id = JSON.parse(String(init?.body)).match_id;
    if (id === "flash") await blocked;
    else release();
    return Response.json({ status: "success", data: id === "flash" ? preview : { ...preview, match_id: "two", home_team: other.home,
      away_team: other.away, home_form: history.map((r) => ({ ...r, home_team: r.home_team === "Arsenal" ? other.home : r.home_team,
        away_team: r.away_team === "Chelsea" ? other.away : r.away_team })), away_form: [] } });
  };
  const r = await researchFlashscoreEvidence([pick, other, { ...pick, id: "alternate" }], { apiKey: "test", fetcher, now });
  assert.equal(r.size, 3);
  assert.equal(dailyCalls, 1);
  assert.equal(historyCalls, 2);
});
test("no key, exhausted budget, wrong sport, provider rejection and network errors fail closed", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("network failed"); };
  assert.equal((await researchFlashscoreEvidence([pick], { apiKey: "", fetcher, now })).size, 0);
  assert.equal((await researchFlashscoreEvidence([pick], { apiKey: "test", maxCalls: 0, fetcher, now })).size, 0);
  assert.equal(calls, 0);
  assert.equal((await researchFlashscoreEvidence([pick], { apiKey: "test", fetcher, now })).size, 0);
  for (const payload of [{ status: "error" }, { status: "success", data: { sport: "basketball", matches: [fixture] } }]) {
    clearFlashscoreCacheForTests();
    assert.equal((await researchFlashscoreEvidence([pick], { apiKey: "test", now, fetcher: async () => Response.json(payload) })).size, 0);
  }
});
