import test from "node:test";
import assert from "node:assert/strict";
import {
  RULE,
  bullets,
  cap,
  codeBlock,
  doc,
  esc,
  glyph,
  head,
  leg,
  mono,
  pct,
  pre,
  stat,
  stats,
  subhead,
  table,
  tail,
} from "./tg-format.ts";

test("every value is html-escaped before it reaches telegram", () => {
  assert.equal(esc("Arsenal & Co <b>"), "Arsenal &amp; Co &lt;b&gt;");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
});

test("glyphs are hold, watch, cut — and never emoji", () => {
  assert.equal(glyph(70), "✓");
  assert.equal(glyph(50), "·");
  assert.equal(glyph(20), "×");
  for (const g of [glyph(70), glyph(50), glyph(20)]) {
    assert.equal(/\p{Extended_Pictographic}/u.test(g), false);
  }
});

test("a headline is the label plus whatever it is about", () => {
  assert.equal(head("READ"), "<b>READ</b>");
  assert.equal(head("READ", "9 selections"), "<b>READ</b>  9 selections");
  assert.equal(head("READ", "", null, "9 selections"), "<b>READ</b>  9 selections");
});

test("mono wraps numbers in code so columns align", () => {
  assert.equal(mono("62%"), "<code>62%</code>");
  assert.equal(mono("1 & 2"), "<code>1 &amp; 2</code>");
});

test("stat pairs a label with a monospaced value", () => {
  assert.equal(stat("true", "38%"), "true  <code>38%</code>");
});

test("stats pads labels into one column", () => {
  const out = stats([
    ["true", "38%"],
    ["price", "12.4×"],
    ["EV", "+6.2%"],
  ]);
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  // Every value starts at the same column.
  const columns = lines.map((l) => l.indexOf("<code>"));
  assert.equal(new Set(columns).size, 1);
  assert.match(out, /true {3}<code>38%<\/code>/);
});

test("a leg is two lines: the fixture, then what we judged", () => {
  const out = leg(1, "Arsenal v Chelsea", "Over 2.5  1.85×  62%", "✓");
  assert.equal(out, "01  Arsenal v Chelsea\n    Over 2.5  1.85×  62%  ✓");
});

test("leg indices are zero padded so 10 lines up with 9", () => {
  assert.equal(leg(9, "A", "b").startsWith("09"), true);
  assert.equal(leg(10, "A", "b").startsWith("10"), true);
});

test("bullets drop blanks and escape content", () => {
  assert.equal(bullets(["Form strong", "", null, "Rain & wind"]), "– Form strong\n– Rain &amp; wind");
  assert.equal(bullets([]), "");
});

test("the tail carries provenance and is always dim", () => {
  assert.equal(tail("gemini + market", "4 Sep 14:22"), "<i>gemini + market  ·  4 Sep 14:22</i>");
  assert.equal(tail("", null), "");
});

test("doc joins blocks and drops empty ones", () => {
  assert.equal(doc("a", "", null, "b"), "a\n\nb");
});

test("cap keeps the message inside telegram's limit", () => {
  assert.equal(cap("short"), "short");
  const cut = cap("x".repeat(500), 100);
  assert.equal(cut.length, 100);
  assert.equal(cut.endsWith("…"), true);
});

test("a booking code is monospaced so it is easy to copy by eye", () => {
  assert.equal(codeBlock("AB-CD"), "<code>AB-CD</code>");
});

test("subheads are lowercase and the rule is a plain rule", () => {
  assert.equal(subhead("Wahala"), "<b>wahala</b>");
  assert.equal(RULE.length > 0, true);
  assert.equal(/\p{Extended_Pictographic}/u.test(RULE), false);
});

test("percentages are rounded, not stretched to decimals", () => {
  assert.equal(pct(61.7), "62%");
});

test("table pads every column and wraps the lot in a monospace block", () => {
  const out = table(
    ["bucket", "said", "landed", "legs"],
    [
      ["0–25%", "18%", "20%", "14"],
      ["25–50%", "38%", "40%", "52"],
    ],
  );
  assert.match(out, /^<pre>/);
  assert.match(out, /<\/pre>$/);
  const body = out.slice(5, -6).split("\n");
  assert.equal(body.length, 3);
  assert.equal(body[0], "bucket  said  landed  legs");
  assert.equal(body[1], "0–25%   18%   20%     14");
  assert.equal(body[2], "25–50%  38%   40%     52");
});

test("pre escapes what it wraps", () => {
  assert.equal(pre(["a & b"]), "<pre>a &amp; b</pre>");
});

test("table survives ragged rows", () => {
  const out = table(["a", "b"], [["1"]]);
  assert.equal(out, "<pre>a  b\n1</pre>");
});
