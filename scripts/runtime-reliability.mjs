#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function patchDbSsl() {
  const path = "src/lib/db.ts";
  let source = readFileSync(path, "utf8");
  const from = "    const pool = new Pool({ connectionString: databaseUrl });";
  const to = `    const connectionString = (() => {
      if (!databaseUrl) return databaseUrl;
      try {
        const url = new URL(databaseUrl);
        const sslmode = url.searchParams.get("sslmode");
        if (!sslmode || sslmode === "prefer" || sslmode === "require" || sslmode === "verify-ca") {
          // pg currently treats these modes as verify-full and warns that its
          // next major version will change that behavior. Make the intended
          // certificate verification explicit so production stays secure and
          // the Vercel warning disappears.
          url.searchParams.set("sslmode", "verify-full");
        }
        return url.toString();
      } catch {
        return databaseUrl;
      }
    })();
    const pool = new Pool({ connectionString });`;

  if (source.includes(to)) {
    console.log("[runtime] database SSL mode already explicit");
    return;
  }
  if (!source.includes(from)) throw new Error("[runtime] expected pg pool source not found");
  source = source.replace(from, to);
  writeFileSync(path, source);
  console.log("[runtime] database SSL mode set to verify-full");
}

function patchAuthDbSsl() {
  const path = "src/lib/auth/server.ts";
  let source = readFileSync(path, "utf8");
  const from = `const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };`;
  const to = `const authDatabaseUrl = (() => {
  if (!databaseUrl) return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get("sslmode");
    if (!sslmode || sslmode === "prefer" || sslmode === "require" || sslmode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
})();

const database = authDatabaseUrl
  ? new Pool({ connectionString: authDatabaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };`;

  if (source.includes(to)) {
    console.log("[runtime] auth database SSL mode already explicit");
    return;
  }
  if (!source.includes(from)) throw new Error("[runtime] expected auth pg pool source not found");
  source = source.replace(from, to);
  writeFileSync(path, source);
  console.log("[runtime] auth database SSL mode set to verify-full");
}

function patchEngineMintConcurrency() {
  const path = "src/lib/engine.ts";
  let source = readFileSync(path, "utf8");
  const startMarker = "  const cards: EngineCard[] = [];\n  const priorUses = new Map<string, number>();\n  const seenCards = new Set<string>();\n\n  for (const targetOdds of ENGINE_LADDER) {";
  const endMarker = "  if (!cards.length) {";
  const already = "  const planned: Array<{ targetOdds: number; take: TicketPick[]; signature: string }> = [];";

  if (source.includes(already)) {
    console.log("[runtime] Engine booking concurrency already applied");
    return;
  }
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error("[runtime] expected Engine booking block not found");

  const replacement = `  const priorUses = new Map<string, number>();
  const seenCards = new Set<string>();
  const planned: Array<{ targetOdds: number; take: TicketPick[]; signature: string }> = [];

  // Decide every ladder card first, then book a few in parallel. Previously all
  // six SportyBet booking validations ran serially, which made a cold Engine
  // request exceed Vercel's 60-second function limit even when every card was
  // valid. Planning remains deterministic and selection policy is unchanged.
  for (const targetOdds of ENGINE_LADDER) {
    const ordered = selectDiversifiedEngineCard(ranked, ranked.length, priorUses);
    const take = buildToOdds(ordered, targetOdds);
    if (take.length < 2) continue;

    const signature = take
      .map((pick) => pick.sporty?.eventId ?? pick.id)
      .sort()
      .join("|");
    if (seenCards.has(signature)) continue;
    const selections = sportyOf(take);
    if (selections.length !== take.length) continue;

    seenCards.add(signature);
    for (const pick of take) priorUses.set(pick.id, (priorUses.get(pick.id) ?? 0) + 1);
    planned.push({ targetOdds, take, signature });
  }

  const cardsByIndex: Array<EngineCard | null> = Array(planned.length).fill(null);
  let cursor = 0;
  const workerCount = Math.min(3, planned.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      const plan = planned[index];
      if (!plan) return;
      const { targetOdds, take } = plan;
      const minted = await mintReviewedSlip(take, "ng", undefined, { acceptOddsChanges: false });
      if (!minted.ok) continue;

      await Promise.all([
        recordSlip(minted.shareCode, take),
        rememberEngineEventIds(
          sport,
          take.map((pick) => pick.sporty?.eventId).filter((id): id is string => Boolean(id)),
        ),
      ]);

      const odds = combinedOdds(take);
      const targetReached =
        odds !== null && Math.abs(Math.log(odds / targetOdds)) <= Math.log(1.05);
      cardsByIndex[index] = {
        n: take.length,
        targetOdds,
        targetReached,
        code: minted.shareCode,
        url: minted.shareURL,
        odds,
        games: take.length,
        legs: take.map((pick) => ({
          home: pick.home,
          away: pick.away,
          market: pick.market,
          selection: pick.selection,
          odds: pick.odds,
          sport: pick.sport,
        })),
      };
    }
  });
  await Promise.all(workers);
  const cards = cardsByIndex.filter((card): card is EngineCard => card !== null);

`;

  source = source.slice(0, start) + replacement + source.slice(end);
  writeFileSync(path, source);
  console.log("[runtime] Engine books up to 3 ladder cards concurrently");
}

patchDbSsl();
patchAuthDbSsl();
patchEngineMintConcurrency();
console.log("[runtime] reliability patches complete");
