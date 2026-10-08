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
  '@import "./final-ui.css";',
  '@import "./final-ui.css";\n@import "./mockup-ui.css";',
  "mockup stylesheet import",
);

replaceOnce(
  component,
  '<button type="button" onClick={openBot} className="premium-icon-button" aria-label="Open SlipCut bot">',
  '<button type="button" onClick={openBot} className="premium-icon-button mockup-bell" aria-label="Open SlipCut bot">',
  "bare bell treatment",
);

replaceOnce(
  component,
  '<span>⚽</span> Football',
  'Football',
  "remove home football emoji",
);
replaceOnce(
  component,
  '<span>🏀</span> Basketball',
  'Basketball',
  "remove home basketball emoji",
);

replaceOnce(
  component,
  '<div><span>Build</span><h2>Select Sport</h2></div>',
  '<div><h2>Select Sport</h2></div>',
  "clean sport title",
);
replaceOnce(
  component,
  '<p className="final-subcopy">Choose what you want SlipCut to scan.</p>',
  '',
  "remove sport helper copy",
);
replaceOnce(
  component,
  '<span><strong>Basketball</strong><small>Over markets only</small></span>',
  '<span><strong>Basketball</strong><small>All major leagues</small></span>',
  "match basketball sport subtitle",
);

replaceOnce(
  component,
  '<div className="final-games-title">\n                    <span>{windowChoice}</span>\n                    <h2>{sport === "football" ? "Football" : "Basketball"}</h2>\n                  </div>',
  '<div className="final-games-title">\n                    <h2>{sport === "football" ? "Football" : "Basketball"}</h2>\n                    <span>{windowChoice}⌄</span>\n                  </div>',
  "match game-list title order",
);

replaceOnce(
  component,
  '<span className="final-game-tick">{selected ? <Check className="h-4 w-4" /> : "+"}</span>',
  '<span className="final-game-tick"><b>{pick.home.slice(0, 2).toUpperCase()}</b>{selected && <Check className="final-game-selected h-3 w-3" />}</span>',
  "team badge rows",
);

replaceOnce(
  component,
  '<div><span>Review</span><h2>Slip Builder</h2></div>',
  '<div><h2>Slip Builder</h2></div>',
  "clean slip builder title",
);

replaceOnce(
  component,
  '<div><span>Daily ladders</span><h2>Engine Accumulators</h2></div>',
  '<div><h2>Engine</h2></div>',
  "clean engine title",
  false,
);
replaceOnce(
  component,
  '<div><span>Cut / Trim Slip</span><h2>Remove the weak legs</h2></div>',
  '<div><h2>Cut / Trim Slip</h2></div>',
  "clean cut title",
  false,
);
replaceOnce(
  component,
  '<div><span>Library</span><h2>My Slips</h2></div>',
  '<div><h2>My Slips</h2></div>',
  "clean slips title",
  false,
);

console.log("SlipCut approved mockup visual patch complete");
