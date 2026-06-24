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

// AnyTierSlug extends TierSlug with "team" for team/org accounts and
// "enterprise" for enterprise accounts (superset of team — same access + extras).
export type AnyTierSlug = TierSlug | "team" | "enterprise";

export type TierStatus = "active" | "retired" | "hidden";

export type Pricing =
  | { kind: "flat"; monthlyCents: number; annualCents?: number }
  | { kind: "seat"; seatCents: number; baseCents?: number; minSeats: number; interval: "year" }
  | { kind: "custom" }
  | { kind: "free" };

export type TierConfig = {
  slug: AnyTierSlug;
  displayName: string;
  status: TierStatus;
  pricing: Pricing;
  monthlyQueryLimit: number;
  unlocksProContent: boolean;
  skipStripe?: boolean;
  stripeProductDescription?: string;
  // Derived back-compat mirrors for flat tiers (estimating portal + legacy
  // consumers). Set by the `flat()` builder. Do NOT add new consumers — read
  // `pricing` / `displayPriceCentsFor` instead.
  monthlyPriceCents?: number;
  annualPriceCents?: number;
};

// Builds the flat-tier mirror fields from a single source.
function flat(monthlyCents: number, annualCents?: number): {
  pricing: Pricing; monthlyPriceCents: number; annualPriceCents?: number;
} {
  return {
    pricing: { kind: "flat", monthlyCents, annualCents },
    monthlyPriceCents: monthlyCents,
    annualPriceCents: annualCents,
  };
}

// Active plans for sale. Legacy slugs (starter, standard, pro, unlimited) are
// kept in TierSlug for Stripe back-compat but are not shown in the UI.
// New subscribers should only be on free, advisor, principal, team, or enterprise.
export const TIERS: readonly TierConfig[] = [
  {
    slug: "free", displayName: "Free Trial", status: "hidden",
    pricing: { kind: "free" }, monthlyQueryLimit: 5, unlocksProContent: false,
    skipStripe: true,
  },
  {
    slug: "advisor", displayName: "Advisor", status: "retired",
    ...flat(4900, 49000), monthlyQueryLimit: 50, unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Advisor — 50 queries/month and the full practitioner content library.",
  },
  {
    slug: "principal", displayName: "Principal", status: "active",
    ...flat(12900, 118800), monthlyQueryLimit: 9999, unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Principal — unlimited queries, full content library, and every practitioner skill.",
  },
  {
    slug: "team", displayName: "Team", status: "active",
    pricing: { kind: "seat", seatCents: 94800, minSeats: 5, interval: "year" },
    monthlyQueryLimit: 9999, unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Team — everything in Principal plus collaboration, API, and Lessons Learned, billed annually per seat.",
  },
  {
    slug: "enterprise", displayName: "Enterprise", status: "active",
    pricing: { kind: "custom" }, monthlyQueryLimit: 9999, unlocksProContent: true,
    stripeProductDescription:
      "KnowledgeBricks Enterprise — private vault, onboarding, experts, and SSO. Custom pricing.",
  },
] as const;

export function displayPriceCentsFor(t: TierConfig): number | null {
  switch (t.pricing.kind) {
    case "flat": return t.pricing.monthlyCents;
    case "seat": return t.pricing.seatCents;
    default:     return null;
  }
}

export function seatTotalCents(t: TierConfig, seats: number): number {
  if (t.pricing.kind !== "seat") throw new Error(`seatTotalCents: ${t.slug} is not seat-priced`);
  const n = Math.max(seats, t.pricing.minSeats);
  return n * t.pricing.seatCents + (t.pricing.baseCents ?? 0);
}

export function priceEnvVar(slug: string, interval: "month" | "year"): string {
  const suffix = interval === "year" ? "ANNUAL" : "MONTHLY";
  return `STRIPE_PRICE_SC_${slug.toUpperCase()}_${suffix}`;
}

export function seatPriceEnvVar(slug: string): string {
  return `STRIPE_PRICE_SC_${slug.toUpperCase()}_SEAT_ANNUAL`;
}

export const isSellable  = (t: TierConfig): boolean => t.status === "active";
export const isDisplayed = (t: TierConfig): boolean => t.status === "active";

export function getTierDisplayName(slug: TierSlug | string): string {
  // Canonical slugs
  if (slug === "advisor") return "Advisor";
  if (slug === "principal") return "Principal";
  if (slug === "team") return "Team";
  if (slug === "enterprise") return "Enterprise";
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
  if (slug === "enterprise") return "enterprise";
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
