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
  `type EngineCard = {\n  n: number;\n  code: string;`,
  `type EngineCard = {\n  n: number;\n  targetOdds?: number;\n  targetReached?: boolean;\n  code: string;`,
  "engine ladder fields",
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
  '          className={"premium-segmented-button " + (value === option.value ? "is-active" : "")}',
  "segmented buttons",
);

replaceBetween(
  component,
  "function SelectionCard({",
  "export function MiniAppRefresh() {",
  `function SelectionCard({\n  pick,\n  selected,\n  onToggle,\n  index,\n}: {\n  pick: BuildSelection | AnalyzedPick;\n  selected: boolean;\n  onToggle: () => void;\n  index: number;\n}) {\n  const score = "modelScore" in pick ? pick.modelScore : pick.probability;\n  const limited = "analysisBasis" in pick && pick.analysisBasis === "market_only";\n  return (\n    <article className={"premium-selection " + (selected ? "is-selected" : "is-muted")}>\n      <button\n        type="button"\n        onClick={onToggle}\n        aria-label="Toggle selection"\n        className={"premium-check " + (selected ? "is-selected" : "")}\n      >\n        {selected ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}\n      </button>\n      <div className="premium-pick-main">\n        <div className="premium-pick-meta">\n          <span>{index + 1} · {pick.league || pick.sport}</span>\n          <span>{formatKickoff(pick.kickoff)}</span>\n        </div>\n        <h4>{pick.home} vs {pick.away}</h4>\n        <p>{pick.market} · {pick.selection}</p>\n        <span className="premium-pick-score">\n          {limited ? "Live market" : "Score " + Math.round(score) + "/100"}\n        </span>\n      </div>\n      <div className="premium-pick-odds">{pick.odds ? formatOdds(pick.odds) : "—"}</div>\n    </article>\n  );\n}\n\n`,
  "compact selection cards",
  "premium-pick-main",
);

replaceOnce(
  component,
  '  const [copied, setCopied] = useState(false);',
  '  const [copied, setCopied] = useState(false);\n  const [slipView, setSlipView] = useState<"saved" | "booked" | "history">("saved");',
  "my slips view state",
);

replaceOnce(
  component,
  `  const allHistory = useMemo(() => {\n    const seen = new Set<string>();\n    return [...sessionSlips, ...history].filter((item) => {\n      if (seen.has(item.bookingCode)) return false;\n      seen.add(item.bookingCode);\n      return true;\n    });\n  }, [history, sessionSlips]);`,
  `  const allHistory = useMemo(() => {\n    const seen = new Set<string>();\n    return [...sessionSlips, ...history].filter((item) => {\n      if (seen.has(item.bookingCode)) return false;\n      seen.add(item.bookingCode);\n      return true;\n    });\n  }, [history, sessionSlips]);\n  const visibleHistory = useMemo(() => {\n    if (slipView === "booked")\n      return allHistory.filter((item) => /stored|booked|active/i.test(item.status));\n    return allHistory;\n  }, [allHistory, slipView]);`,
  "my slips filtered data",
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

replaceBetween(
  component,
  '        <header className="mb-4 flex items-center justify-between gap-3 px-1">',
  '        {!initData && (',
  `        <header className="premium-header">\n          <div>\n            <h1 className="premium-wordmark">Slip<span>Cut.</span></h1>\n            <p className="premium-tagline">Smarter slips. Better decisions.</p>\n          </div>\n          <button type="button" onClick={openBot} className="premium-bot-chip">\n            @slipcut_bot\n          </button>\n        </header>\n`,
  "premium header",
  "premium-wordmark",
);
replaceOnce(
  component,
  '          <div className="mb-3 flex gap-2 rounded-xl border border-[#9b6f4e]/20 bg-[#f3e5d8] p-3 text-xs leading-5 text-[#6f4d35]">',
  '          <div className="premium-notice">',
  "telegram notice",
);

replaceBetween(
  component,
  '        {tab === "build" && (',
  '        {tab === "cut" && (',
  `        {tab === "build" && (\n          <section className="premium-screen premium-build-screen">\n            {!buildResult ? (\n              <div className="premium-build-surface">\n                <div className="premium-page-intro">\n                  <div>\n                    <span>New slip</span>\n                    <h2>Build smarter.</h2>\n                    <p>Choose your sport, target and risk. SlipCut does the rest.</p>\n                  </div>\n                  <Sparkles className="h-5 w-5" />\n                </div>\n\n                <div className="premium-sport-switch">\n                  <button\n                    type="button"\n                    onClick={() => setSport("football")}\n                    className={"premium-sport-button " + (sport === "football" ? "is-active" : "")}\n                  >\n                    <span className="premium-sport-icon">⚽</span>\n                    <span><strong>Football</strong><small>All supported leagues</small></span>\n                  </button>\n                  <button\n                    type="button"\n                    onClick={() => setSport("basketball")}\n                    className={"premium-sport-button " + (sport === "basketball" ? "is-active" : "")}\n                  >\n                    <span className="premium-sport-icon">🏀</span>\n                    <span><strong>Basketball</strong><small>Over markets only</small></span>\n                  </button>\n                </div>\n\n                <div className="premium-control-group">\n                  <div className="premium-control-title">\n                    <span>Build method</span>\n                  </div>\n                  <Segmented\n                    value={mode}\n                    onChange={setMode}\n                    label="Build method"\n                    options={[\n                      { value: "games", label: "No. of games" },\n                      { value: "odds", label: "Target odds" },\n                    ]}\n                  />\n                </div>\n\n                {mode === "games" ? (\n                  <div className="premium-control-group">\n                    <div className="premium-control-title">\n                      <span>Number of games</span>\n                      <strong>{games}</strong>\n                    </div>\n                    <input\n                      aria-label="Number of games"\n                      type="range"\n                      min={2}\n                      max={15}\n                      value={games}\n                      onChange={(event) => setGames(Number(event.target.value))}\n                      className="mini-range w-full"\n                    />\n                  </div>\n                ) : (\n                  <div className="premium-control-group">\n                    <div className="premium-control-title"><span>Target combined odds</span></div>\n                    <div className="premium-odds-grid">\n                      {ODDS_PRESETS.map((odds) => (\n                        <button\n                          key={odds}\n                          type="button"\n                          onClick={() => { setTargetOdds(odds); setCustomOdds(""); }}\n                          className={"premium-odds-chip " + (!customOdds.trim() && targetOdds === odds ? "is-active" : "")}\n                        >\n                          {odds.toFixed(2)}\n                        </button>\n                      ))}\n                    </div>\n                    <label className="premium-custom-odds">\n                      <span>Custom odds</span>\n                      <input\n                        aria-label="Custom target odds"\n                        inputMode="decimal"\n                        type="text"\n                        value={customOdds}\n                        onChange={(event) => {\n                          const next = event.target.value.replace(/[^0-9.,]/g, "").replace(",", ".");\n                          setCustomOdds(next);\n                        }}\n                        placeholder="e.g. 50, 150, 500"\n                        className={field}\n                      />\n                    </label>\n                  </div>\n                )}\n\n                <div className="premium-control-group">\n                  <div className="premium-control-title"><span>Risk mode</span></div>\n                  <div className="premium-risk-grid">\n                    <button\n                      type="button"\n                      onClick={() => setRisk("conservative")}\n                      className={"premium-risk-card " + (risk === "conservative" ? "is-active" : "")}\n                    >\n                      <strong>Conservative</strong><span>1.20–1.40</span>\n                    </button>\n                    <button\n                      type="button"\n                      onClick={() => setRisk("balanced")}\n                      className={"premium-risk-card " + (risk === "balanced" ? "is-active" : "")}\n                    >\n                      <strong>Balanced</strong><span>1.40–1.80</span>\n                    </button>\n                    <button\n                      type="button"\n                      onClick={() => setRisk("aggressive")}\n                      className={"premium-risk-card " + (risk === "aggressive" ? "is-active" : "")}\n                    >\n                      <strong>Aggressive</strong><span>{sport === "football" ? "1.16–1.70" : "1.16–2.75"}</span>\n                    </button>\n                  </div>\n                </div>\n\n                <div className="premium-control-group">\n                  <div className="premium-control-title"><span>When</span></div>\n                  <div className="premium-time-grid">\n                    {(["today", "tomorrow", "weekend", "upcoming"] as BuildWindow[]).map((item) => (\n                      <button\n                        key={item}\n                        type="button"\n                        onClick={() => setWindowChoice(item)}\n                        className={"premium-time-chip " + (windowChoice === item ? "is-active" : "")}\n                      >\n                        {item}\n                      </button>\n                    ))}\n                  </div>\n                </div>\n\n                <button\n                  type="button"\n                  disabled={pending !== null || !initData}\n                  onClick={() => void runBuild()}\n                  className="premium-primary premium-main-cta"\n                >\n                  {pending === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}\n                  {pending === "build" ? STAGES[stage] : "Find best games"}\n                  <ChevronRight className="h-4 w-4" />\n                </button>\n                {pending === "build" && (\n                  <button type="button" onClick={cancel} className="premium-secondary">\n                    <X className="h-4 w-4" /> Stop waiting\n                  </button>\n                )}\n              </div>\n            ) : (\n              <>\n                <div className="premium-page-bar">\n                  <button\n                    type="button"\n                    className="premium-back-button"\n                    onClick={() => { setBuildResult(null); setBuildSelected(new Set()); setMinted(null); }}\n                    aria-label="Back to builder"\n                  >\n                    ‹\n                  </button>\n                  <div>\n                    <span>Slip Builder</span>\n                    <h2>Review your selections</h2>\n                  </div>\n                  <div className="premium-page-count">{chosenBuild.length}</div>\n                </div>\n\n                <div className="premium-slip-summary">\n                  <div><span>Total odds</span><strong>{activeOdds ? formatOdds(activeOdds) : "—"}</strong></div>\n                  <div><span>Total games</span><strong>{chosenBuild.length}</strong></div>\n                  <div><span>Risk mode</span><strong>{risk}</strong></div>\n                </div>\n\n                {buildResult.notice && <div className="premium-inline-note">{buildResult.notice}</div>}\n\n                <div className="premium-pick-list">\n                  {buildResult.selections.map((pick, index) => (\n                    <SelectionCard\n                      key={pick.id}\n                      pick={pick}\n                      index={index}\n                      selected={buildSelected.has(pick.id)}\n                      onToggle={() =>\n                        setBuildSelected((current) => {\n                          const next = new Set(current);\n                          if (next.has(pick.id)) next.delete(pick.id); else next.add(pick.id);\n                          setMinted(null);\n                          setOddsChanges([]);\n                          return next;\n                        })\n                      }\n                    />\n                  ))}\n                </div>\n\n                <BookingAction\n                  pending={pending}\n                  count={chosenBuild.length}\n                  onBook={() => void createCode()}\n                  minted={minted}\n                  copied={copied}\n                  onCopy={() => void copyCode()}\n                  oddsChanges={oddsChanges}\n                  targetBookmaker={targetBookmaker}\n                  onTargetBookmaker={setTargetBookmaker}\n                />\n              </>\n            )}\n          </section>\n        )}\n\n`,
  "complete Build screen",
  "premium-build-screen",
);

replaceBetween(
  component,
  '        {tab === "cut" && (',
  '        {tab === "engine" && (',
  `        {tab === "cut" && (\n          <section className="premium-screen premium-cut-screen">\n            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Cut / Trim Slip</span>\n                <h2>Remove the weak legs</h2>\n              </div>\n              <Scissors className="h-5 w-5 text-[#70462d]" />\n            </div>\n\n            {!cutResult && (\n              <>\n                <div className="premium-cut-tabs">\n                  <button type="button" className="is-active">Paste Code</button>\n                  <button type="button" onClick={() => changeTab("slips")}>Select From Slips</button>\n                </div>\n\n                <div className="premium-panel premium-cut-form">\n                  <label className="premium-field-label">\n                    <span>Bookmaker</span>\n                    <select\n                      value={sourceBookmaker}\n                      onChange={(event) => {\n                        setSourceBookmaker(event.target.value as BookmakerId);\n                        setCutResult(null);\n                        clearMessages();\n                      }}\n                      className={field}\n                    >\n                      {BOOKMAKERS.map((bookmaker) => (\n                        <option key={bookmaker.value} value={bookmaker.value}>{bookmaker.label}</option>\n                      ))}\n                    </select>\n                  </label>\n                  <label className="premium-field-label">\n                    <span>{bookmakerLabel(sourceBookmaker)} booking code</span>\n                    <input\n                      value={code}\n                      onChange={(event) => { setCode(event.target.value.toUpperCase()); clearMessages(); }}\n                      placeholder="e.g. ABC123, VVR29N"\n                      className={field + " font-mono tracking-widest"}\n                    />\n                  </label>\n                  <button\n                    type="button"\n                    disabled={pending !== null || !initData}\n                    onClick={() => void runCut()}\n                    className="premium-primary"\n                  >\n                    {pending === "cut" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}\n                    {pending === "cut" ? "Analysing real code…" : "Analyse & Cut"}\n                  </button>\n                  {pending === "cut" && (\n                    <button type="button" onClick={cancel} className="premium-secondary">\n                      <X className="h-4 w-4" /> Stop waiting\n                    </button>\n                  )}\n\n                  <details className="premium-advanced">\n                    <summary>Advanced import & filter</summary>\n                    <label className="premium-threshold">\n                      <span>Model-score threshold <strong>{threshold}/100</strong></span>\n                      <input\n                        aria-label="Model score threshold"\n                        type="range"\n                        min={40}\n                        max={80}\n                        value={threshold}\n                        onChange={(event) => setThreshold(Number(event.target.value))}\n                        className="mini-range w-full"\n                      />\n                    </label>\n                    <textarea\n                      value={pasteText}\n                      onChange={(event) => setPasteText(event.target.value)}\n                      placeholder="Paste picks, a tips link, or ticket text"\n                      className={field + " min-h-24 resize-y"}\n                    />\n                    <div className="premium-import-actions">\n                      <button\n                        type="button"\n                        disabled={pending !== null || !pasteText.trim()}\n                        onClick={() => void analyseImported({ mode: "text", text: pasteText })}\n                        className="premium-secondary"\n                      >\n                        <Sparkles className="h-4 w-4" /> Read text/link\n                      </button>\n                      <label className="premium-secondary cursor-pointer">\n                        <Ticket className="h-4 w-4" /> Screenshot\n                        <input\n                          type="file"\n                          accept="image/png,image/jpeg,image/webp"\n                          className="hidden"\n                          disabled={pending !== null}\n                          onChange={(event) => {\n                            const file = event.currentTarget.files?.[0];\n                            event.currentTarget.value = "";\n                            void importScreenshot(file);\n                          }}\n                        />\n                      </label>\n                    </div>\n                  </details>\n                </div>\n\n                {allHistory.length > 0 && (\n                  <div className="premium-recent-block">\n                    <div className="premium-list-heading"><strong>Recent slips</strong><span>Tap to reuse</span></div>\n                    {allHistory.slice(0, 3).map((item) => (\n                      <button\n                        type="button"\n                        key={item.id}\n                        className="premium-recent-row"\n                        onClick={() => setCode(item.bookingCode)}\n                      >\n                        <Ticket className="h-4 w-4" />\n                        <span><strong>{item.bookingCode}</strong><small>{item.selectionCount} games · {item.combinedOdds ? formatOdds(item.combinedOdds) : "—"}</small></span>\n                        <ChevronRight className="h-4 w-4" />\n                      </button>\n                    ))}\n                  </div>\n                )}\n              </>\n            )}\n\n            {cutResult && (\n              <>\n                <div className="premium-slip-summary">\n                  <div><span>Loaded</span><strong>{allCut.length}</strong></div>\n                  <div><span>Selected</span><strong>{chosenCut.length}</strong></div>\n                  <div><span>Total odds</span><strong>{activeOdds ? formatOdds(activeOdds) : "—"}</strong></div>\n                </div>\n                <button\n                  type="button"\n                  className="premium-secondary premium-reset-cut"\n                  onClick={() => { setCutResult(null); setCutSelected(new Set()); setMinted(null); }}\n                >\n                  Analyse another slip\n                </button>\n                {([\n                  { title: "Recommended", picks: cutResult.kept },\n                  { title: "Weak legs", picks: cutResult.dropped },\n                  { title: "Unscored legs", picks: cutResult.ignored },\n                ] as const).map((group) =>\n                  group.picks.length ? (\n                    <div key={group.title} className="premium-pick-group">\n                      <div className="premium-list-heading"><strong>{group.title}</strong><span>{group.picks.length}</span></div>\n                      {group.picks.map((pick, index) => (\n                        <SelectionCard\n                          key={pick.id}\n                          pick={pick}\n                          index={index}\n                          selected={cutSelected.has(pick.id)}\n                          onToggle={() =>\n                            setCutSelected((current) => {\n                              const next = new Set(current);\n                              if (next.has(pick.id)) next.delete(pick.id); else next.add(pick.id);\n                              setMinted(null);\n                              setOddsChanges([]);\n                              return next;\n                            })\n                          }\n                        />\n                      ))}\n                    </div>\n                  ) : null,\n                )}\n                <BookingAction\n                  pending={pending}\n                  count={chosenCut.length}\n                  onBook={() => void createCode()}\n                  minted={minted}\n                  copied={copied}\n                  onCopy={() => void copyCode()}\n                  oddsChanges={oddsChanges}\n                  targetBookmaker={targetBookmaker}\n                  onTargetBookmaker={setTargetBookmaker}\n                />\n              </>\n            )}\n          </section>\n        )}\n\n`,
  "complete Cut screen",
  "premium-cut-screen",
);

replaceBetween(
  component,
  '        {tab === "engine" && (',
  '        {tab === "slips" && (',
  `        {tab === "engine" && (\n          <section className="premium-screen premium-engine-screen">\n            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Daily ladders</span>\n                <h2>Engine</h2>\n              </div>\n              <button\n                type="button"\n                onClick={() => void loadEngine(engineSport)}\n                disabled={engineBusy}\n                className="premium-refresh-button"\n                aria-label="Refresh engine"\n              >\n                <RefreshCw className={"h-4 w-4 " + (engineBusy ? "animate-spin" : "")} />\n              </button>\n            </div>\n\n            <Segmented\n              value={engineSport}\n              onChange={changeEngineSport}\n              label="Engine sport"\n              options={[\n                { value: "football", label: "Football" },\n                { value: "basketball", label: "Basketball" },\n              ]}\n            />\n\n            <div className="premium-engine-day">\n              <span className="is-active">Today</span>\n              <small>Fresh daily cards · sports never mix</small>\n            </div>\n\n            {engineResult?.ok && (\n              <div className="premium-stat-grid">\n                <div><span>Hit rate</span><strong>{engineResult.hitRate == null ? "—" : Math.round(engineResult.hitRate * 100) + "%"}</strong><small>{engineResult.sampleCount} settled</small></div>\n                <div><span>Qualify</span><strong>{engineResult.qualifyingBar == null ? "—" : Math.round(engineResult.qualifyingBar * 100) + "%"}</strong><small>rolling bar</small></div>\n                <div><span>Cards</span><strong>{engineResult.cards.length}</strong><small>today</small></div>\n              </div>\n            )}\n\n            {engineBusy && !engineResult && (\n              <div className="premium-loading-card">\n                <Loader2 className="h-5 w-5 animate-spin" />\n                <span>Loading today's engine ladder…</span>\n              </div>\n            )}\n\n            {engineResult && !engineResult.ok && (\n              <div className="premium-empty-card">\n                <CircleGauge className="h-7 w-7" />\n                <strong>No engine cards right now</strong>\n                <span>{engineResult.error}</span>\n              </div>\n            )}\n\n            {engineResult?.ok && (\n              <div className="premium-ladder-list">\n                {engineResult.cards.map((card, index) => (\n                  <details key={card.code} className="premium-ladder-row">\n                    <summary>\n                      <span className="premium-ladder-icon">▥</span>\n                      <span className="premium-ladder-main">\n                        <strong>{card.targetOdds ? <>{card.targetOdds}× Ladder</> : <>Ladder {index + 1}</>}</strong>\n                        <small>{card.games} games · {card.targetReached === false ? "best effort" : card.graded ? (card.hit ? "hit" : "missed") : "pending"}</small>\n                      </span>\n                      <span className="premium-ladder-odds">\n                        <strong>{card.odds ? formatOdds(card.odds) : "—"}</strong>\n                        <small>View ›</small>\n                      </span>\n                    </summary>\n                    <div className="premium-ladder-detail">\n                      {card.legs?.length ? (\n                        <div className="premium-ladder-legs">\n                          {card.legs.map((leg, legIndex) => (\n                            <div key={card.code + "-" + legIndex}>\n                              <span>{legIndex + 1}</span>\n                              <p><strong>{leg.home} vs {leg.away}</strong><small>{leg.market} · {leg.selection}</small></p>\n                              <b>{leg.odds ? leg.odds.toFixed(2) : "—"}</b>\n                            </div>\n                          ))}\n                        </div>\n                      ) : null}\n                      <div className="premium-code-strip">\n                        <span><small>Code</small><strong>{card.code}</strong></span>\n                        <button type="button" onClick={() => void copyEngineCode(card.code)} className="premium-secondary">\n                          {engineCopied === card.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}\n                          {engineCopied === card.code ? "Copied" : "Copy"}\n                        </button>\n                        <a href={card.url} target="_blank" rel="noreferrer" className="premium-primary">\n                          Open <ExternalLink className="h-4 w-4" />\n                        </a>\n                      </div>\n                    </div>\n                  </details>\n                ))}\n              </div>\n            )}\n          </section>\n        )}\n\n`,
  "complete Engine screen",
  "premium-engine-screen",
);

replaceBetween(
  component,
  '        {tab === "slips" && (',
  '        {error && (',
  `        {tab === "slips" && (\n          <section className="premium-screen premium-slips-screen">\n            <div className="premium-page-bar premium-page-bar-static">\n              <div>\n                <span>Library</span>\n                <h2>My Slips</h2>\n              </div>\n              {pending === "history" && <Loader2 className="h-5 w-5 animate-spin text-[#70462d]" />}\n            </div>\n\n            <div className="premium-slips-tabs">\n              {([\n                { id: "saved", label: "Saved" },\n                { id: "booked", label: "Booked" },\n                { id: "history", label: "History" },\n              ] as const).map((item) => (\n                <button\n                  key={item.id}\n                  type="button"\n                  onClick={() => setSlipView(item.id)}\n                  className={slipView === item.id ? "is-active" : ""}\n                >\n                  {item.label}\n                </button>\n              ))}\n            </div>\n\n            {historyNote && <div className="premium-inline-note">{historyNote}</div>}\n\n            {!pending && !visibleHistory.length && (\n              <div className="premium-empty-card">\n                <History className="h-7 w-7" />\n                <strong>No slips here yet</strong>\n                <span>Build or cut a slip and create a real booking code.</span>\n              </div>\n            )}\n\n            <div className="premium-history-list">\n              {visibleHistory.map((item) => (\n                <article key={item.id} className="premium-history-row">\n                  <div className="premium-history-icon"><Ticket className="h-4 w-4" /></div>\n                  <div className="premium-history-main">\n                    <strong>{item.bookingCode}</strong>\n                    <span>{item.selectionCount} games · {item.combinedOdds ? formatOdds(item.combinedOdds) : "odds unavailable"}</span>\n                    <small>{new Date(item.createdAt).toLocaleString()}</small>\n                  </div>\n                  <span className="premium-status-pill">{item.status || "Active"}</span>\n                </article>\n              ))}\n            </div>\n          </section>\n        )}\n\n`,
  "complete My Slips screen",
  "premium-slips-screen",
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
  '              className={"premium-nav-button " + (tab === id ? "is-active" : "")}',
  "premium nav buttons",
);

console.log("SlipCut complete preview UI patch applied");
