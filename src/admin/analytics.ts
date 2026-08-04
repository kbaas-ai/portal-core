// src/lib/admin/analytics.ts
// Pure aggregation of admin grants for the analytics tab. `now` is injected so
// expiry math stays testable.

import type { CompUserRow, CompDomainRow } from './comps-db.ts';

const THIRTY_DAYS_MS = 30 * 86400000;

export interface GrantSummary {
  compUsers: number;
  compDomains: number;
  trials: number;
  expiringSoon: number;
  byTier: Record<string, number>;
}

/** Tally comp grants: totals, trials, expiring-within-30-days, and by-tier. */
export function summarizeGrants(users: CompUserRow[], domains: CompDomainRow[], now: number): GrantSummary {
  const byTier: Record<string, number> = {};
  let trials = 0;
  let expiringSoon = 0;

  const isExpiringSoon = (iso: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t > now && t <= now + THIRTY_DAYS_MS;
  };

  for (const u of users) {
    byTier[u.tier] = (byTier[u.tier] ?? 0) + 1;
    if (u.type === 'trial') trials += 1;
    if (isExpiringSoon(u.expires_at)) expiringSoon += 1;
  }
  for (const d of domains) {
    if (isExpiringSoon(d.expires_at)) expiringSoon += 1;
  }

  return { compUsers: users.length, compDomains: domains.length, trials, expiringSoon, byTier };
}
