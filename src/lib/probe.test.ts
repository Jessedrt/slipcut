import test from "node:test";
import assert from "node:assert/strict";
import { formatProbe, researchCallsPerSlip, type ProbeResult } from "./probe.ts";

const base: ProbeResult = { engine: "gemini", keys: 1, ok: true, model: "", detail: "ok", ms: 1800 };

test("a live engine reports the model that answered and its latency", () => {
  const out = formatProbe([{ ...base, model: "gemini-3.8-flash" }]);
  assert.match(out, /✅ gemini live · gemini-3\.8-flash · 1\.8s · 1 key/);
});

test("the model is not repeated when it is the engine name", () => {
  const out = formatProbe([{ ...base, engine: "you.com", model: "you.com" }]);
  assert.match(out, /✅ you\.com live · 1\.8s/);
  assert.doesNotMatch(out, /you\.com · you\.com/);
});

test("an engine with no key is neutral, not a failure", () => {
  const out = formatProbe([{ ...base, keys: 0, ok: false, detail: "no key" }]);
  assert.match(out, /➖ gemini — no key/);
  assert.doesNotMatch(out, /❌/);
});

test("a keyed engine that fails shows the reason a human can act on", () => {
  const out = formatProbe([
    { ...base, ok: false, detail: "rate limited — free tier quota", ms: 300 },
  ]);
  assert.match(out, /❌ gemini no answer — rate limited — free tier quota · 1 key/);
});

test("pluralise the key count", () => {
  const out = formatProbe([{ ...base, keys: 3 }]);
  assert.match(out, /3 keys/);
});

test("verdict names the engines that answered", () => {
  const out = formatProbe([
    { ...base, ok: true },
    { ...base, engine: "you.com", ok: true },
    { ...base, engine: "opus", keys: 0, ok: false, detail: "no key" },
  ]);
  assert.match(out, /gemini \+ you\.com dey answer/);
});

test("verdict warns when every keyed engine failed", () => {
  const out = formatProbe([
    { ...base, ok: false, detail: "key rejected (401)" },
    { ...base, engine: "opus", keys: 0, ok: false, detail: "no key" },
  ]);
  assert.match(out, /No engine answer/);
  assert.match(out, /market read only/);
});

test("verdict tells you how to fix an empty desk", () => {
  const out = formatProbe([
    { ...base, keys: 0, ok: false },
    { ...base, engine: "opus", keys: 0, ok: false },
  ]);
  assert.match(out, /No key set\. Add one: \/key gemini/);
});

test("call count is one request per chunk, capped at the 18-pick shortlist", () => {
  assert.equal(researchCallsPerSlip(18), 6);
  assert.equal(researchCallsPerSlip(7), 3);
  assert.equal(researchCallsPerSlip(1), 1);
  // A 40-selection ticket still only researches the shortlist.
  assert.equal(researchCallsPerSlip(40), 6);
  assert.equal(researchCallsPerSlip(0), 1);
});
