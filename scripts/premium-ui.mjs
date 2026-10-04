#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, from, to, label, required = true) {
  let source = readFileSync(path, "utf8");
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return;
  }
  if (!source.includes(from)) {
    if (required) throw new Error(`${label}: expected source not found in ${path}`);
    console.log(`${label}: skipped`);
    return;
  }
  source = source.replace(from, to);
  writeFileSync(path, source);
  console.log(`${label}: applied`);
}

const component = "src/components/mini-app-refresh.tsx";

replaceOnce(
  "src/styles.css",
  '@import "tailwindcss";',
  '@import "tailwindcss";\n@import "./premium-ui.css";',
  "premium stylesheet import",
);

replaceOnce(
  component,
  `const panel =\n  "rounded-[22px] border border-[#7b5439]/16 bg-[#fffdfa] p-4 shadow-[0_18px_45px_-32px_rgba(82,50,31,.32)]";\nconst field =\n  "w-full rounded-xl border border-[#7b5439]/20 bg-white px-3 py-3 text-[15px] text-[#352317] outline-none placeholder:text-[#a88f7d] focus:border-[#8b5e3c] focus-visible:ring-2 focus-visible:ring-[#8b5e3c]/15";\nconst primary =\n  "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6b452d] px-4 py-3 text-sm font-extrabold text-white transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45";\nconst secondary =\n  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#7b5439]/18 bg-[#f3e7dc] px-3 py-2.5 text-sm font-semibold text-[#5d3d29] transition active:scale-[.99] disabled:opacity-45";`,
  `const panel = "premium-panel";\nconst field = "premium-field";\nconst primary = "premium-primary";\nconst secondary = "premium-secondary";`,
  "premium primitives",
);

replaceOnce(
  component,
  '      className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-[#7b5439]/12 bg-[#efe2d6] p-1"',
  '      className="premium-segmented"',
  "segmented shell",
);
replaceOnce(
  component,
  '          className={`min-h-10 rounded-lg px-2 text-xs font-bold transition ${value === option.value ? "bg-[#6b452d] text-white shadow-sm" : "text-[#7d6553]"}`}',
  '          className={`premium-segmented-button ${value === option.value ? "is-active" : ""}`}',
  "segmented buttons",
);

replaceOnce(
  component,
  '      className={`rounded-2xl border p-3 transition ${selected ? "border-[#8b5e3c]/35 bg-[#fffdfa] shadow-[0_14px_34px_-28px_rgba(82,50,31,.45)]" : "border-[#9a7d59]/20 bg-[#f4ece4]"}`}',
  '      className={`premium-selection ${selected ? "is-selected" : "is-muted"}`}',
  "selection card shell",
);
replaceOnce(
  component,
  '          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${selected ? "border-[#7a4f33] bg-[#7a4f33] text-white" : "border-[#a78a73] bg-[#efe2d6] text-[#7a5d49]"}`}',
  '          className={`premium-check ${selected ? "is-selected" : ""}`}',
  "selection toggle",
);

replaceOnce(
  component,
  '    <div className="mini-app min-h-dvh bg-[#f6efe8] text-[#2f2118]">',
  '    <div className="mini-app premium-app">',
  "premium app shell",
);
replaceOnce(
  component,
  '        className="mx-auto min-h-dvh max-w-lg px-3 pb-28"',
  '        className="premium-shell"',
  "premium main shell",
);

replaceOnce(
  component,
  `        <header className="mb-4 flex items-center justify-between gap-3 px-1">\n          <div>\n            <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8d6d56]">\n              Multi-bookmaker betting desk\n            </p>\n            <h1 className="mt-1 text-[27px] font-black leading-none tracking-[-.055em]">\n              Slip<span className="text-[#7a4f33]">Cut.</span>\n            </h1>\n          </div>\n          <button\n            type="button"\n            onClick={openBot}\n            className={\`\${secondary} min-h-10 rounded-full px-3 text-xs\`}\n          >\n            @slipcut_bot\n          </button>\n        </header>`,
  `        <header className="premium-header">\n          <div>\n            <h1 className="premium-wordmark">Slip<span>Cut.</span></h1>\n            <p className="premium-tagline">Smarter slips. Better decisions.</p>\n          </div>\n          <button type="button" onClick={openBot} className="premium-bot-chip">\n            @slipcut_bot\n          </button>\n        </header>`,
  "premium header",
);

replaceOnce(
  component,
  '          <div className="mb-3 flex gap-2 rounded-xl border border-[#9b6f4e]/20 bg-[#f3e5d8] p-3 text-xs leading-5 text-[#6f4d35]">',
  '          <div className="premium-notice">',
  "telegram notice",
);

replaceOnce(
  component,
  `              <div className="mb-4 flex items-center justify-between">\n                <div>\n                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">\n                    New slip\n                  </p>\n                  <h2 className="mt-1 text-lg font-extrabold">Build with mathematics</h2>\n                </div>\n                <Sparkles className="h-5 w-5 text-[#7a4f33]" />\n              </div>`,
  `              <div className="premium-section-heading">\n                <div>\n                  <small>New slip</small>\n                  <h2>Build your slip</h2>\n                </div>\n                <Sparkles className="h-5 w-5 text-[#7a4f33]" />\n              </div>`,
  "build heading",
);

replaceOnce(
  component,
  '                    <div className="grid grid-cols-5 gap-1">',
  '                    <div className="premium-odds-grid">',
  "odds preset grid",
);
replaceOnce(
  component,
  '                          className={`min-h-10 rounded-lg text-xs font-bold ${!customOdds.trim() && targetOdds === odds ? "bg-[#e1b678] text-[#21170e]" : "bg-[#15120e] text-[#bba98f]"}`}',
  '                          className={`premium-odds-chip ${!customOdds.trim() && targetOdds === odds ? "is-active" : ""}`}',
  "odds preset chips",
);

replaceOnce(
  component,
  '                  <div className="grid grid-cols-4 gap-1 rounded-xl border border-[#7b5439]/12 bg-[#efe2d6] p-1">',
  '                  <div className="premium-time-grid">',
  "time filter grid",
);
replaceOnce(
  component,
  '                        className={`min-h-10 rounded-lg px-1 text-[11px] font-bold capitalize ${windowChoice === item ? "bg-[#6b452d] text-white shadow-sm" : "text-[#7d6553]"}`}',
  '                        className={`premium-time-chip ${windowChoice === item ? "is-active" : ""}`}',
  "time filter chips",
);
replaceOnce(
  component,
  '{pending === "build" ? STAGES[stage] : "Build & analyse"}',
  '{pending === "build" ? STAGES[stage] : "Find best games"}',
  "build CTA copy",
);

replaceOnce(
  component,
  '<h2 className="mt-1 text-lg font-extrabold">Analyse and cut a slip</h2>',
  '<h2 className="mt-1 text-xl font-black tracking-[-.04em]">Cut / Trim Slip</h2>',
  "cut heading",
);
replaceOnce(
  component,
  '{pending === "cut" ? "Analysing real code…" : "Analyse & cut"}',
  '{pending === "cut" ? "Analysing real code…" : "Analyse & Cut"}',
  "cut CTA copy",
);

replaceOnce(
  component,
  `type EngineCard = {\n  n: number;\n  code: string;`,
  `type EngineCard = {\n  n: number;\n  targetOdds?: number;\n  targetReached?: boolean;\n  code: string;`,
  "engine ladder type",
);
replaceOnce(
  component,
  `                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">\n                    Accuracy-led\n                  </p>\n                  <h2 className="mt-1 text-xl font-black tracking-[-.04em]">Engine Accumulators</h2>\n                  <p className="mt-2 text-xs leading-5 text-[#7a6656]">\n                    {engineSport === "football" ? "Football cards use eligible single markets." : "Basketball cards use Over markets."}\n                    {" "}Each selection uses Conservative odds of 1.20–1.40 and verified statistics.\n                    Equally scored options favour variety; stronger markets may repeat.\n                    Longer cards are still longer shots.\n                  </p>`,
  `                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">\n                    Daily ladders\n                  </p>\n                  <h2 className="mt-1 text-2xl font-black tracking-[-.05em]">Engine</h2>\n                  <p className="mt-2 text-xs leading-5 text-[#7a6656]">\n                    {engineSport === "football" ? "Qualified football single markets." : "Qualified basketball Over markets."}\n                    {" "}Cards are built independently from 1.20–1.40 selections.\n                  </p>`,
  "engine heading",
);
replaceOnce(
  component,
  '<article key={card.code} className={panel}>',
  '<article key={card.code} className="premium-engine-card">',
  "engine card shell",
);
replaceOnce(
  component,
  `                      <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#8f694e]">\n                        Card {index + 1} · {card.n}-leg ladder\n                      </p>`,
  `                      <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#8f694e]">\n                        {card.targetOdds ? \`\${card.targetOdds}× Ladder\` : \`Card \${index + 1}\`} · {card.n} legs\n                      </p>`,
  "engine ladder label",
);
replaceOnce(
  component,
  '                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl border border-[#7b5439]/10 bg-[#fbf7f2] p-3">',
  '                    <div className="premium-engine-legs space-y-2">',
  "engine legs shell",
);
replaceOnce(
  component,
  '                      {card.legs.slice(0, 6).map((leg, legIndex) => (',
  '                      {card.legs.slice(0, 4).map((leg, legIndex) => (',
  "engine compact legs",
);

replaceOnce(
  component,
  '        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-[#7b5439]/15 bg-[#fffaf8]/95 px-3 pt-2 backdrop-blur-xl"',
  '        className="premium-nav"',
  "premium bottom nav",
);
replaceOnce(
  component,
  '        <div className="grid grid-cols-4 gap-1">',
  '        <div className="premium-nav-grid">',
  "premium nav grid",
);
replaceOnce(
  component,
  '              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold transition ${tab === id ? "bg-[#6b452d] text-white shadow-sm" : "text-[#8a735f]"}`}',
  '              className={`premium-nav-button ${tab === id ? "is-active" : ""}`}',
  "premium nav buttons",
);

console.log("SlipCut premium UI patch complete");
