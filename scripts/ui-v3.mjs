#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function patch(path, replacements) {
  let source = readFileSync(path, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (source.includes(from)) {
      source = source.replaceAll(from, to);
      changed = true;
    }
  }
  if (changed) writeFileSync(path, source);
  console.log(`[ui-v3] ${path}: ${changed ? "updated" : "already current"}`);
}

patch("src/lib/build-slip.ts", [
  ["games > 15", "games > 50"],
  ["Choose between 2 and 15 games.", "Choose between 2 and 50 games."],
  [
    "dependencies.discover(request.sport, 42, request.window)",
    'dependencies.discover(request.sport, request.mode === "games" ? Math.max(42, request.games ?? 0) : 42, request.window)',
  ],
]);

patch("src/lib/book-slip.ts", [
  ["picks.length > 15", "picks.length > 50"],
  ["Choose between 1 and 15 selections before creating a code.", "Choose between 1 and 50 selections before creating a code."],
]);

patch("src/lib/sportybet.ts", [
  ["Math.min(42, limit)", "Math.min(50, limit)"],
]);

patch("src/lib/longshot.ts", [
  [
    'const LONGSHOT_POLICY_VERSION = "longshot-v3-fast-price-model";',
    'const LONGSHOT_POLICY_VERSION = "longshot-v4-48h";\nconst LONGSHOT_WINDOW_MS = 48 * 60 * 60 * 1000;\nconst LONGSHOT_DISCOVERY_LIMIT = 50;',
  ],
  [
    '  const listed = await listUpcomingPicks(sport, LONGSHOT_MAX_LEGS, "upcoming", "any", []);',
    '  const listed = await listUpcomingPicks(sport, LONGSHOT_DISCOVERY_LIMIT, "upcoming", "any", []);',
  ],
  [
    '  const eligible = listed.filter((pick) => aggressivePriceAllowed(sport, pick));',
    '  const now = Date.now();\n  const cutoff = now + LONGSHOT_WINDOW_MS;\n  const eligible = listed.filter((pick) =>\n    aggressivePriceAllowed(sport, pick) &&\n    typeof pick.kickoff === "number" &&\n    pick.kickoff >= now &&\n    pick.kickoff <= cutoff,\n  );',
  ],
]);

patch("src/styles.css", [
  [
    '@import "./slipcut-v2.css";',
    '@import "./slipcut-v2.css";\n@import "./ui-v4.css";',
  ],
]);

const component = "src/components/mini-app-refresh.tsx";
patch(component, [
  ["max={15}", "max={50}"],
  ["Smarter slips. Better decisions.", "BUILD • CUT • BOOK"],
  [
    "Separate high-odds cards built from the strongest Aggressive candidates available. No mixed sports.",
    "High-odds cards from fixtures starting within the next 48 hours only. No mixed sports.",
  ],
]);

const oldGameControl = `                  <details className="final-game-count">\n                    <summary>Build by number of games</summary>\n                    <div className="final-range-row">\n                      <span>Games</span><strong>{games}</strong>\n                    </div>\n                    <input\n                      aria-label="Number of games"\n                      type="range"\n                      min={2}\n                      max={50}\n                      value={games}\n                      onChange={(event) => { setMode("games"); setGames(Number(event.target.value)); }}\n                      className="mini-range w-full"\n                    />\n                  </details>`;

const newGameControl = `                  <details className="final-game-count">\n                    <summary>Build by number of games</summary>\n                    <div className="final-range-row">\n                      <span>Games</span><strong>{games}</strong>\n                    </div>\n                    <div className="v3-game-count-control">\n                      <button\n                        type="button"\n                        aria-label="Remove one game"\n                        onClick={() => { setMode("games"); setGames((current) => Math.max(2, current - 1)); }}\n                      >−</button>\n                      <input\n                        aria-label="Number of games"\n                        type="number"\n                        inputMode="numeric"\n                        min={2}\n                        max={50}\n                        value={games}\n                        onChange={(event) => {\n                          const next = Number(event.target.value);\n                          if (!Number.isFinite(next)) return;\n                          setMode("games");\n                          setGames(Math.max(2, Math.min(50, Math.round(next))));\n                        }}\n                      />\n                      <button\n                        type="button"\n                        aria-label="Add one game"\n                        onClick={() => { setMode("games"); setGames((current) => Math.min(50, current + 1)); }}\n                      >+</button>\n                    </div>\n                    <div className="v3-game-count-presets">\n                      {[5, 10, 20, 30, 50].map((count) => (\n                        <button\n                          key={count}\n                          type="button"\n                          className={mode === "games" && games === count ? "is-active" : ""}\n                          onClick={() => { setMode("games"); setGames(count); }}\n                        >{count}</button>\n                      ))}\n                    </div>\n                  </details>`;

patch(component, [[oldGameControl, newGameControl]]);
console.log("[ui-v3] V4 visual layer, 48h Longshot window, and expanded game count ready");
