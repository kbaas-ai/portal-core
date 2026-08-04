// core/src/admin/clerk-comps.ts
// Surfaces and safely clears MANUAL Clerk-metadata comps (a tier set directly on
// a Clerk user's publicMetadata, NOT backed by a Stripe subscription). The
// classifier is pure + unit-tested; the safety guard (never touch a billing-
// backed tier) is enforced in clearClerkComp before any write.

import { createClerkClient } from '@clerk/backend';
import { type AdminConfig, statusKey, tierReadKeys } from './config.ts';

const SUB_ID_KEY = 'stripe_subscription_id';

export interface TierClassification {
  tier: string | null;
  status: string | null;
  billingBacked: boolean;
  isManualComp: boolean;
}

/** Pure: classify a Clerk user's publicMetadata tier as paid vs. manual comp. */
export function classifyClerkUserTier(
  meta: Record<string, unknown> | null | undefined,
  cfg: AdminConfig,
): TierClassification {
  const m = meta ?? {};
  let tier: string | null = null;
  for (const k of tierReadKeys(cfg)) {
    const v = (m as any)[k];
    if (typeof v === 'string' && v) { tier = v; break; }
  }
  const statusRaw = (m as any)[statusKey(cfg)];
  const status = typeof statusRaw === 'string' ? statusRaw : null;
  const subId = (m as any)[SUB_ID_KEY];
  const billingBacked = subId != null && subId !== '';
  const isManualComp = tier != null && tier !== 'free' && !billingBacked;
  return { tier, status, billingBacked, isManualComp };
}

function getClerk() {
  const secretKey = (import.meta as any).env?.CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');
  return createClerkClient({ secretKey });
}

export interface ClerkCompRow {
  userId: string;
  email: string | null;
  tier: string;
  status: string | null;
}

const SCAN_PAGE = 100;
const SCAN_CAP = 500;

/**
 * Scan Clerk users and return those whose access is a manual comp. Capped at
 * SCAN_CAP users; returns `capped: true` when the user base exceeds the cap so
 * the UI can warn rather than silently undercount.
 */
export async function listClerkComps(cfg: AdminConfig): Promise<{ comps: ClerkCompRow[]; capped: boolean; scanned: number; totalUsers: number }> {
  const clerk = getClerk();
  const comps: ClerkCompRow[] = [];
  let offset = 0;
  let scanned = 0;
  let total = Infinity;
  while (offset < total && offset < SCAN_CAP) {
    const res = await clerk.users.getUserList({ limit: SCAN_PAGE, offset } as any);
    const data = (res.data ?? []) as any[];
    total = (res as any).totalCount ?? data.length;
    scanned += data.length;
    for (const u of data) {
      const c = classifyClerkUserTier(u.publicMetadata, cfg);
      if (c.isManualComp && c.tier) {
        comps.push({
          userId: u.id,
          email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? null,
          tier: c.tier,
          status: c.status,
        });
      }
    }
    if (data.length < SCAN_PAGE) break;
    offset += SCAN_PAGE;
  }
  return { comps, capped: total > SCAN_CAP, scanned, totalUsers: Number.isFinite(total) ? total : scanned };
}

/**
 * Clear a manual Clerk-metadata comp. Refuses (throws CompGuardError) if the
 * user's tier is billing-backed, so a real subscription can never be wiped.
 */
export class CompGuardError extends Error {}

export async function clearClerkComp(userId: string, cfg: AdminConfig): Promise<void> {
  const clerk = getClerk();
  const user = await clerk.users.getUser(userId);
  const meta = (user.publicMetadata || {}) as Record<string, unknown>;
  const c = classifyClerkUserTier(meta, cfg);
  if (c.billingBacked) {
    throw new CompGuardError('This tier is backed by a Stripe subscription — clear it from billing, not here.');
  }
  if (!c.isManualComp) {
    throw new CompGuardError('This user has no manual Clerk comp to clear.');
  }
  // Preserve all other metadata; null out the tier + status keys only.
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...meta,
      ...Object.fromEntries(tierReadKeys(cfg).map((k) => [k, null])),
      [statusKey(cfg)]: null,
    },
  } as any);
}
