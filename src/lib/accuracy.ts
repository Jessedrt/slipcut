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

function summarize(rows: LessonRow[]): AccuracyStats {
  const groups: Record<string, GroupRate> = {};
  let won = 0;
  let lost = 0;
  for (const row of rows) {
    const key = `${row.sport}|${row.family}`;
    const group = (groups[key] ??= { won: 0, lost: 0, rate: 0 });
    if (row.result === "won") {
      group.won += 1;
      won += 1;
    } else if (row.result === "lost") {
      group.lost += 1;
      lost += 1;
    }
  }
  for (const key of Object.keys(groups)) {
    const group = groups[key]!;
    group.rate =
      group.won + group.lost > 0 ? group.won / (group.won + group.lost) : 0;
  }
  const sampleCount = won + lost;
  return {
    average: sampleCount > 0 ? won / sampleCount : 0,
    sampleCount,
    groups,
  };
}

/**
 * Load the engine's settled record.
 *
 * recommendation_record is the primary source because every successful Mini App
 * build is written there and the daily cron grades it automatically. Older
 * study_lessons remain as a fallback for installations that predate the record
 * table or have not accumulated recommendation history yet.
 */
export async function loadAccuracy(): Promise<AccuracyStats> {
  try {
    const sql = await getSql();
    const recommendations = await sql<LessonRow>`
      select sport, family, result
      from recommendation_record
      where result in ('won', 'lost')
        and settled_at >= now() - interval '365 days'
    `;
    if (recommendations.length) return summarize(recommendations);

    const lessons = await sql<LessonRow>`
      select sport, family, result
      from study_lessons
      where result in ('won', 'lost')
    `;
    return summarize(lessons);
  } catch {
    return { average: 0, sampleCount: 0, groups: {} };
  }
}
