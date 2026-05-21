// Canonical tier matrix — single source of truth for all portals.
//
// To change prices or query allowances: edit TIERS, re-run the Stripe
// bootstrap with --apply, and mirror the change in each portal's RUNBOOK.md.

export type TierSlug = "free" | "starter" | "standard" | "pro" | "unlimited";
export type PaidTierSlug = Exclude<TierSlug, "free">;

// AnyTierSlug extends TierSlug with "enterprise" for team/org accounts that
// are managed outside the self-serve Stripe flow.
export type AnyTierSlug = TierSlug | "enterprise";

export type TierConfig = {
  slug: TierSlug;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents?: number;
  monthlyQueryLimit: number;
  unlocksProContent: boolean;
  skipStripe?: boolean;
  stripeProductDescription?: string;
};

// Active plans for sale. Legacy slugs (starter, standard) are kept in TierSlug for
// backwards compatibility with existing subscribers, but are not shown in the UI.
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
    slug: "pro",
    displayName: "Advisor",
    monthlyPriceCents: 4900,
    monthlyQueryLimit: 50,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Advisor — 50 Ask-a-SME queries/month and full practitioner content library.",
  },
  {
    slug: "unlimited",
    displayName: "Principal",
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    monthlyQueryLimit: 1000,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Principal — unlimited queries, SME coaching workflows, and full practitioner content library.",
  },
] as const;

export function getTierDisplayName(slug: TierSlug): string {
  if (slug === "standard" || slug === "starter") return "Support";
  if (slug === "pro") return "Advisor";
  const match = TIERS.find((t) => t.slug === slug);
  return match?.displayName ?? "Free";
}

// Maps legacy or variant slugs to the canonical active slug.
// "standard" was an early alias used before the logistics portal was
// re-launched — it maps to "pro" (same query allowance + content access).
export function normalizeTierSlug(slug: string): AnyTierSlug {
  if (slug === "standard") return "pro";
  const known = new Set<string>(["free", "starter", "standard", "pro", "unlimited", "enterprise"]);
  return (known.has(slug) ? slug : "free") as AnyTierSlug;
}

export function stripeMetadataFor(t: TierConfig): Record<string, string> {
  return {
    tier_slug: t.slug,
    monthly_query_limit: String(t.monthlyQueryLimit),
    unlocks_pro_content: String(t.unlocksProContent),
  };
}
