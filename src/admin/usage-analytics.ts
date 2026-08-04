// src/lib/admin/usage-analytics.ts
// Pure aggregation of the questions log + tool_usage telemetry for the admin
// analytics tab. Rows are expected newest-first (the API queries order desc),
// so "recent" lists are simply the first N matches.

export interface QuestionRow {
  question_text: string | null;
  user_tier: string | null;
  matched_slugs: string[] | null;
  answered: boolean | null;
  was_locked: boolean | null;
  created_at: string;
}

export interface RecentQuestion {
  text: string;
  tier: string;
  at: string;
}

export interface DemandSummary {
  total: number;
  unanswered: number;
  locked: number;
  byTier: Record<string, number>;
  topSlugs: Array<{ slug: string; count: number }>;
  recentUnanswered: RecentQuestion[];
  recentLocked: RecentQuestion[];
}

const RECENT_LIMIT = 10;
const TOP_SLUGS_LIMIT = 10;

/**
 * Tally the questions log: volume, unmet demand (answered=false), paywall
 * friction (was_locked=true), tier mix, and skill demand (matched_slugs).
 */
export function summarizeQuestions(rows: QuestionRow[]): DemandSummary {
  const byTier: Record<string, number> = {};
  const slugCounts: Record<string, number> = {};
  const recentUnanswered: RecentQuestion[] = [];
  const recentLocked: RecentQuestion[] = [];
  let unanswered = 0;
  let locked = 0;

  for (const r of rows) {
    const tier = r.user_tier ?? 'unknown';
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    for (const slug of r.matched_slugs ?? []) {
      slugCounts[slug] = (slugCounts[slug] ?? 0) + 1;
    }
    if (r.answered === false && !r.was_locked) {
      unanswered += 1;
      if (recentUnanswered.length < RECENT_LIMIT && r.question_text) {
        recentUnanswered.push({ text: r.question_text, tier, at: r.created_at });
      }
    }
    if (r.was_locked === true) {
      locked += 1;
      if (recentLocked.length < RECENT_LIMIT && r.question_text) {
        recentLocked.push({ text: r.question_text, tier, at: r.created_at });
      }
    }
  }

  const topSlugs = Object.entries(slugCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SLUGS_LIMIT)
    .map(([slug, count]) => ({ slug, count }));

  return { total: rows.length, unanswered, locked, byTier, topSlugs, recentUnanswered, recentLocked };
}

/** Tally tool_usage rows into per-tool counts. */
export function summarizeToolUsage(rows: Array<{ tool: string }>): Record<string, number> {
  const byTool: Record<string, number> = {};
  for (const r of rows) byTool[r.tool] = (byTool[r.tool] ?? 0) + 1;
  return byTool;
}
