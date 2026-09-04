import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { geminiModels } from "./gemini-models.ts";

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
