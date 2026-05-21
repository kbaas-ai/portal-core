// Canonical tier matrix — single source of truth for all portals.
//
// To change prices or query allowances: edit TIERS, re-run the Stripe
// bootstrap with --apply, and mirror the change in each portal's RUNBOOK.md.

export type TierSlug = "free" | "starter" | "standard" | "advisor" | "pro" | "unlimited";
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

// Active plans for sale. Legacy slugs (starter, standard, unlimited) are kept
// in TierSlug for Stripe back-compat but are not shown in the UI. New subscribers
// should only be on free or pro (Practitioner).
export const TIERS: readonly TierConfig[] = [
  {
    slug: "free",
    displayName: "Free Trial",
    monthlyPriceCents: 0,
    monthlyQueryLimit: 5,
    unlocksProContent: false,
    skipStripe: true,
  },
  {
    slug: "advisor",
    displayName: "Advisor",
    monthlyPriceCents: 4900,
    monthlyQueryLimit: 50,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Advisor — 50 queries/month and full practitioner content access.",
  },
  {
    slug: "pro",
    displayName: "Practitioner",
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    monthlyQueryLimit: 9999,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Practitioner — unlimited queries and the full practitioner skills suite.",
  },
] as const;

export function getTierDisplayName(slug: TierSlug): string {
  if (slug === "standard" || slug === "starter") return "Practitioner";
  if (slug === "pro" || slug === "unlimited") return "Practitioner";
  if (slug === "advisor") return "Advisor";
  const match = TIERS.find((t) => t.slug === slug);
  return match?.displayName ?? "Free Trial";
}

// Maps legacy or variant slugs to the canonical active slug.
// "standard" was an early alias used before the logistics portal was
// re-launched — it maps to "pro" (same query allowance + content access).
export function normalizeTierSlug(slug: string): AnyTierSlug {
  if (slug === "standard") return "pro";
  const known = new Set<string>(["free", "starter", "standard", "advisor", "pro", "unlimited", "enterprise"]);
  return (known.has(slug) ? slug : "free") as AnyTierSlug;
}

export function stripeMetadataFor(t: TierConfig): Record<string, string> {
  return {
    tier_slug: t.slug,
    monthly_query_limit: String(t.monthlyQueryLimit),
    unlocks_pro_content: String(t.unlocksProContent),
  };
}
