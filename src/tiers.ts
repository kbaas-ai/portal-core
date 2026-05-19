// Canonical tier matrix — single source of truth for all portals.
//
// To change prices or query allowances: edit TIERS, re-run the Stripe
// bootstrap with --apply, and mirror the change in each portal's RUNBOOK.md.

export type TierSlug = "free" | "starter" | "standard" | "pro" | "unlimited";
export type PaidTierSlug = Exclude<TierSlug, "free">;

export type TierConfig = {
  slug: TierSlug;
  displayName: string;
  monthlyPriceCents: number;
  monthlyQueryLimit: number;
  unlocksProContent: boolean;
  skipStripe?: boolean;
  stripeProductDescription?: string;
};

export const TIERS: readonly TierConfig[] = [
  {
    slug: "free",
    displayName: "Free",
    monthlyPriceCents: 0,
    monthlyQueryLimit: 2,
    unlocksProContent: false,
    skipStripe: true,
  },
  {
    slug: "starter",
    displayName: "Support",
    monthlyPriceCents: 1900,
    monthlyQueryLimit: 25,
    unlocksProContent: false,
    stripeProductDescription:
      "Ask-a-SME Support — 25 queries/month. Metered access only; Advisor content remains locked.",
  },
  {
    slug: "pro",
    displayName: "Advisor",
    monthlyPriceCents: 4900,
    monthlyQueryLimit: 150,
    unlocksProContent: true,
    stripeProductDescription:
      "Ask-a-SME Advisor — 150 queries/month. Unlocks Advisor-tier content.",
  },
  {
    slug: "unlimited",
    displayName: "Principal",
    monthlyPriceCents: 9900,
    monthlyQueryLimit: 1000,
    unlocksProContent: true,
    stripeProductDescription:
      "Ask-a-SME Principal — unlimited queries (fair use). Unlocks Advisor-tier content.",
  },
] as const;

export function getTierDisplayName(slug: TierSlug): string {
  if (slug === "standard") return "Support";
  const match = TIERS.find((t) => t.slug === slug);
  return match?.displayName ?? "Free";
}

export function stripeMetadataFor(t: TierConfig): Record<string, string> {
  return {
    tier_slug: t.slug,
    monthly_query_limit: String(t.monthlyQueryLimit),
    unlocks_pro_content: String(t.unlocksProContent),
  };
}
