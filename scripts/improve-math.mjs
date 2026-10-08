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

function replaceBetween(path, start, end, replacement, label, sentinel) {
  let source = readFileSync(path, "utf8");
  if (sentinel && source.includes(sentinel)) {
    console.log(`${label}: already applied`);
    return;
  }
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`${label}: start marker not found in ${path}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`${label}: end marker not found in ${path}`);
  source = source.slice(0, from) + replacement + source.slice(to);
  writeFileSync(path, source);
  console.log(`${label}: applied`);
}

const evidence = "src/lib/selection-evidence.ts";
const workbench = "src/lib/workbench.ts";
const engine = "src/lib/engine.ts";

replaceOnce(
  evidence,
  'import { normalizeName } from "./bookmakers/normalize";\n',
  'import { normalizeName } from "./bookmakers/normalize";\nimport { mathematicalSelectionScore, robustHitScore, robustOverModel } from "./selection-math";\n',
  "robust math import",
);

replaceOnce(
  evidence,
  `  const smallestSample = Math.min(...stats.map((s) => s.sample));\n  const rawHitScore = 100 * Math.min(...stats.map((s) => s.hitRate));\n  const sampleConfidence = Math.min(1, smallestSample / 5);\n  const hitScore = 50 + (rawHitScore - 50) * sampleConfidence;\n  let score = Math.round(hitScore);`,
  `  const smallestSample = Math.min(...stats.map((s) => s.sample));\n  // Robust hit strength uses recency weighting, Bayesian shrinkage and a Wilson\n  // confidence floor so tiny perfect samples cannot masquerade as certainty.\n  const robustHit = robustHitScore(stats, line);\n  const hitScore = robustHit.score;\n  let score = hitScore;`,
  "robust hit scoring",
);

replaceOnce(
  evidence,
  '    const math = projectedOverProbability(stats, line);\n    const implied = pick.odds && pick.odds > 1 ? 1 / pick.odds : 1;\n    const probabilityEdge = math.probability - implied;',
  '    const math = robustOverModel(stats, line, pick.odds);\n    const implied = math.impliedProbability;\n    const probabilityEdge = math.valueEdge;',
  "robust over projection",
);

replaceOnce(
  evidence,
  `    const projectionScore = Math.max(0, Math.min(100, 50 + 10 * (math.edge / Math.max(1, stats[0]!.deviation))));\n    const valueScore = Math.max(0, Math.min(100, 50 + 250 * probabilityEdge));\n    score = Math.round(0.45 * hitScore + 0.4 * projectionScore + 0.15 * valueScore);`,
  `    // Probability, hit strength, robust line edge, stability and price value\n    // all contribute. Conservative mode deliberately gives price value the\n    // smallest weight so low odds alone never become a confidence signal.\n    score = mathematicalSelectionScore(math, risk);`,
  "multi-factor mathematical score",
);

let source = readFileSync(evidence, "utf8");
const oldNote = /    mathNote = ` Mathematical projection .*?`;\n/;
if (source.includes("recency-weighted hit")) {
  console.log("explainable math note: already applied");
} else if (oldNote.test(source)) {
  source = source.replace(
    oldNote,
    '    mathNote = ` Mathematical projection ${math.projection.toFixed(1)} vs line ${line.toFixed(1)} (edge ${math.edge >= 0 ? "+" : ""}${math.edge.toFixed(1)}, ${math.edgeSigma.toFixed(2)} robust-sigma); estimated Over probability ${(100 * math.probability).toFixed(0)}%, recency-weighted hit ${(100 * math.recencyRate).toFixed(0)}%, Bayesian hit ${(100 * math.bayesianRate).toFixed(0)}%, confidence floor ${(100 * math.confidenceFloor).toFixed(0)}%, odds-implied ${(100 * implied).toFixed(0)}%.`;\n',
  );
  writeFileSync(evidence, source);
  console.log("explainable math note: applied");
} else {
  throw new Error("explainable math note: expected source not found");
}

replaceBetween(
  workbench,
  'export function buildToOdds<T extends { odds?: number; modelScore?: number; probability?: number }>',
  'export function formatEv',
  `export function buildToOdds<T extends { odds?: number; modelScore?: number; probability?: number }>(picks: T[], target: number): T[] {\n  const cap = Math.max(1.2, Math.min(5000, target));\n  const pool = picks\n    .filter((p) => p.odds && p.odds > 1.08 && p.odds < 8)\n    .slice(0, 28);\n  if (!pool.length) return [];\n\n  // Once a subset is already inside the requested ±5% target band, prefer the\n  // mathematically stronger card instead of chasing a cosmetically closer price.\n  // Outside that band, distance still leads so high targets remain reachable.\n  type State = { indexes: number[]; product: number; strength: number; weakest: number };\n  const closeness = (product: number) => Math.abs(Math.log(product / cap));\n  const tolerance = Math.log(1.05);\n  const qualityOf = (pick: T) => {\n    const raw = Number.isFinite(pick.modelScore)\n      ? Number(pick.modelScore)\n      : Number.isFinite(pick.probability)\n        ? Number(pick.probability)\n        : 50;\n    // score=0 is the explicit market-only sentinel; keep it usable as a last\n    // resort but make it substantially weaker than evidence-qualified legs.\n    return Math.max(raw > 0 ? 30 : 18, Math.min(98, raw));\n  };\n  const quality = (state: State) => {\n    if (!state.indexes.length) return 0;\n    const average = state.strength / state.indexes.length;\n    return 0.7 * average + 0.3 * state.weakest;\n  };\n  const compareStates = (a: State, b: State) => {\n    const da = closeness(a.product);\n    const db = closeness(b.product);\n    const aInBand = a.indexes.length > 0 && da <= tolerance;\n    const bInBand = b.indexes.length > 0 && db <= tolerance;\n    if (aInBand !== bInBand) return aInBand ? -1 : 1;\n    if (aInBand && bInBand) {\n      const q = quality(b) - quality(a);\n      if (Math.abs(q) > 0.15) return q;\n      if (Math.abs(da - db) > 0.003) return da - db;\n      return a.indexes.length - b.indexes.length;\n    }\n    if (Math.abs(da - db) > 0.008) return da - db;\n    const q = quality(b) - quality(a);\n    return Math.abs(q) > 0.15 ? q : a.indexes.length - b.indexes.length;\n  };\n\n  let states: State[] = [{ indexes: [], product: 1, strength: 0, weakest: 100 }];\n  for (let index = 0; index < pool.length; index++) {\n    const pick = pool[index]!;\n    const odds = pick.odds!;\n    const pickQuality = qualityOf(pick);\n    const next = states.slice();\n    for (const state of states) {\n      if (state.indexes.length >= 15) continue;\n      const product = state.product * odds;\n      if (state.indexes.length && product > cap * 1.25) continue;\n      next.push({\n        indexes: [...state.indexes, index],\n        product,\n        strength: state.strength + pickQuality,\n        weakest: Math.min(state.weakest, pickQuality),\n      });\n    }\n    next.sort(compareStates);\n    states = next.slice(0, 8000);\n  }\n\n  const best = states.filter((state) => state.indexes.length).sort(compareStates)[0];\n  return best ? best.indexes.map((index) => pool[index]!) : [];\n}\n\n`,
  "quality-first target odds optimizer",
  "mathematically stronger card instead of chasing",
);

replaceOnce(
  engine,
  'const ENGINE_POLICY_VERSION = "odds-target-ladder-v7";',
  'const ENGINE_POLICY_VERSION = "odds-target-ladder-v8-robust-math";',
  "engine cache version",
  false,
);

console.log("SlipCut robust mathematical selection model applied");
