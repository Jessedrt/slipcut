import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  clampLegs,
  clampOddsTarget,
  cmdArg,
  codeFromText,
  escapeHtml,
  htmlToPlain,
  isCmd,
  looksLikeShareCode,
  normalizeFilter,
  parseBlock,
  parseCombineCode,
  parseCookWindow,
  parseDropIndexes,
  parseLegCount,
  parseOddsBand,
  parseOddsTarget,
  parseSport,
  parseStake,
  wantsDraw,
  wantsLive,
  wantsMix,
} from "./intent.ts";

describe("commands", () => {
  it("matches slash commands with and without bot suffix", () => {
    assert.equal(isCmd("/today", "today"), true);
    assert.equal(isCmd("/today@SlipCutBot football", "today"), true);
    assert.equal(isCmd("today", "today"), true);
    assert.equal(isCmd("/todays", "today"), false);
    assert.equal(isCmd("\u200b/help", "help"), true);
  });
  it("extracts the command argument", () => {
    assert.equal(cmdArg("/filter EPL"), "EPL");
    assert.equal(cmdArg("/filter@Bot  la liga"), "la liga");
    assert.equal(cmdArg("/filter"), "");
  });
  it("strips zero-width characters", () => {
    assert.equal(cleanText("\u200bABC12\u2060"), "ABC12");
  });
});

describe("share codes", () => {
  it("accepts real-looking codes", () => {
    assert.equal(looksLikeShareCode("A7K2QP"), true);
    assert.equal(codeFromText("  a7k2qp "), "A7K2QP");
    assert.equal(codeFromText("A7K2QP · 12 games"), "A7K2QP");
  });
  it("rejects command words that fit the code shape", () => {
    for (const w of ["today", "score", "LOCK", "grant", "draws", "stake", "help", "only"]) {
      assert.equal(looksLikeShareCode(w), false, w);
      assert.equal(codeFromText(w), null, w);
    }
  });
  it("finds combine targets", () => {
    assert.equal(parseCombineCode("combine with X9Y8Z7"), "X9Y8Z7");
    assert.equal(parseCombineCode("join am with code Q1W2E3"), "Q1W2E3");
    assert.equal(parseCombineCode("add today"), null);
  });
});

describe("numbers", () => {
  it("parses stakes with units", () => {
    assert.equal(parseStake("stake 2000"), 2000);
    assert.equal(parseStake("stake 2k"), 2000);
    assert.equal(parseStake("5k stake"), 5000);
    assert.equal(parseStake("stake 1.5m"), 1_500_000);
    assert.equal(parseStake("stake ₦500"), 500);
  });
  it("does not treat odds targets as money", () => {
    assert.equal(parseStake("stake 2 odds"), null);
    assert.equal(parseStake("stake 10x"), null);
    assert.equal(parseStake("cook 10 odds"), null);
  });
  it("parses odds targets", () => {
    assert.equal(parseOddsTarget("10 odds football"), 10);
    assert.equal(parseOddsTarget("like 30odds"), 30);
    assert.equal(parseOddsTarget("30 odds"), 30);
    assert.equal(parseOddsTarget("5x mix"), 5);
    assert.equal(parseOddsTarget("12 games football"), null);
  });
  it("parses leg counts", () => {
    assert.equal(parseLegCount("12 games football"), 12);
    assert.equal(parseLegCount("sure 3 legs"), 3);
    assert.equal(parseLegCount("cook 8 football over 2.5"), 8);
    assert.equal(parseLegCount("10 odds football"), null);
    assert.equal(parseLegCount("8 draw"), 8);
  });
  it("clamps", () => {
    assert.equal(clampLegs(999, 5), 35);
    assert.equal(clampLegs(NaN, 5), 5);
    assert.equal(clampLegs(0, 5), 1);
    assert.equal(clampOddsTarget(1), 1.5);
    assert.equal(clampOddsTarget(NaN), 20);
  });
  it("parses odds bands", () => {
    assert.deepEqual(parseOddsBand("between 1.3 and 1.8"), { min: 1.3, max: 1.8 });
    assert.deepEqual(parseOddsBand("between 1.8 and 1.3"), { min: 1.3, max: 1.8 });
    assert.deepEqual(parseOddsBand("no game above 1.7"), { min: 1.05, max: 1.7 });
    assert.deepEqual(parseOddsBand("min odds 1.4"), { min: 1.4, max: 6 });
    assert.equal(parseOddsBand("12 games football"), null);
  });
});

describe("sport, window, flags", () => {
  it("detects sport incl. pidgin", () => {
    assert.equal(parseSport("bola"), "football");
    assert.equal(parseSport("hoop"), "basketball");
    assert.equal(parseSport("wta tonight"), "tennis");
    assert.equal(parseSport("12 games"), null);
  });
  it("detects windows", () => {
    assert.equal(parseCookWindow("weekend mix"), "weekend");
    assert.equal(parseCookWindow("today football"), "today");
    assert.equal(parseCookWindow("tonight bola"), "today");
    assert.equal(parseCookWindow("2 weeks 12 games"), "fortnight");
    assert.equal(parseCookWindow("longshot"), "week");
    assert.equal(parseCookWindow("12 games"), "soon");
  });
  it("detects flags", () => {
    assert.equal(wantsMix("cook 20 odds mix"), true);
    assert.equal(wantsLive("score"), true);
    assert.equal(wantsLive("how e dey play"), true);
    assert.equal(wantsDraw("8 draw"), true);
    assert.equal(wantsDraw("draw no bet"), false);
  });
});

describe("blocks and filters", () => {
  it("parses block intents", () => {
    assert.deepEqual(parseBlock("no Palace"), { add: "Palace" });
    assert.deepEqual(parseBlock("block women"), { add: "women" });
    assert.deepEqual(parseBlock("allow Palace"), { remove: "Palace" });
    assert.deepEqual(parseBlock("blacklist"), { list: true });
    assert.equal(parseBlock("no game above 1.7"), null);
    assert.equal(parseBlock("no football"), null);
    assert.equal(parseBlock("no wahala"), null);
  });
  it("normalizes filters", () => {
    assert.equal(normalizeFilter("EPL"), "premier league");
    assert.equal(normalizeFilter("la liga"), "laliga");
    assert.equal(normalizeFilter("UCL"), "champions league");
    assert.equal(normalizeFilter("clear"), "clear");
    assert.equal(normalizeFilter("ab"), null);
  });
  it("parses drop indexes", () => {
    assert.deepEqual(parseDropIndexes("drop game 3 and 8"), [3, 8]);
    assert.deepEqual(parseDropIndexes("comot 1, 2, 2"), [1, 2]);
    assert.equal(parseDropIndexes("12 games football"), null);
  });
});

describe("html", () => {
  it("escapes for Telegram HTML mode", () => {
    assert.equal(escapeHtml("A & B <C>"), "A &amp; B &lt;C&gt;");
  });
  it("converts to WhatsApp plain text", () => {
    assert.equal(htmlToPlain("<b>Hi</b> <code>AB12</code> &amp; you"), "*Hi* AB12 & you");
  });
});
