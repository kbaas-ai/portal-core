// Canonical tier matrix — single source of truth for all portals.
//
// To change prices or query allowances: edit TIERS, re-run the Stripe
// bootstrap with --apply, and mirror the change in each portal's RUNBOOK.md.

export type TierSlug =
  | "free"
  | "advisor"
  | "principal"
  // Legacy slugs — kept in TierSlug for Stripe back-compat; not shown in UI.
  | "starter"
  | "standard"
  | "pro"
  | "unlimited";

export type PaidTierSlug = Exclude<TierSlug, "free">;

// AnyTierSlug extends TierSlug with "team" for team/org accounts that
// are managed outside the self-serve Stripe flow.
export type AnyTierSlug = TierSlug | "team";

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

// Active plans for sale. Legacy slugs (starter, standard, pro, unlimited) are
// kept in TierSlug for Stripe back-compat but are not shown in the UI.
// New subscribers should only be on free, advisor, or principal.
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
    annualPriceCents: 49000,
    monthlyQueryLimit: 50,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Advisor — 50 queries/month and the full practitioner content library.",
  },
  {
    slug: "principal",
    displayName: "Principal",
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    monthlyQueryLimit: 9999,
    unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Principal — unlimited queries, full content library, and every practitioner skill.",
  },
] as const;

export function getTierDisplayName(slug: TierSlug | string): string {
  // Canonical slugs
  if (slug === "advisor") return "Advisor";
  if (slug === "principal") return "Principal";
  if (slug === "team") return "Team";
  // Legacy slug display names
  if (slug === "starter" || slug === "standard" || slug === "pro") return "Advisor";
  if (slug === "unlimited") return "Principal";
  const match = TIERS.find((t) => t.slug === slug);
  return match?.displayName ?? "Free Trial";
}

// Maps legacy or variant slugs to the canonical active slug.
export function normalizeTierSlug(slug: string): AnyTierSlug {
  if (slug === "advisor") return "advisor";
  if (slug === "principal") return "principal";
  if (slug === "starter" || slug === "standard" || slug === "pro") return "advisor";
  if (slug === "unlimited") return "principal";
  if (slug === "paid") return "advisor"; // binary paid fallback — preserves minimum paid access
  if (slug === "team") return "team";
  if (slug === "enterprise") return "team"; // legacy alias
  const known = new Set<string>(["free", "advisor", "principal", "team"]);
  return (known.has(slug) ? slug : "free") as AnyTierSlug;
}

export function stripeMetadataFor(t: TierConfig): Record<string, string> {
  return {
    tier_slug: t.slug,
    monthly_query_limit: String(t.monthlyQueryLimit),
    unlocks_pro_content: String(t.unlocksProContent),
  };
}
