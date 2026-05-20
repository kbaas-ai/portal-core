// Canonical tier matrix — single source of truth for all portals.
//
// Active slugs: free | advisor | principal | enterprise
// Legacy slugs: starter | standard | pro | unlimited
//   Legacy slugs are accepted as input (normalization in access.ts) but never emitted.
//
// To change prices or query allowances: edit TIERS, re-run the Stripe
// bootstrap with --apply, and mirror the change in each portal's RUNBOOK.md.

export type TierSlug = "free" | "advisor" | "principal" | "enterprise";
export type LegacyTierSlug = "starter" | "standard" | "pro" | "unlimited";
export type AnyTierSlug = TierSlug | LegacyTierSlug;
export type PaidTierSlug = Exclude<TierSlug, "free">;

export type TierConfig = {
  slug: TierSlug;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  monthlyQueryLimit: number;
  unlocksProContent: boolean;
  unlocksWorkflows: boolean;
  unlocksChat: boolean;
  unlocksConsult: boolean;
  skipStripe?: boolean;
  stripeProductDescription?: string;
};

export const TIERS: readonly TierConfig[] = [
  {
    slug: "free",
    displayName: "Free",
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    monthlyQueryLimit: 2,
    unlocksProContent: false,
    unlocksWorkflows: false,
    unlocksChat: false,
    unlocksConsult: false,
    skipStripe: true,
  },
  {
    slug: "advisor",
    displayName: "Advisor",
    monthlyPriceCents: 4900,
    annualPriceCents: 49000,
    monthlyQueryLimit: 50,
    unlocksProContent: true,
    unlocksWorkflows: false,
    unlocksChat: false,
    unlocksConsult: false,
    stripeProductDescription:
      "Ask-a-SME Advisor — 50 queries/month. Unlocks full content library.",
  },
  {
    slug: "principal",
    displayName: "Principal",
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    monthlyQueryLimit: 10000,
    unlocksProContent: true,
    unlocksWorkflows: true,
    unlocksChat: true,
    unlocksConsult: false,
    stripeProductDescription:
      "Ask-a-SME Principal — unlimited queries (fair use). Unlocks content library, advanced workflows, and 2-way chat.",
  },
  {
    slug: "enterprise",
    displayName: "Enterprise",
    monthlyPriceCents: 0,
    annualPriceCents: 500000, // $5,000/yr base; additional seats billed separately
    monthlyQueryLimit: 10000,
    unlocksProContent: true,
    unlocksWorkflows: true,
    unlocksChat: true,
    unlocksConsult: true,
    skipStripe: true, // invoice-only; no self-serve Stripe checkout
    stripeProductDescription:
      "Enterprise — 5 seats, annual billing. Includes all Principal features plus engagement sessions, project dashboard, SSO, and PO billing.",
  },
] as const;

// Legacy slug → active slug normalization map.
// Applied at the access layer and in the Stripe webhook handler.
// Remove once the subscriber backfill confirms all users have been migrated.
export const LEGACY_SLUG_MAP: Record<LegacyTierSlug, TierSlug> = {
  starter: "advisor",
  standard: "advisor",
  pro: "principal",
  unlimited: "principal",
};

export function normalizeTierSlug(slug: string): TierSlug {
  if (slug in LEGACY_SLUG_MAP) return LEGACY_SLUG_MAP[slug as LegacyTierSlug];
  const active: TierSlug[] = ["free", "advisor", "principal", "enterprise"];
  if (active.includes(slug as TierSlug)) return slug as TierSlug;
  return "free";
}

export function getTierDisplayName(slug: AnyTierSlug | string): string {
  const normalized = normalizeTierSlug(slug);
  const match = TIERS.find((t) => t.slug === normalized);
  return match?.displayName ?? "Free";
}

export function getTierConfig(slug: AnyTierSlug | string): TierConfig {
  const normalized = normalizeTierSlug(slug);
  return TIERS.find((t) => t.slug === normalized) ?? TIERS[0];
}

export function stripeMetadataFor(t: TierConfig): Record<string, string> {
  return {
    tier_slug: t.slug,
    monthly_query_limit: String(t.monthlyQueryLimit),
    unlocks_pro_content: String(t.unlocksProContent),
    unlocks_workflows: String(t.unlocksWorkflows),
    unlocks_chat: String(t.unlocksChat),
  };
}
