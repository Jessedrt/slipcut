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
  '@import "./premium-ui.css";',
  '@import "./premium-ui.css";\n@import "./final-ui.css";',
  "final stylesheet import",
);

replaceOnce(
  component,
  "  AlertTriangle,\n  Check,",
  "  AlertTriangle,\n  Bell,\n  Check,",
  "bell import",
);
replaceOnce(
  component,
  "  Scissors,\n  ShieldCheck,",
  "  Scissors,\n  Search,\n  ShieldCheck,",
  "search import",
);
replaceOnce(
  component,
  "  Ticket,\n  X,",
  "  Ticket,\n  Trash2,\n  X,",
  "trash import",
);

replaceOnce(
  component,
  '  const [mode, setMode] = useState<BuildMode>("games");',
  '  const [mode, setMode] = useState<BuildMode>("odds");',
  "odds-first default",
);

replaceOnce(
  component,
  '  const [slipView, setSlipView] = useState<"saved" | "booked" | "history">("saved");',
  '  const [slipView, setSlipView] = useState<"saved" | "booked" | "history">("saved");\n  const [buildScreen, setBuildScreen] = useState<"home" | "sport" | "games" | "builder">("home");\n  const [builderView, setBuilderView] = useState<"single" | "full">("single");\n  const [leagueFilter, setLeagueFilter] = useState("all");\n  const [gameSearch, setGameSearch] = useState("");',
  "build flow state",
);

replaceOnce(
  component,
  '        setBuildSelected(new Set(result.selections.map((pick) => pick.id)));\n        telegramWebApp()?.HapticFeedback?.impactOccurred?.("light");',
  '        setBuildSelected(new Set(result.selections.map((pick) => pick.id)));\n        setLeagueFilter("all");\n        setGameSearch("");\n        setBuildScreen("games");\n        telegramWebApp()?.HapticFeedback?.impactOccurred?.("light");',
  "build success opens game list",
);

replaceOnce(
  component,
  '  const activeOdds = combinedOdds(activePicks);',
  `  const activeOdds = combinedOdds(activePicks);\n  const buildLeagues = useMemo(() => {\n    const seen = new Set<string>();\n    for (const pick of buildResult?.selections ?? []) {\n      const league = String(pick.league || "").trim();\n      if (league) seen.add(league);\n    }\n    return [...seen].slice(0, 5);\n  }, [buildResult]);\n  const visibleBuildSelections = useMemo(() => {\n    const query = gameSearch.trim().toLowerCase();\n    return (buildResult?.selections ?? []).filter((pick) => {\n      const leagueOk = leagueFilter === "all" || String(pick.league || "") === leagueFilter;\n      const queryOk =\n        !query ||\n        [pick.home, pick.away, pick.league, pick.market, pick.selection]\n          .filter(Boolean)\n          .some((value) => String(value).toLowerCase().includes(query));\n      return leagueOk && queryOk;\n    });\n  }, [buildResult, leagueFilter, gameSearch]);`,
  "game-list derived data",
);

replaceOnce(
  component,
  '  function changeTab(next: Tab) {\n    setTab(next);',
  '  function changeTab(next: Tab) {\n    setTab(next);\n    if (next === "build") setBuildScreen("home");',
  "build tab returns home",
);

replaceBetween(
  component,
  '        <header className="premium-header">',
  '        {!initData && (',
  `        {tab === "build" && buildScreen === "home" && (\n          <header className="premium-header premium-home-header">\n            <div>\n              <h1 className="premium-wordmark">Slip<span>Cut.</span></h1>\n              <p className="premium-tagline">Smarter slips. Better decisions.</p>\n            </div>\n            <button type="button" onClick={openBot} className="premium-icon-button" aria-label="Open SlipCut bot">\n              <Bell className="h-5 w-5" />\n            </button>\n          </header>\n        )}\n`,
  "mockup home header",
  "premium-home-header",
);

replaceBetween(
  component,
  '        {tab === "build" && (',
  '        {tab === "cut" && (',
  `        {tab === "build" && (\n          <section className="final-build-flow">\n            {buildScreen === "home" && (\n              <div className="final-home-card">\n                <div className="final-home-sports">\n                  <button\n                    type="button"\n                    className={"final-home-sport " + (sport === "football" ? "is-active" : "")}\n                    onClick={() => { setSport("football"); setBuildScreen("sport"); }}\n                  >\n                    <span>⚽</span> Football\n                  </button>\n                  <button\n                    type="button"\n                    className={"final-home-sport " + (sport === "basketball" ? "is-active" : "")}\n                    onClick={() => { setSport("basketball"); setBuildScreen("sport"); }}\n                  >\n                    <span>🏀</span> Basketball\n                  </button>\n                </div>\n\n                <div className="final-section">\n                  <div className="final-label-row"><span>Target combined odds</span></div>\n                  <div className="premium-odds-grid">\n                    {ODDS_PRESETS.map((odds) => (\n                      <button\n                        key={odds}\n                        type="button"\n                        onClick={() => { setMode("odds"); setTargetOdds(odds); setCustomOdds(""); }}\n                        className={"premium-odds-chip " + (mode === "odds" && !customOdds.trim() && targetOdds === odds ? "is-active" : "")}\n                      >\n                        {odds.toFixed(2)}\n                      </button>\n                    ))}\n                  </div>\n                  <label className="final-custom-odds">\n                    <span>Custom odds</span>\n                    <div className="final-input-wrap">\n                      <input\n                        aria-label="Custom target odds"\n                        inputMode="decimal"\n                        value={customOdds}\n                        onChange={(event) => {\n                          setMode("odds");\n                          setCustomOdds(event.target.value.replace(/[^0-9.,]/g, "").replace(",", "."));\n                        }}\n                        placeholder="e.g. 50, 150, 500"\n                        className={field}\n                      />\n                      <span>×</span>\n                    </div>\n                  </label>\n                  <details className="final-game-count">\n                    <summary>Build by number of games</summary>\n                    <div className="final-range-row">\n                      <span>Games</span><strong>{games}</strong>\n                    </div>\n                    <input\n                      aria-label="Number of games"\n                      type="range"\n                      min={2}\n                      max={15}\n                      value={games}\n                      onChange={(event) => { setMode("games"); setGames(Number(event.target.value)); }}\n                      className="mini-range w-full"\n                    />\n                  </details>\n                </div>\n\n                <div className="final-section">\n                  <div className="final-label-row"><span>Risk mode</span></div>\n                  <div className="premium-risk-grid final-risk-grid">\n                    <button type="button" onClick={() => setRisk("conservative")} className={"premium-risk-card " + (risk === "conservative" ? "is-active" : "")}>\n                      <strong>Conservative</strong><span>1.20–1.40</span>\n                    </button>\n                    <button type="button" onClick={() => setRisk("balanced")} className={"premium-risk-card " + (risk === "balanced" ? "is-active" : "")}>\n                      <strong>Balanced</strong><span>1.40–1.80</span>\n                    </button>\n                    <button type="button" onClick={() => setRisk("aggressive")} className={"premium-risk-card " + (risk === "aggressive" ? "is-active" : "")}>\n                      <strong>Aggressive</strong><span>{sport === "football" ? "1.16–1.70" : "1.16–2.75"}</span>\n                    </button>\n                  </div>\n                </div>\n\n                <div className="final-section">\n                  <div className="final-label-row"><span>When</span></div>\n                  <div className="premium-time-grid">\n                    {(["today", "tomorrow", "weekend", "upcoming"] as BuildWindow[]).map((item) => (\n                      <button key={item} type="button" onClick={() => setWindowChoice(item)} className={"premium-time-chip " + (windowChoice === item ? "is-active" : "")}>\n                        {item}\n                      </button>\n                    ))}\n                  </div>\n                </div>\n\n                <button type="button" disabled={pending !== null || !initData} onClick={() => void runBuild()} className="premium-primary final-find-button">\n                  {pending === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}\n                  {pending === "build" ? STAGES[stage] : "Find best games"}\n                  <ChevronRight className="h-4 w-4" />\n                </button>\n                {pending === "build" && (\n                  <button type="button" onClick={cancel} className="premium-secondary final-stop-button"><X className="h-4 w-4" /> Stop waiting</button>\n                )}\n              </div>\n            )}\n\n            {buildScreen === "sport" && (\n              <div className="final-subscreen">\n                <div className="final-subheader">\n                  <button type="button" onClick={() => setBuildScreen("home")} className="premium-back-button" aria-label="Back">‹</button>\n                  <div><span>Build</span><h2>Select Sport</h2></div>\n                </div>\n                <p className="final-subcopy">Choose what you want SlipCut to scan.</p>\n                <div className="final-sport-cards">\n                  <button type="button" className={"final-sport-hero football " + (sport === "football" ? "is-selected" : "")} onClick={() => { setSport("football"); setBuildScreen("home"); }}>\n                    <span className="final-sport-emoji">⚽</span>\n                    <span><strong>Football</strong><small>All major leagues</small></span>\n                    <ChevronRight className="h-5 w-5" />\n                  </button>\n                  <button type="button" className={"final-sport-hero basketball " + (sport === "basketball" ? "is-selected" : "")} onClick={() => { setSport("basketball"); setBuildScreen("home"); }}>\n                    <span className="final-sport-emoji">🏀</span>\n                    <span><strong>Basketball</strong><small>Over markets only</small></span>\n                    <ChevronRight className="h-5 w-5" />\n                  </button>\n                </div>\n              </div>\n            )}\n\n            {buildScreen === "games" && buildResult && (\n              <div className="final-subscreen final-games-screen">\n                <div className="final-subheader final-games-header">\n                  <button type="button" onClick={() => setBuildScreen("home")} className="premium-back-button" aria-label="Back">‹</button>\n                  <div className="final-games-title">\n                    <span>{windowChoice}</span>\n                    <h2>{sport === "football" ? "Football" : "Basketball"}</h2>\n                  </div>\n                  <Search className="h-5 w-5" />\n                </div>\n\n                <div className="final-search-box">\n                  <Search className="h-4 w-4" />\n                  <input value={gameSearch} onChange={(event) => setGameSearch(event.target.value)} placeholder="Search teams, league or market" />\n                </div>\n\n                <div className="final-league-strip">\n                  <button type="button" onClick={() => setLeagueFilter("all")} className={leagueFilter === "all" ? "is-active" : ""}>All</button>\n                  {buildLeagues.map((league) => (\n                    <button key={league} type="button" onClick={() => setLeagueFilter(league)} className={leagueFilter === league ? "is-active" : ""}>{league}</button>\n                  ))}\n                </div>\n\n                <div className="final-game-list">\n                  {visibleBuildSelections.map((pick) => {\n                    const selected = buildSelected.has(pick.id);\n                    return (\n                      <button\n                        type="button"\n                        key={pick.id}\n                        className={"final-game-row " + (selected ? "is-selected" : "")}\n                        onClick={() => {\n                          setBuildSelected((current) => {\n                            const next = new Set(current);\n                            if (next.has(pick.id)) next.delete(pick.id); else next.add(pick.id);\n                            return next;\n                          });\n                          setMinted(null);\n                          setOddsChanges([]);\n                        }}\n                      >\n                        <span className="final-game-tick">{selected ? <Check className="h-4 w-4" /> : "+"}</span>\n                        <span className="final-game-info">\n                          <small>{pick.league || pick.sport} · {formatKickoff(pick.kickoff)}</small>\n                          <strong>{pick.home} <span>vs</span> {pick.away}</strong>\n                          <em>{pick.market} · {pick.selection}</em>\n                        </span>\n                        <span className="final-game-odds">{pick.odds ? formatOdds(pick.odds) : "—"}</span>\n                      </button>\n                    );\n                  })}\n                  {!visibleBuildSelections.length && <div className="final-empty-state">No returned games match this filter.</div>}\n                </div>\n\n                <div className="final-game-footer">\n                  <span>{chosenBuild.length} selected</span>\n                  <strong>{activeOdds ? formatOdds(activeOdds) : "—"} odds</strong>\n                </div>\n                <button type="button" disabled={!chosenBuild.length} onClick={() => setBuildScreen("builder")} className="premium-primary final-continue-button">\n                  Continue with {chosenBuild.length} games <ChevronRight className="h-4 w-4" />\n                </button>\n              </div>\n            )}\n\n            {buildScreen === "builder" && buildResult && (\n              <div className="final-subscreen final-builder-screen">\n                <div className="final-subheader">\n                  <button type="button" onClick={() => setBuildScreen("games")} className="premium-back-button" aria-label="Back">‹</button>\n                  <div><span>Review</span><h2>Slip Builder</h2></div>\n                  <button type="button" onClick={() => { setBuildSelected(new Set()); setMinted(null); }} className="premium-icon-button final-trash-button" aria-label="Clear slip">\n                    <Trash2 className="h-4 w-4" />\n                  </button>\n                </div>\n\n                <div className="final-builder-toggle">\n                  <button type="button" onClick={() => setBuilderView("single")} className={builderView === "single" ? "is-active" : ""}>Single view</button>\n                  <button type="button" onClick={() => setBuilderView("full")} className={builderView === "full" ? "is-active" : ""}>Full slip view</button>\n                </div>\n\n                <div className="final-builder-list">\n                  {chosenBuild.length ? (builderView === "single" ? (\n                    chosenBuild.map((pick, index) => (\n                      <article className="final-builder-row" key={pick.id}>\n                        <span className="final-builder-index">{index + 1}</span>\n                        <div>\n                          <small>{pick.league || pick.sport} · {formatKickoff(pick.kickoff)}</small>\n                          <strong>{pick.home} vs {pick.away}</strong>\n                          <p>{pick.market} · {pick.selection}</p>\n                        </div>\n                        <span className="final-builder-price">{pick.odds ? formatOdds(pick.odds) : "—"}</span>\n                        <button type="button" aria-label="Remove game" onClick={() => {\n                          setBuildSelected((current) => { const next = new Set(current); next.delete(pick.id); return next; });\n                          setMinted(null); setOddsChanges([]);\n                        }}><X className="h-4 w-4" /></button>\n                      </article>\n                    ))\n                  ) : (\n                    chosenBuild.map((pick, index) => (\n                      <div className="final-full-pick" key={pick.id}>\n                        <SelectionCard\n                          pick={pick}\n                          index={index}\n                          selected={true}\n                          onToggle={() => {\n                            setBuildSelected((current) => { const next = new Set(current); next.delete(pick.id); return next; });\n                            setMinted(null); setOddsChanges([]);\n                          }}\n                        />\n                        <p>{pick.summary}</p>\n                        {pick.reasons.length > 0 && <small>Basis: {pick.reasons.slice(0, 2).join(" · ")}</small>}\n                      </div>\n                    ))\n                  )) : (\n                    <div className="final-empty-state">Your slip is empty. Add at least one game.</div>\n                  )}\n                </div>\n\n                <button type="button" onClick={() => setBuildScreen("games")} className="final-add-games">+ Add more games</button>\n\n                <div className="final-slip-summary">\n                  <div><span>Total Odds</span><strong>{activeOdds ? formatOdds(activeOdds) : "—"}</strong></div>\n                  <div><span>Total Games</span><strong>{chosenBuild.length}</strong></div>\n                  <div><span>Risk Mode</span><strong>{risk.charAt(0).toUpperCase() + risk.slice(1)}</strong></div>\n                </div>\n\n                <div className="final-booking-card">\n                  {!minted ? (\n                    <>\n                      <select value={targetBookmaker} onChange={(event) => { setTargetBookmaker(event.target.value as BookmakerId); setMinted(null); }}>\n                        {BOOKMAKERS.map((bookmaker) => <option key={bookmaker.value} value={bookmaker.value}>{bookmaker.label}</option>)}\n                      </select>\n                      {oddsChanges.length > 0 && <p className="final-odds-warning">Some prices changed. Review the refreshed odds before creating the code.</p>}\n                      <button type="button" disabled={pending !== null || !chosenBuild.length} onClick={() => void createCode()} className="premium-primary">\n                        {pending === "book" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}\n                        {pending === "book" ? "Refreshing selections…" : `Generate ${bookmakerLabel(targetBookmaker)} Code`}\n                        <ChevronRight className="h-4 w-4" />\n                      </button>\n                    </>\n                  ) : (\n                    <div className="final-minted-code">\n                      <small>Code created</small>\n                      <strong>{minted.code}</strong>\n                      <span>{minted.games} games · {minted.combinedOdds ? formatOdds(minted.combinedOdds) : "odds unavailable"}</span>\n                      <div>\n                        <button type="button" onClick={() => void copyCode()} className="premium-secondary">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy code"}</button>\n                        {minted.url && <a href={minted.url} target="_blank" rel="noreferrer" className="premium-secondary">Open <ExternalLink className="h-4 w-4" /></a>}\n                      </div>\n                    </div>\n                  )}\n                </div>\n              </div>\n            )}\n          </section>\n        )}\n\n`,
  "complete approved build flow",
  "final-build-flow",
);

console.log("SlipCut final mockup flow patch complete");
