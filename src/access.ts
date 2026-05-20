import { createClerkClient } from "@clerk/backend";
import { TIERS, type TierSlug } from "./tiers.js";

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
const compDomainCache = new Map<string, { tier: "paid" | null; ts: number }>();
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

async function tierFromCompDomain(userId: string): Promise<"paid" | null> {
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
    const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/comp_domains?domain=eq.${encodeURIComponent(domain)}&select=tier&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) { compDomainCache.set(domain, { tier: null, ts: Date.now() }); return null; }
    const rows = (await res.json()) as Array<{ tier?: string }>;
    const raw = rows[0]?.tier;
    const tier: "paid" | null = (raw && raw !== "free") ? "paid" : null;
    compDomainCache.set(domain, { tier, ts: Date.now() });
    return tier;
  } catch {
    compDomainCache.set(domain, { tier: null, ts: Date.now() });
    return null;
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
  const fromComp = await tierFromCompDomain(auth.userId);
  if (fromComp) return fromComp;
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

const KNOWN_TIER_SLUGS: ReadonlySet<TierSlug> = new Set<TierSlug>([
  "free", "starter", "standard", "pro", "unlimited",
]);

export async function getUserAskTier(auth: ClerkAuth, cfg: TopicConfig): Promise<TierSlug> {
  if (!auth.userId) return "free";

  const meta = claimsMetadata(auth);
  const tierKey = `${cfg.topic}_subscription_tier`;
  const statusKey = `${cfg.topic}_subscription_status`;
  const claimTier = meta[tierKey] ?? (cfg.legacyTierKey ? meta[cfg.legacyTierKey] : undefined);
  const claimStatus = meta[statusKey] ?? (cfg.legacyStatusKey ? meta[cfg.legacyStatusKey] : undefined);
  if (claimTier && KNOWN_TIER_SLUGS.has(claimTier as TierSlug)) {
    if (!claimStatus || ACTIVE_STATUSES.has(claimStatus)) return claimTier as TierSlug;
  }

  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (secretKey) {
    try {
      const clerk = createClerkClient({ secretKey });
      const user = await clerk.users.getUser(auth.userId);
      const m = (user.publicMetadata || {}) as Record<string, string | undefined>;
      const mTier = m[`${cfg.topic}_subscription_tier`] ?? (cfg.legacyTierKey ? m[cfg.legacyTierKey] : undefined);
      const mStatus = m[`${cfg.topic}_subscription_status`] ?? (cfg.legacyStatusKey ? m[cfg.legacyStatusKey] : undefined);
      if (mTier && KNOWN_TIER_SLUGS.has(mTier as TierSlug)) {
        if (!mStatus || ACTIVE_STATUSES.has(mStatus)) return mTier as TierSlug;
      }
    } catch { /* fall through */ }
  }

  return await getUserTier(auth, cfg);
}

// Display labels
export const PLAN_DISPLAY: Record<PlanSlug | "free", string> = {
  free: "Free",
  paid: "Advisor",
};

export const TIER_DISPLAY: Record<ContentTier, string> = {
  free: "Free",
  paid: "Advisor",
};

const FREE_TIER = TIERS.find((t) => t.slug === "free")!;

export function monthlyQueryLimitForTier(tier: TierSlug | null | undefined): number {
  if (tier === "standard") {
    const pro = TIERS.find((t) => t.slug === "pro");
    if (pro) return pro.monthlyQueryLimit;
  }
  const match = TIERS.find((t) => t.slug === tier);
  return (match ?? FREE_TIER).monthlyQueryLimit;
}

export function canUseSkills(tier: TierSlug | null | undefined): boolean {
  return tier === "unlimited";
}

export function unlocksProContentForTier(tier: TierSlug | null | undefined): boolean {
  if (!tier || tier === "free") return false;
  // Any active paid subscription (starter, pro, unlimited, or legacy standard) unlocks content.
  return true;
}

export type { TierSlug } from "./tiers.js";
