#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function patch(path, replacements) {
  let source = readFileSync(path, "utf8");
  let changed = false;
  for (const [from, to, label] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`${label}: expected source not found in ${path}`);
    }
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) writeFileSync(path, source);
  console.log(`${path}: ${changed ? "patched" : "already patched"}`);
}

patch("src/lib/engine.ts", [
  [
    'const ENGINE_POLICY_VERSION = "odds-target-ladder-v7";',
    'const ENGINE_POLICY_VERSION = "odds-target-ladder-v8";',
    "engine cache version",
  ],
  [
    `  const ranked = results\n    .flatMap((r) =>\n      r.ok ? r.selections.filter((p) => p.analysisBasis === "mathematical_projection") : [],\n    )\n    .sort((a, b) => b.modelScore - a.modelScore);`,
    `  const ranked = results\n    .flatMap((r) => (r.ok ? r.selections : []))\n    .sort(\n      (a, b) =>\n        Number(b.analysisBasis === "mathematical_projection") -\n          Number(a.analysisBasis === "mathematical_projection") ||\n        b.modelScore - a.modelScore ||\n        (b.trackRecord.hitRate ?? -1) - (a.trackRecord.hitRate ?? -1) ||\n        (a.odds ?? 99) - (b.odds ?? 99),\n    );`,
    "engine market-only fallback",
  ],
  [
    '        : "Insufficient evidence-qualified Conservative selections for engine cards.",',
    '        : "Insufficient qualified Conservative selections for engine cards.",',
    "engine empty-pool message",
  ],
  [
    '    "The engine builds separate 2×, 3×, 5×, 10×, 20× and 50× target cards from evidence-qualified Conservative selections.",',
    '    "The engine builds separate 2×, 3×, 5×, 10×, 20× and 50× target cards from Conservative selections. Statistical projections rank first; live SportyBet fallbacks are used when history providers have no usable rows.",',
    "engine intro fallback copy",
  ],
  [
    '    "Settled hit rate prioritises stronger market families first; other mathematically qualified selections can fill longer cards when needed.",',
    '    "Settled hit rate prioritises stronger market families first; mathematically scored selections rank ahead of live-market fallbacks.",',
    "engine intro ranking copy",
  ],
]);

patch("server/routes/api/miniapp/build.post.ts", [
  [
    `      discover: (sport, _limit, window) =>\n        listUpcomingPicks(sport, requestedFixtureCount, window),`,
    `      discover: async (sport, _limit, window) => {\n        const listed = await listUpcomingPicks(sport, requestedFixtureCount, window);\n        if (!Array.isArray(listed)) return listed;\n        return listed.filter(\n          (pick) => typeof pick.odds === "number" && pick.odds >= 1.16 && pick.odds <= 1.7,\n        );\n      },`,
    "football aggressive 1.70 discovery cap",
  ],
  [
    `  const result = await withBuildDeadline(\n    dependencies ? buildSlip(request.value, dependencies) : buildSlip(request.value),\n  );`,
    `  const result = await withBuildDeadline(\n    dependencies ? buildSlip(request.value, dependencies) : buildSlip(request.value),\n  );\n  if (result.ok && request.value.sport === "football" && request.value.risk === "aggressive") {\n    result.policy = {\n      ...result.policy,\n      maxOdds: 1.7,\n      explanation: "Football Aggressive uses 1.16–1.70 per selection.",\n    };\n  }`,
    "football aggressive response policy",
  ],
]);

patch("src/components/mini-app-refresh.tsx", [
  [
    '        <div className="grid grid-cols-5 gap-1">',
    '        <div className="grid grid-cols-4 gap-1">',
    "four-item bottom navigation",
  ],
  [
    '              { id: "predict", label: "Predict", icon: Sparkles },\n',
    "",
    "remove Predict menu item",
  ],
  [
    ': "Aggressive: 1.16–2.75 odds · model score 45+ · wider qualifying price range and higher variance."}',
    ': sport === "football"\n                          ? "Aggressive: 1.16–1.70 odds · model score 45+ · wider qualifying price range and higher variance."\n                          : "Aggressive: 1.16–2.75 odds · model score 45+ · wider qualifying price range and higher variance."}',
    "sport-specific Aggressive copy",
  ],
]);
