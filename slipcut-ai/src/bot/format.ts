import type { AnalyzedSelection, BuiltSlip } from "../types/index.js";

function riskEmoji(r?: string) {
  if (r === "lower") return "🟢";
  if (r === "higher") return "🔴";
  return "🟡";
}

export function formatSlip(slip: BuiltSlip, title = "🔥 SlipCut Analysis"): string {
  const lines = [title, ""];
  slip.legs.forEach((leg, i) => {
    lines.push(`${i + 1}. ${leg.home} vs ${leg.away}`);
    lines.push(`   ${leg.marketName} · ${leg.selectionName}`);
    lines.push(
      `   Odds ${leg.odds.toFixed(2)} · Conf ${Math.round((leg.modelProbability || 0) * 100)}% ${riskEmoji(leg.riskLevel)}`,
    );
    lines.push("");
  });
  lines.push(`Combined odds: ${slip.combinedOdds.toFixed(2)}`);
  if (slip.targetOdds) lines.push(`Target: ~${slip.targetOdds}`);
  lines.push(`Risk mode: ${slip.riskMode}`);
  lines.push("");
  lines.push("_Not financial advice. Odds can change._");
  return lines.join("\n");
}

export function formatSelectionCard(leg: AnalyzedSelection): string {
  return [
    `⚽ ${leg.home} vs ${leg.away}`,
    `Selection: ${leg.selectionName}`,
    `Market: ${leg.marketName}`,
    `Odds: ${leg.odds.toFixed(2)}`,
    `Model confidence: ${Math.round(leg.modelProbability * 100)}%`,
    `Risk: ${riskEmoji(leg.riskLevel)} ${leg.riskLevel}`,
    `Why: ${leg.reasoning}`,
  ].join("\n");
}

export const START_TEXT = `Welcome to SlipCut AI 👋
Your AI assistant for football and basketball match analysis.

I can help you:
⚽ Analyze football matches
🏀 Analyze basketball games
📊 Compare markets
🎯 Build selections around your requested game count
📈 Work toward a target odds range
🧠 Rank selections by model confidence
✂️ Remove or replace weak selections
🔀 Split large tickets
📸 Analyze screenshots
🎟️ Read supported booking codes
🔎 Explore SportyBet markets
🔗 Prepare supported SportyBet booking codes

Try:
"Give me 5 football games today"
"Give me basketball selections around 6 odds"
"Find 7 games with high confidence"
"Analyze this ticket"
"Remove the weakest two"
"Split this ticket into 2"
"Explore all markets for Arsenal vs Chelsea"`;
