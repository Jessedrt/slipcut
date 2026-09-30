import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Build renders one target preset group with unique displayed values", () => {
  const source = readFileSync(new URL("../src/components/mini-app-refresh.tsx", import.meta.url), "utf8");
  const definition = source.match(/const ODDS_PRESETS = (\[[\d,\s.]+\]);/);
  assert.ok(definition, "Target presets must have an inspectable numeric definition");
  const presets = JSON.parse(definition[1]);
  const labels = presets.map((value) => value.toFixed(2));
  assert.equal(new Set(labels).size, labels.length, "Duplicate target buttons must never render");
  assert.equal((source.match(/ODDS_PRESETS\.map\(/g) ?? []).length, 1, "Render the target presets once");
  assert.deepEqual(presets, [2, 3, 5, 10, 20]);
});
