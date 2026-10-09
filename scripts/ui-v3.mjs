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

const component = "src/components/mini-app-refresh.tsx";
patch(component, [
  ["max={15}", "max={50}"],
  ["Smarter slips. Better decisions.", "BUILD • CUT • BOOK"],
]);

const oldGameControl = `                  <details className="final-game-count">\n                    <summary>Build by number of games</summary>\n                    <div className="final-range-row">\n                      <span>Games</span><strong>{games}</strong>\n                    </div>\n                    <input\n                      aria-label="Number of games"\n                      type="range"\n                      min={2}\n                      max={50}\n                      value={games}\n                      onChange={(event) => { setMode("games"); setGames(Number(event.target.value)); }}\n                      className="mini-range w-full"\n                    />\n                  </details>`;

const newGameControl = `                  <details className="final-game-count">\n                    <summary>Build by number of games</summary>\n                    <div className="final-range-row">\n                      <span>Games</span><strong>{games}</strong>\n                    </div>\n                    <div className="v3-game-count-control">\n                      <button\n                        type="button"\n                        aria-label="Remove one game"\n                        onClick={() => { setMode("games"); setGames((current) => Math.max(2, current - 1)); }}\n                      >−</button>\n                      <input\n                        aria-label="Number of games"\n                        type="number"\n                        inputMode="numeric"\n                        min={2}\n                        max={50}\n                        value={games}\n                        onChange={(event) => {\n                          const next = Number(event.target.value);\n                          if (!Number.isFinite(next)) return;\n                          setMode("games");\n                          setGames(Math.max(2, Math.min(50, Math.round(next))));\n                        }}\n                      />\n                      <button\n                        type="button"\n                        aria-label="Add one game"\n                        onClick={() => { setMode("games"); setGames((current) => Math.min(50, current + 1)); }}\n                      >+</button>\n                    </div>\n                    <div className="v3-game-count-presets">\n                      {[5, 10, 20, 30, 50].map((count) => (\n                        <button\n                          key={count}\n                          type="button"\n                          className={mode === "games" && games === count ? "is-active" : ""}\n                          onClick={() => { setMode("games"); setGames(count); }}\n                        >{count}</button>\n                      ))}\n                    </div>\n                  </details>`;

patch(component, [[oldGameControl, newGameControl]]);
console.log("[ui-v3] V3 styling hooks and expanded game count ready");
