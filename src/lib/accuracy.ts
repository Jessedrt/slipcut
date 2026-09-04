import { getSql } from "./db.ts";
import type { AccuracyStats, GroupRate } from "./accuracy-gate.ts";
export {
  accuracyFilter,
  groupAllowed,
  pickFamily,
  type AccuracyStats,
  type GroupRate,
} from "./accuracy-gate.ts";

type LessonRow = { sport: string; family: string; result: string };

/**
 * Load the engine's settled record from `study_lessons` and turn it into the
 * AccuracyStats the pure gate in accuracy-gate.ts consumes.
 */
export async function loadAccuracy(): Promise<AccuracyStats> {
  try {
    const sql = await getSql();
    const rows = await sql<LessonRow>`
      select sport, family, result from study_lessons where result in ('won', 'lost')
    `;
    const groups: Record<string, GroupRate> = {};
    let won = 0;
    let lost = 0;
    for (const row of rows) {
      const key = `${row.sport}|${row.family}`;
      const g = (groups[key] ??= { won: 0, lost: 0, rate: 0 });
      if (row.result === "won") {
        g.won += 1;
        won += 1;
      } else {
        g.lost += 1;
        lost += 1;
      }
    }
    for (const key of Object.keys(groups)) {
      const g = groups[key]!;
      g.rate = g.won + g.lost > 0 ? g.won / (g.won + g.lost) : 0;
    }
    const sampleCount = won + lost;
    return {
      average: sampleCount > 0 ? won / sampleCount : 0,
      sampleCount,
      groups,
    };
  } catch {
    return { average: 0, sampleCount: 0, groups: {} };
  }
}
