// core/src/admin/inspect.ts
// Read-only tier diagnostics for an email: the authoritative effective tier
// (via the real getUserAskTier) plus a per-source breakdown for debugging.

import { createClerkClient } from '@clerk/backend';
import { getUserAskTier, askTierRank } from '../access.ts';
import { normalizeTierSlug } from '../tiers.ts';
import { type AdminConfig, tierReadKeys, statusReadKeys, readMeta } from './config.ts';

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export interface TierBreakdown {
  clerkUser: { tier: string | null; status: string | null } | null;
  org: { tier: string | null } | null;
  compUser: { tier: string; type: string; expires_at: string | null } | null;
  compDomain: { tier: string; type: string; expires_at: string | null } | null;
  trial: { until: number | null; active: boolean } | null;
}

export interface InspectResult {
  email: string;
  found: boolean;
  effectiveTier: string;
  winningSource: ReturnType<typeof firstGrantingSource>;
  breakdown: TierBreakdown;
}

/** Pure precedence: which source grants the effective tier (matches getUserAskTier order). */
export function firstGrantingSource(
  b: TierBreakdown,
): 'clerkUser' | 'org' | 'compUser' | 'compDomain' | 'trial' | 'none' {
  const userGrants = !!(b.clerkUser?.tier && b.clerkUser.tier !== 'free' &&
      (!b.clerkUser.status || ACTIVE_STATUSES.has(b.clerkUser.status)));
  const orgGrants = !!(b.org?.tier && normalizeTierSlug(b.org.tier) !== 'free');
  // An active org entitlement overrides a lower personal tier; a higher
  // personal tier (or a tie) keeps clerkUser. Mirrors effectiveAskTier.
  if (userGrants && orgGrants) {
    return askTierRank(b.org!.tier!) > askTierRank(b.clerkUser!.tier!) ? 'org' : 'clerkUser';
  }
  if (userGrants) return 'clerkUser';
  if (orgGrants) return 'org';
  if (b.compUser?.tier && b.compUser.tier !== 'free') return 'compUser';
  if (b.compDomain?.tier && b.compDomain.tier !== 'free') return 'compDomain';
  if (b.trial?.active) return 'trial';
  return 'none';
}

function getEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name] !== undefined) return process.env[name];
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) return (import.meta as any).env[name];
  return undefined;
}

async function sbSelect(path: string): Promise<any[]> {
  const url = getEnv('SUPABASE_URL'); const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) return [];
  return (await res.json()) as any[];
}

/** Gather sources + authoritative tier for an email. IO — not unit-tested. */
export async function inspectEmail(email: string, cfg: AdminConfig): Promise<InspectResult> {
  const norm = email.trim().toLowerCase();
  const domain = norm.split('@')[1] ?? '';
  const breakdown: TierBreakdown = { clerkUser: null, org: null, compUser: null, compDomain: null, trial: null };

  const [cu] = await sbSelect(`comped_users?email=eq.${encodeURIComponent(norm)}&select=tier,type,expires_at&limit=1`);
  if (cu?.tier) breakdown.compUser = { tier: cu.tier, type: cu.type, expires_at: cu.expires_at ?? null };
  if (domain) {
    const [cd] = await sbSelect(`comp_domains?domain=eq.${encodeURIComponent(domain)}&select=tier,type,expires_at&limit=1`);
    if (cd?.tier) breakdown.compDomain = { tier: cd.tier, type: cd.type, expires_at: cd.expires_at ?? null };
  }

  let effectiveTier = 'free';
  let found = false;
  const secretKey = getEnv('CLERK_SECRET_KEY');
  if (secretKey) {
    try {
      const clerk = createClerkClient({ secretKey });
      const list = await clerk.users.getUserList({ emailAddress: [norm] });
      const user = list.data?.[0];
      if (user) {
        found = true;
        const meta = (user.publicMetadata || {}) as Record<string, any>;
        breakdown.clerkUser = {
          tier: readMeta(meta, tierReadKeys(cfg)),
          status: readMeta(meta, statusReadKeys(cfg)),
        };
        // Portals without a trial concept pass trialUntilKey: null and the
        // Inspector simply omits that source.
        if (cfg.trialUntilKey) {
          const until = meta[cfg.trialUntilKey];
          const ts = typeof until === 'string' ? Number(until) : (typeof until === 'number' ? until : null);
          breakdown.trial = { until: ts, active: !!ts && !isNaN(ts) && Date.now() < ts };
        }

        const memberships = await clerk.users.getOrganizationMembershipList({ userId: user.id, limit: 1 });
        const orgId = (memberships.data?.[0] as any)?.organization?.id ?? null;
        if (orgId) {
          const org = await clerk.organizations.getOrganization({ organizationId: orgId });
          const om = (org.publicMetadata || {}) as Record<string, any>;
          breakdown.org = { tier: readMeta(om, tierReadKeys(cfg)) };
        }
        effectiveTier = await getUserAskTier(
          { userId: user.id, orgId, has: () => false, sessionClaims: null },
          { topic: cfg.topic, legacyTierKey: cfg.legacyTierKey, legacyStatusKey: cfg.legacyStatusKey },
        );
      }
    } catch { /* fall through to free / source breakdown */ }
  }

  return { email: norm, found, effectiveTier, winningSource: firstGrantingSource(breakdown), breakdown };
}
