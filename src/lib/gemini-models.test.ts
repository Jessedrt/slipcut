import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  geminiFailure,
  geminiModels,
  geminiStatusDetail,
} from "./gemini-models.ts";

/**
 * Gemini model selection is pure config; these tests guard it.
 *
 * Google switches model endpoints off on a published schedule. When that
 * happens the desk does not crash — the 404 is swallowed and the engine is
 * silently skipped, so slips go out un-researched while every dashboard still
 * says Gemini is configured. These tests are the tripwire.
 */
const SWITCHED_OFF = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
];

describe("gemini model chain", () => {
  it("never falls back to a model Google has switched off", () => {
    for (const model of geminiModels()) {
      assert.ok(!SWITCHED_OFF.includes(model), `${model} is switched off`);
    }
  });

  it("leads with the newest stable flash", () => {
    assert.equal(geminiModels()[0], "gemini-3.8-flash");
  });

  it("keeps a live cheap fallback at the end", () => {
    const chain = geminiModels();
    assert.ok(chain.length >= 2);
    assert.ok(chain.at(-1)!.includes("flash"));
  });

  it("lets GEMINI_MODEL override the whole chain", () => {
    const chain = geminiModels({ GEMINI_MODEL: "gemini-3.1-pro-preview" } as NodeJS.ProcessEnv);
    assert.equal(chain[0], "gemini-3.1-pro-preview");
    // The defaults still sit behind it, so a broken override degrades instead of dying.
    assert.ok(chain.length > 1);
  });

  it("ignores a blank override and drops duplicates", () => {
    assert.equal(geminiModels({ GEMINI_MODEL: "   " } as NodeJS.ProcessEnv)[0], "gemini-3.8-flash");
    const chain = geminiModels({ GEMINI_MODEL: "gemini-3.8-flash" } as NodeJS.ProcessEnv);
    assert.equal(chain.filter((m) => m === "gemini-3.8-flash").length, 1);
  });

  it("never returns an empty chain", () => {
    assert.ok(geminiModels({}).length > 0);
  });
});

// ---- transport policy ----------------------------------------------------

it("an invalid key is fatal, so the caller moves to the next key", () => {
  assert.equal(geminiFailure(401, "API key not valid. Please pass a valid API key."), "key");
  assert.equal(geminiFailure(403, "the caller does not have permission"), "key");
});

it("a model the key cannot use is not fatal — the next model may work", () => {
  assert.equal(
    geminiFailure(403, "models/gemini-3.8-flash is not found for API version v1beta"),
    "model",
  );
  assert.equal(geminiFailure(404, "models/gemini-1.5-flash is not found"), "model");
  assert.equal(geminiFailure(403, "models/gemini-3-pro-preview is not supported"), "model");
});

it("quota and outages are their own kind", () => {
  assert.equal(geminiFailure(429, "Quota exceeded for quota metric"), "quota");
  assert.equal(geminiFailure(503, "The model is overloaded."), "server");
  assert.equal(geminiFailure(0, "fetch failed"), "network");
});

it("status text tells the desk user what to do", () => {
  assert.equal(geminiStatusDetail(429, "gemini-3.8-flash", "quota"), "rate limited — free tier quota");
  assert.equal(
    geminiStatusDetail(403, "gemini-3.8-flash", "model"),
    "gemini-3.8-flash: not served to this key",
  );
  assert.equal(geminiStatusDetail(401, "gemini-3.8-flash", "key"), "key rejected (401)");
  assert.equal(geminiStatusDetail(0, "gemini-3.8-flash", "network"), "network error");
});
