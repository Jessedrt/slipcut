#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

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

const engine = "src/lib/engine.ts";
const route = "server/routes/api/engine.get.ts";
const component = "src/components/mini-app-refresh.tsx";

replaceOnce(
  engine,
  'export type EngineSport = "football" | "basketball";\ntype EngineScope = EngineSport | "all";',
  'export type EngineSport = "football" | "basketball";\nexport type EngineWindow = Extract<CookWindow, "today" | "tomorrow" | "weekend" | "upcoming">;\ntype EngineScope = EngineSport | "all";',
  "engine window type",
);

replaceOnce(
  engine,
  'async function poolForEngine(\n  sport: EngineScope = "all",\n): Promise<TicketPick[] | { error: string }> {',
  'async function poolForEngine(\n  sport: EngineScope = "all",\n  window: EngineWindow = "today",\n): Promise<TicketPick[] | { error: string }> {',
  "engine pool window signature",
);
replaceOnce(
  engine,
  '  let listed = await discoverEngineMarkets("today" as CookWindow, skip, sport);',
  '  let listed = await discoverEngineMarkets(window, skip, sport);',
  "engine window discovery",
);
replaceOnce(
  engine,
  '  if (uniqueEvents(listed).picks.length < ENGINE_MAX_LEGS) {',
  '  if (window === "today" && uniqueEvents(listed).picks.length < ENGINE_MAX_LEGS) {',
  "today fallback only",
);
replaceOnce(
  engine,
  'export async function buildEngineCards(\n  sport: EngineScope = "all",\n): Promise<EngineCard[] | { error: string }> {\n  const ranked = await poolForEngine(sport);',
  'export async function buildEngineCards(\n  sport: EngineScope = "all",\n  window: EngineWindow = "today",\n): Promise<EngineCard[] | { error: string }> {\n  const ranked = await poolForEngine(sport, window);',
  "engine card window signature",
);

replaceOnce(
  engine,
  'export function engineIntro(accSample: number, average: number) {',
  'export async function engineCardsForWindow(\n  window: EngineWindow = "today",\n  sport: EngineScope = "all",\n): Promise<EngineCard[] | { error: string }> {\n  if (window === "today") return todayEngineCards(sport);\n\n  const cacheDay = `${watDay()}_${window}`;\n  const existing = await loadEngineDay(cacheDay, sport);\n  if (existing?.length) return existing;\n\n  const lockKey = `engine_build_lock_${sport}_${cacheDay}`;\n  const lockAt = Number(await getSetting(lockKey));\n  if (Number.isFinite(lockAt) && Date.now() - lockAt < 2 * 60_000) {\n    return { error: "Engine cards are being prepared. Refresh again in a moment." };\n  }\n\n  await setSetting(lockKey, String(Date.now()));\n  try {\n    const built = await buildEngineCards(sport, window);\n    if ("error" in built) return built;\n    await saveEngineDay(cacheDay, built, sport);\n    return built;\n  } finally {\n    await setSetting(lockKey, "0");\n  }\n}\n\nexport function engineIntro(accSample: number, average: number) {',
  "engine window cache",
);

replaceOnce(
  route,
  '  ENGINE_LADDER,\n  todayEngineCards,\n  type EngineSport,',
  '  ENGINE_LADDER,\n  engineCardsForWindow,\n  type EngineSport,\n  type EngineWindow,',
  "engine route imports",
);
replaceOnce(
  route,
  '}\n\nfunction scopedAccuracy(',
  '}\n\nfunction parseEngineWindow(req: Request): EngineWindow {\n  try {\n    const value = new URL(req.url).searchParams.get("window");\n    return value === "tomorrow" || value === "weekend" || value === "upcoming" ? value : "today";\n  } catch {\n    return "today";\n  }\n}\n\nfunction scopedAccuracy(',
  "engine route window parser",
);
replaceOnce(
  route,
  '  const sport = parseEngineSport(event.req);\n  try {',
  '  const sport = parseEngineSport(event.req);\n  const window = parseEngineWindow(event.req);\n  try {',
  "engine route reads window",
);
replaceOnce(
  route,
  '    const cards = await todayEngineCards(sport);',
  '    const cards = await engineCardsForWindow(window, sport);',
  "engine route loads window",
);
replaceOnce(
  route,
  '        sport,\n        cards: [],',
  '        sport,\n        window,\n        cards: [],',
  "engine route error window",
  false,
);
replaceOnce(
  route,
  '      sport,\n      cards,',
  '      sport,\n      window,\n      cards,',
  "engine route success window",
);
replaceOnce(
  route,
  '        sport,\n        cards: [],\n        hitRate: null,',
  '        sport,\n        window,\n        cards: [],\n        hitRate: null,',
  "engine route catch window",
  false,
);

replaceOnce(
  component,
  '  const [engineSport, setEngineSport] = useState<EngineSport>("football");',
  '  const [engineSport, setEngineSport] = useState<EngineSport>("football");\n  const [engineWindow, setEngineWindow] = useState<BuildWindow>("today");',
  "engine window state",
);
replaceOnce(
  component,
  '  async function loadEngine(nextSport: EngineSport = engineSport) {',
  '  async function loadEngine(\n    nextSport: EngineSport = engineSport,\n    nextWindow: BuildWindow = engineWindow,\n  ) {',
  "engine loader window signature",
);
replaceOnce(
  component,
  '      const response = await fetch(`/api/engine?sport=${nextSport}`, {',
  '      const response = await fetch("/api/engine?sport=" + nextSport + "&window=" + nextWindow, {',
  "engine window request",
);
replaceOnce(
  component,
  '          sport: nextSport,\n        });',
  '          sport: nextSport,\n          window: nextWindow,\n        });',
  "engine error window context",
  false,
);
replaceOnce(
  component,
  '    void loadEngine(nextSport);\n  }\n\n  async function copyEngineCode',
  '    void loadEngine(nextSport, engineWindow);\n  }\n\n  function changeEngineWindow(nextWindow: BuildWindow) {\n    if (nextWindow === engineWindow) return;\n    setEngineWindow(nextWindow);\n    setEngineResult(null);\n    setEngineCopied(null);\n    void loadEngine(engineSport, nextWindow);\n  }\n\n  async function copyEngineCode',
  "engine window changer",
);
replaceOnce(
  component,
  'onClick={() => void loadEngine(engineSport)}',
  'onClick={() => void loadEngine(engineSport, engineWindow)}',
  "engine refresh respects window",
);
replaceOnce(
  component,
  '            <div className="premium-engine-day">\n              <span className="is-active">Today</span>\n              <small>Fresh daily cards · sports never mix</small>\n            </div>',
  '            <div className="premium-engine-window" aria-label="Engine fixture window">\n              {(["today", "tomorrow", "weekend", "upcoming"] as BuildWindow[]).map((item) => (\n                <button\n                  key={item}\n                  type="button"\n                  onClick={() => changeEngineWindow(item)}\n                  className={engineWindow === item ? "is-active" : ""}\n                >\n                  {item}\n                </button>\n              ))}\n            </div>',
  "engine window chips",
);

replaceOnce(
  component,
  '            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Cut / Trim Slip</span>',
  '            <div className="premium-page-bar premium-page-bar-static">\n              <button type="button" className="premium-back-button" onClick={() => changeTab("build")} aria-label="Back to Build">‹</button>\n              <div>\n                <span>Cut / Trim Slip</span>',
  "cut back button",
);
replaceOnce(
  component,
  '            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Daily ladders</span>',
  '            <div className="premium-page-bar premium-page-bar-static">\n              <button type="button" className="premium-back-button" onClick={() => changeTab("build")} aria-label="Back to Build">‹</button>\n              <div>\n                <span>Daily ladders</span>',
  "engine back button",
);
replaceOnce(
  component,
  '            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Library</span>',
  '            <div className="premium-page-bar premium-page-bar-static">\n              <button type="button" className="premium-back-button" onClick={() => changeTab("build")} aria-label="Back to Build">‹</button>\n              <div>\n                <span>Library</span>',
  "slips back button",
);

const finalCss = "src/final-ui.css";
const css = readFileSync(finalCss, "utf8");
if (!css.includes(".premium-engine-window")) {
  appendFileSync(
    finalCss,
    '\n.premium-engine-window { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 5px; border: 1px solid rgba(103,69,47,.08); border-radius: 17px; background: #efe4d9; padding: 5px; }\n.premium-engine-window button { min-height: 37px; border-radius: 13px; color: #806a58; font-size: 9px; font-weight: 850; text-transform: capitalize; }\n.premium-engine-window button.is-active { background: #70462d; color: #fff; box-shadow: 0 10px 18px -15px rgba(82,49,29,.8); }\n@media (max-width: 380px) { .premium-engine-window button { font-size: 8px; } }\n',
  );
  console.log("engine window styles: applied");
} else {
  console.log("engine window styles: already applied");
}

console.log("SlipCut Engine windows and navigation polish complete");
