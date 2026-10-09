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
  '@import "./iphone-compact.css";',
  '@import "./iphone-compact.css";\n@import "./slipcut-v2.css";',
  "SlipCut V2 stylesheet",
);

replaceOnce(
  component,
  'type Tab = "build" | "cut" | "engine" | "slips";',
  'type Tab = "build" | "cut" | "engine" | "longshot" | "slips";',
  "Longshot tab type",
);

replaceOnce(
  component,
  'const BOOKMAKERS: Array<{ value: BookmakerId; label: string }> = [',
  `type LongshotApiResult =\n  | {\n      ok: true;\n      sport: EngineSport;\n      warning?: string;\n      ladder: number[];\n      cards: Array<{\n        targetOdds: number;\n        targetReached: boolean;\n        code: string;\n        url: string;\n        odds: number | null;\n        games: number;\n        averageScore: number | null;\n        weakestScore: number | null;\n        legs: Array<{\n          home: string;\n          away: string;\n          market: string;\n          selection: string;\n          odds?: number;\n          sport: string;\n        }>;\n      }>;\n    }\n  | { ok: false; sport: EngineSport; error: string; cards?: []; ladder?: number[] };\n\nconst BOOKMAKERS: Array<{ value: BookmakerId; label: string }> = [`,
  "Longshot response type",
);

replaceOnce(
  component,
  '  const [engineCopied, setEngineCopied] = useState<string | null>(null);',
  `  const [engineCopied, setEngineCopied] = useState<string | null>(null);\n  const [longshotSport, setLongshotSport] = useState<EngineSport>("football");\n  const [longshotResult, setLongshotResult] = useState<LongshotApiResult | null>(null);\n  const [longshotBusy, setLongshotBusy] = useState(false);\n  const [longshotCopied, setLongshotCopied] = useState<string | null>(null);\n  const longshotRequestRef = useRef(0);`,
  "Longshot component state",
);

replaceOnce(
  component,
  '  function changeTab(next: Tab) {',
  `  async function loadLongshot(nextSport: EngineSport = longshotSport) {\n    const requestId = ++longshotRequestRef.current;\n    setLongshotBusy(true);\n    try {\n      const response = await fetch(\`/api/longshot?sport=\${nextSport}\`, {\n        headers: { Accept: "application/json" },\n      });\n      const result = (await response.json()) as LongshotApiResult;\n      if (requestId === longshotRequestRef.current) setLongshotResult(result);\n    } catch {\n      if (requestId === longshotRequestRef.current) {\n        setLongshotResult({\n          ok: false,\n          sport: nextSport,\n          error: "Longshot data is temporarily unavailable.",\n        });\n      }\n    } finally {\n      if (requestId === longshotRequestRef.current) setLongshotBusy(false);\n    }\n  }\n\n  function changeLongshotSport(nextSport: EngineSport) {\n    if (nextSport === longshotSport) return;\n    setLongshotSport(nextSport);\n    setLongshotResult(null);\n    setLongshotCopied(null);\n    void loadLongshot(nextSport);\n  }\n\n  async function copyLongshotCode(code: string) {\n    try {\n      await navigator.clipboard.writeText(code);\n      setLongshotCopied(code);\n      window.setTimeout(\n        () => setLongshotCopied((current) => (current === code ? null : current)),\n        1500,\n      );\n    } catch {\n      setError("Copy failed. Press and hold the code to copy it manually.");\n    }\n  }\n\n  function changeTab(next: Tab) {`,
  "Longshot loader",
);

replaceOnce(
  component,
  '    if (next === "engine" && !engineResult) void loadEngine();',
  '    if (next === "engine" && !engineResult) void loadEngine();\n    if (next === "longshot" && !longshotResult) void loadLongshot();',
  "Longshot tab loader",
);

replaceOnce(
  component,
  '        {tab === "slips" && (',
  `        {tab === "longshot" && (\n          <section className="v2-longshot-screen">\n            <div className="v2-longshot-hero">\n              <div>\n                <span className="v2-kicker">HIGH VARIANCE</span>\n                <h2>Longshot</h2>\n                <p>Separate high-odds cards built from the strongest Aggressive candidates available. No mixed sports.</p>\n              </div>\n              <button\n                type="button"\n                onClick={() => void loadLongshot(longshotSport)}\n                disabled={longshotBusy}\n                className="v2-icon-button"\n                aria-label="Refresh longshot cards"\n              >\n                <RefreshCw className={\"h-4 w-4 \" + (longshotBusy ? "animate-spin" : "")} />\n              </button>\n            </div>\n\n            <div className="v2-longshot-switch">\n              <button\n                type="button"\n                onClick={() => changeLongshotSport("football")}\n                className={longshotSport === "football" ? "is-active" : ""}\n              >\n                <strong>Football</strong>\n                <small>Aggressive · max 1.70/leg</small>\n              </button>\n              <button\n                type="button"\n                onClick={() => changeLongshotSport("basketball")}\n                className={longshotSport === "basketball" ? "is-active" : ""}\n              >\n                <strong>Basketball</strong>\n                <small>Over-only · max 2.75/leg</small>\n              </button>\n            </div>\n\n            <div className="v2-longshot-targets">\n              {[25, 50, 100, 250].map((target) => <span key={target}>{target}x</span>)}\n            </div>\n\n            {longshotBusy && !longshotResult && (\n              <div className="v2-state-card">\n                <Loader2 className="h-5 w-5 animate-spin" />\n                <div><strong>Building Longshot cards…</strong><small>Scanning markets and ranking combinations.</small></div>\n              </div>\n            )}\n\n            {longshotResult && !longshotResult.ok && (\n              <div className="v2-state-card is-error">\n                <AlertTriangle className="h-5 w-5" />\n                <div><strong>No Longshot cards right now</strong><small>{longshotResult.error}</small></div>\n              </div>\n            )}\n\n            {longshotResult?.ok && (\n              <>\n                {longshotResult.warning && <p className="v2-longshot-warning">{longshotResult.warning}</p>}\n                <div className="v2-longshot-list">\n                  {longshotResult.cards.map((card) => (\n                    <article key={card.code} className="v2-longshot-card">\n                      <div className="v2-longshot-card-head">\n                        <div>\n                          <span>{card.targetOdds}x target</span>\n                          <h3>{card.odds ? formatOdds(card.odds) : "—"}<small> actual odds</small></h3>\n                        </div>\n                        <span className={\"v2-target-pill \" + (card.targetReached ? "is-hit" : "is-near")}>\n                          {card.targetReached ? "Target reached" : "Best available"}\n                        </span>\n                      </div>\n\n                      <div className="v2-longshot-metrics">\n                        <div><small>Games</small><strong>{card.games}</strong></div>\n                        <div><small>Avg score</small><strong>{card.averageScore ?? "—"}</strong></div>\n                        <div><small>Weakest</small><strong>{card.weakestScore ?? "—"}</strong></div>\n                      </div>\n\n                      <div className="v2-longshot-legs">\n                        {card.legs.map((leg, index) => (\n                          <div key={card.code + "-" + index}>\n                            <span>{index + 1}</span>\n                            <p><strong>{leg.home} vs {leg.away}</strong><small>{leg.market} · {leg.selection}</small></p>\n                            <b>{leg.odds ? leg.odds.toFixed(2) : "—"}</b>\n                          </div>\n                        ))}\n                      </div>\n\n                      <div className="v2-longshot-code">\n                        <div><small>SportyBet code</small><strong>{card.code}</strong></div>\n                        <button type="button" onClick={() => void copyLongshotCode(card.code)}>\n                          {longshotCopied === card.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}\n                          {longshotCopied === card.code ? "Copied" : "Copy"}\n                        </button>\n                        <a href={card.url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-4 w-4" /></a>\n                      </div>\n                    </article>\n                  ))}\n                </div>\n              </>\n            )}\n          </section>\n        )}\n\n        {tab === "slips" && (`,
  "Longshot screen",
);

replaceOnce(
  component,
  '              { id: "engine", label: "Engine", icon: CircleGauge },\n              { id: "slips", label: "My Slips", icon: History },',
  '              { id: "engine", label: "Engine", icon: CircleGauge },\n              { id: "longshot", label: "Longshot", icon: Sparkles },\n              { id: "slips", label: "My Slips", icon: History },',
  "Longshot nav item",
);

console.log("SlipCut V2 + Longshot UI applied");
