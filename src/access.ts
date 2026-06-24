import { createClerkClient } from "@clerk/backend";
import { TIERS, normalizeTierSlug, type TierSlug, type AnyTierSlug } from "./tiers.js";

export type ContentTier = "free" | "paid";
export type PlanSlug = "paid";
export type Tier = ContentTier;

/**
 * Passed to every access function so the same code works for any topic.
 * `topic` is the Clerk metadata key prefix: "logistics" → keys
 * "logistics_subscription_tier" / "logistics_subscription_status".
 * Set legacyTierKey/legacyStatusKey when migrating from shared keys
 * (e.g. logistics portal has existing "subscription_tier" subscribers).
 */
export type TopicConfig = {
  topic: string;
  legacyTierKey?: string;
  legacyStatusKey?: string;
};

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  paid: 1,
} as const;

export function hasAccess(userTier: Tier, requiredTier: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier];
}

function tiersAtOrBelow(userTier: Tier): ContentTier[] {
  return (Object.keys(TIER_RANK) as Tier[]).filter((t) => hasAccess(userTier, t));
}

export type ClerkAuth = {
  userId: string | null;
  orgId?: string | null;
  has: (params: { plan: string }) => boolean;
  sessionClaims?: Record<string, unknown> | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const PUBLIC_EMAIL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "ymail.com", "rocketmail.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.us", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
  "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com", "duck.com",
]);

function getEnv(name: string): string | undefined {
  // @ts-ignore
  const fromMeta = (typeof import.meta !== "undefined" && (import.meta as any).env)
    ? (import.meta as any).env[name]
    : undefined;
  return fromMeta || (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

// Caches keyed by `${topic}:${userId}` (topic-scoped) or `${userId}` / domain.
const userMetaCache = new Map<string, { tier: "paid" | null; ts: number }>();
const userEmailCache = new Map<string, { email: string | null; ts: number }>();
const compDomainCache = new Map<string, { tier: AnyTierSlug | null; ts: number }>();
const compUserCache = new Map<string, { tier: AnyTierSlug | null; ts: number }>();
const orgMetaCache = new Map<string, { rawTier: string | null; isActive: boolean; ts: number }>();
const userOrgCache = new Map<string, { orgId: string | null; ts: number }>();
const META_CACHE_MS = 5_000;

function claimsMetadata(auth: ClerkAuth): Record<string, string | undefined> {
  const claims = auth.sessionClaims as {
    public_metadata?: Record<string, string | undefined>;
    user_public_metadata?: Record<string, string | undefined>;
  } | null | undefined;
  return claims?.public_metadata || claims?.user_public_metadata || {};
}

function getPrimaryEmail(user: {
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id: string; emailAddress: string }>;
}): string | null {
  const list = user.emailAddresses || [];
  if (!list.length) return null;
  const primary = list.find((e) => e.id === user.primaryEmailAddressId) || list[0];
  return primary?.emailAddress?.toLowerCase() || null;
}

async function tierFromClerkAPI(userId: string, cfg: TopicConfig): Promise<"paid" | null> {
  const cacheKey = `${cfg.topic}:${userId}`;
  const cached = userMetaCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached.tier;

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) return null;

  try {
    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(userId);
    const meta = (user.publicMetadata || {}) as Record<string, string | undefined>;

    const tierKey = `${cfg.topic}_subscription_tier`;
    const statusKey = `${cfg.topic}_subscription_status`;
    const rawTier = meta[tierKey] ?? (cfg.legacyTierKey ? meta[cfg.legacyTierKey] : undefined);
    const status = meta[statusKey] ?? (cfg.legacyStatusKey ? meta[cfg.legacyStatusKey] : undefined);

    if (status && !ACTIVE_STATUSES.has(status)) {
      userMetaCache.set(cacheKey, { tier: null, ts: Date.now() });
      userEmailCache.set(userId, { email: getPrimaryEmail(user), ts: Date.now() });
      return null;
    }
    const tier: "paid" | null = (rawTier && rawTier !== "free") ? "paid" : null;
    userMetaCache.set(cacheKey, { tier, ts: Date.now() });
    userEmailCache.set(userId, { email: getPrimaryEmail(user), ts: Date.now() });
    return tier;
  } catch {
    return null;
  }
}

async function emailForUser(userId: string): Promise<string | null> {
  const cached = userEmailCache.get(userId);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached.email;

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) return null;

  try {
    const clerk = createClerkClient({ secretKey });
    const user = await clerk.users.getUser(userId);
    const email = getPrimaryEmail(user);
    userEmailCache.set(userId, { email, ts: Date.now() });
    return email;
  } catch {
    userEmailCache.set(userId, { email: null, ts: Date.now() });
    return null;
  }
}

function domainFromEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.includes("@")) return null;
  return domain;
}

async function tierFromCompUser(userId: string): Promise<AnyTierSlug | null> {
  const email = await emailForUser(userId);
  if (!email) return null;

  const cached = compUserCache.get(email);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached.tier;

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/comped_users?email=eq.${encodeURIComponent(email)}&select=tier,expires_at&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) { compUserCache.set(email, { tier: null, ts: Date.now() }); return null; }
    const rows = (await res.json()) as Array<{ tier?: string; expires_at?: string | null }>;
    const row = rows[0];
    if (!row?.tier || row.tier === "free") { compUserCache.set(email, { tier: null, ts: Date.now() }); return null; }
    const expired = row.expires_at && new Date(row.expires_at) < new Date();
    if (expired) { compUserCache.set(email, { tier: null, ts: Date.now() }); return null; }
    const tier = normalizeTierSlug(row.tier);
    compUserCache.set(email, { tier, ts: Date.now() });
    return tier;
  } catch {
    compUserCache.set(email, { tier: null, ts: Date.now() });
    return null;
  }
}

async function tierFromCompDomain(userId: string): Promise<AnyTierSlug | null> {
  const email = await emailForUser(userId);
  const domain = domainFromEmail(email);
  if (!domain) return null;
  if (PUBLIC_EMAIL_PROVIDERS.has(domain)) return null;

  const cached = compDomainCache.get(domain);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached.tier;

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/comp_domains?domain=eq.${encodeURIComponent(domain)}&select=tier,expires_at&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) { compDomainCache.set(domain, { tier: null, ts: Date.now() }); return null; }
    const rows = (await res.json()) as Array<{ tier?: string; expires_at?: string | null }>;
    const row = rows[0];
    if (!row?.tier || row.tier === "free") { compDomainCache.set(domain, { tier: null, ts: Date.now() }); return null; }
    const expired = row.expires_at && new Date(row.expires_at) < new Date();
    if (expired) { compDomainCache.set(domain, { tier: null, ts: Date.now() }); return null; }
    const tier = normalizeTierSlug(row.tier);
    compDomainCache.set(domain, { tier, ts: Date.now() });
    return tier;
  } catch {
    compDomainCache.set(domain, { tier: null, ts: Date.now() });
    return null;
  }
}

async function rawTierFromClerkOrg(orgId: string, cfg: TopicConfig): Promise<{ rawTier: string | null; isActive: boolean }> {
  const cacheKey = `org:${cfg.topic}:${orgId}`;
  const cached = orgMetaCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached;

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) return { rawTier: null, isActive: false };

  try {
    const clerk = createClerkClient({ secretKey });
    const org = await clerk.organizations.getOrganization({ organizationId: orgId });
    const meta = (org.publicMetadata || {}) as Record<string, string | undefined>;
    const rawTier = meta[`${cfg.topic}_subscription_tier`] ?? null;
    const status = meta[`${cfg.topic}_subscription_status`] ?? null;
    const isActive = !status || ACTIVE_STATUSES.has(status);
    orgMetaCache.set(cacheKey, { rawTier, isActive, ts: Date.now() });
    return { rawTier, isActive };
  } catch {
    orgMetaCache.set(cacheKey, { rawTier: null, isActive: false, ts: Date.now() });
    return { rawTier: null, isActive: false };
  }
}

function tierFromSessionClaims(auth: ClerkAuth, cfg: TopicConfig): "paid" | null {
  const meta = claimsMetadata(auth);
  const tierKey = `${cfg.topic}_subscription_tier`;
  const statusKey = `${cfg.topic}_subscription_status`;
  const tier = meta[tierKey] ?? (cfg.legacyTierKey ? meta[cfg.legacyTierKey] : undefined);
  const status = meta[statusKey] ?? (cfg.legacyStatusKey ? meta[cfg.legacyStatusKey] : undefined);
  if (!tier || tier === "free") return null;
  if (status && !ACTIVE_STATUSES.has(status)) return null;
  return "paid";
}

function hasPlan(auth: ClerkAuth): boolean {
  return (
    auth.has({ plan: "advisor" }) ||
    auth.has({ plan: "principal" }) ||
    auth.has({ plan: "pro" }) ||
    auth.has({ plan: "reader_pro" }) ||
    auth.has({ plan: "standard" }) ||
    auth.has({ plan: "reader_basic" }) ||
    auth.has({ plan: "starter" }) ||
    auth.has({ plan: "unlimited" })
  );
}

export async function getUserTier(auth: ClerkAuth, cfg: TopicConfig): Promise<Tier> {
  if (!auth.userId) return "free";
  const fromClaims = tierFromSessionClaims(auth, cfg);
  if (fromClaims) return fromClaims;
  const fromApi = await tierFromClerkAPI(auth.userId, cfg);
  if (fromApi) return fromApi;
  if (auth.orgId) {
    const { rawTier, isActive } = await rawTierFromClerkOrg(auth.orgId, cfg);
    if (rawTier && rawTier !== "free" && isActive) return "paid";
  }
  const fromCompUser = await tierFromCompUser(auth.userId);
  if (fromCompUser) return "paid";
  const fromComp = await tierFromCompDomain(auth.userId);
  if (fromComp) return "paid";
  if (hasPlan(auth)) return "paid";
  return "free";
}

export async function getUserTiers(auth: ClerkAuth, cfg: TopicConfig): Promise<ContentTier[]> {
  return tiersAtOrBelow(await getUserTier(auth, cfg));
}

export function canRead(userTiers: ContentTier[], pageTier: ContentTier): boolean {
  return userTiers.includes(pageTier);
}

export async function getUserPlan(auth: ClerkAuth, cfg: TopicConfig): Promise<"paid" | null> {
  const tier = await getUserTier(auth, cfg);
  return tier === "free" ? null : "paid";
}

const KNOWN_TIER_SLUGS: ReadonlySet<AnyTierSlug> = new Set<AnyTierSlug>([
  "free", "advisor", "principal", "starter", "standard", "pro", "unlimited", "team", "enterprise",
]);

// Access ordering for resolving the effective ask-tier when more than one
// source applies. Higher = more access. Legacy/variant slugs are normalized
// to a canonical slug first (e.g. unlimited → principal).
const ASK_TIER_RANK: Record<string, number> = {
  free: 0, advisor: 1, principal: 2, team: 3, enterprise: 4,
};

export function askTierRank(slug: string): number {
  return ASK_TIER_RANK[normalizeTierSlug(slug)] ?? 0;
}

/**
 * Resolve the effective ask-tier from a user-level and an org-level tier.
 * The higher-ranked of the two wins, so an org entitlement RAISES the effective
 * tier above a lower personal subscription (an enterprise-org member who also
 * carries a personal Team plan resolves to enterprise), while a higher personal
 * tier is never downgraded by a lower org tier. Ties keep the personal slug.
 */
export function effectiveAskTier(
  userTier: string | null,
  orgTier: string | null,
): string | null {
  if (!userTier) return orgTier;
  if (!orgTier) return userTier;
  return askTierRank(userTier) >= askTierRank(orgTier) ? userTier : orgTier;
}

export async function getUserAskTier(auth: ClerkAuth, cfg: TopicConfig): Promise<AnyTierSlug> {
  if (!auth.userId) return "free";

  // 1) User-level tier — session claims first, then the Clerk user record.
  let userTier: AnyTierSlug | null = null;

  const meta = claimsMetadata(auth);
  const tierKey = `${cfg.topic}_subscription_tier`;
  const statusKey = `${cfg.topic}_subscription_status`;
  const claimTier = meta[tierKey] ?? (cfg.legacyTierKey ? meta[cfg.legacyTierKey] : undefined);
  const claimStatus = meta[statusKey] ?? (cfg.legacyStatusKey ? meta[cfg.legacyStatusKey] : undefined);
  if (claimTier && KNOWN_TIER_SLUGS.has(claimTier as TierSlug)) {
    if (!claimStatus || ACTIVE_STATUSES.has(claimStatus)) userTier = claimTier as AnyTierSlug;
  }

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!userTier && secretKey) {
    try {
      const clerk = createClerkClient({ secretKey });
      const user = await clerk.users.getUser(auth.userId);
      const m = (user.publicMetadata || {}) as Record<string, string | undefined>;
      const mTier = m[`${cfg.topic}_subscription_tier`] ?? (cfg.legacyTierKey ? m[cfg.legacyTierKey] : undefined);
      const mStatus = m[`${cfg.topic}_subscription_status`] ?? (cfg.legacyStatusKey ? m[cfg.legacyStatusKey] : undefined);
      if (mTier && KNOWN_TIER_SLUGS.has(mTier as TierSlug)) {
        if (!mStatus || ACTIVE_STATUSES.has(mStatus)) userTier = mTier as AnyTierSlug;
      }
    } catch { /* fall through */ }
  }

  // 2) Org-level subscription — when the user has an active org session, the
  // org entitlement RAISES the effective tier above a lower personal plan (so
  // an enterprise-org member with a personal Team plan resolves to enterprise).
  // The higher-ranked of (user, org) wins; see effectiveAskTier.
  if (auth.orgId) {
    const { rawTier, isActive } = await rawTierFromClerkOrg(auth.orgId, cfg);
    if (rawTier && isActive) {
      const orgTier = normalizeTierSlug(rawTier);
      if (orgTier !== "free") {
        return effectiveAskTier(userTier, orgTier) as AnyTierSlug;
      }
    }
  }

  if (userTier) return userTier;

  // 3) Check individual email comp first (overrides domain), then domain comp.
  const fromCompUser = await tierFromCompUser(auth.userId);
  if (fromCompUser) return fromCompUser;
  const fromComp = await tierFromCompDomain(auth.userId);
  if (fromComp) return fromComp;

  // Last resort: check Clerk plan claims for the specific tier slug.
  // This preserves principal vs advisor distinction when metadata keys are absent.
  if (auth.has({ plan: "principal" }) || auth.has({ plan: "unlimited" })) return "principal";
  if (auth.has({ plan: "advisor" }) || auth.has({ plan: "pro" }) || auth.has({ plan: "standard" }) || auth.has({ plan: "starter" })) return "advisor";

  return "free";
}

// Display labels for the binary ContentTier (free/paid).
// Pages that need per-slug display names should use getTierDisplayName() from tiers.ts.
export const PLAN_DISPLAY: Record<PlanSlug | "free", string> = {
  free: "Free",
  paid: "Paid",
};

export const TIER_DISPLAY: Record<ContentTier, string> = {
  free: "Free",
  paid: "Paid",
};

const FREE_TIER = TIERS.find((t) => t.slug === "free")!;

export function monthlyQueryLimitForTier(tier: AnyTierSlug | null | undefined): number {
  if (tier === "team" || tier === "enterprise") return 9999;  // team/enterprise = unlimited
  // Legacy slugs: map to canonical equivalent before lookup.
  const canonical =
    tier === "standard" || tier === "starter" || tier === "pro" ? "advisor" :
    tier === "unlimited" ? "principal" :
    tier;
  const match = TIERS.find((t) => t.slug === canonical);
  return (match ?? FREE_TIER).monthlyQueryLimit;
}

// Accepts AnyTierSlug (incl. team/enterprise) — callers like getUserAskTier
// return AnyTierSlug, and the body already resolves those slugs via
// normalizeTierSlug. Mirrors monthlyQueryLimitForTier's signature.
export function canUseSkills(tier: AnyTierSlug | null | undefined): boolean {
  if (!tier) return false;
  const n = normalizeTierSlug(tier);
  return n === "principal" || n === "team" || n === "enterprise";
}

// Workflows and coached sessions — Principal tier and above.
export function canUseChat(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const n = normalizeTierSlug(tier);
  return n === "principal" || n === "team" || n === "enterprise";
}

// Engagement Hub / consult features — Principal tier and above.
export function canUseConsult(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const n = normalizeTierSlug(tier);
  return n === "principal" || n === "team" || n === "enterprise";
}

export function unlocksProContentForTier(tier: TierSlug | null | undefined): boolean {
  if (!tier || tier === "free") return false;
  // Any active paid subscription (starter, pro, unlimited, or legacy standard) unlocks content.
  return true;
}

// Returns the first Clerk org ID the user belongs to, or null. Used to scope
// shared resources (e.g. proposals) for users without an active org session.
export async function getPrimaryOrgId(userId: string): Promise<string | null> {
  const cached = userOrgCache.get(userId);
  if (cached && Date.now() - cached.ts < META_CACHE_MS) return cached.orgId;

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) return null;

  try {
    const clerk = createClerkClient({ secretKey });
    const { data: memberships } = await clerk.users.getOrganizationMembershipList({ userId, limit: 1 });
    const orgId = (memberships[0] as any)?.organization?.id ?? null;
    userOrgCache.set(userId, { orgId, ts: Date.now() });
    return orgId;
  } catch {
    userOrgCache.set(userId, { orgId: null, ts: Date.now() });
    return null;
  }
}

export type { TierSlug, AnyTierSlug } from "./tiers.js";
