import { normalizeTierSlug, type AnyTierSlug } from "./tiers.js";

/** Capability flags that are not implied by billing interval. */
export type Capability = "sso";

export type BillingInterval = "monthly" | "annual";

/**
 * The composable replacement for a single tier slug.
 * - base: has the $25 Platform seat (projects/engagements/reporting)
 * - vaults: normalized knowledge-vault grants (the retrieval allow-list)
 * - caps: non-billing capability flags (currently just sso)
 * - billing: monthly | annual (annual is what unlocks API/webhooks)
 */
export type Entitlements = {
  base: boolean;
  vaults: string[];
  caps: Record<Capability, boolean>;
  billing: BillingInterval;
};

export type EntitlementsInput = {
  base?: boolean;
  vaults?: string[];
  caps?: Partial<Record<Capability, boolean>>;
  billing?: BillingInterval;
};

/** Normalizes a vault id: trimmed, lowercased. */
function normalizeVault(v: string): string {
  return v.trim().toLowerCase();
}

/** Constructs a fully-normalized Entitlements value. Always returns fresh arrays/objects. */
export function makeEntitlements(input: EntitlementsInput = {}): Entitlements {
  const vaults = Array.from(
    new Set((input.vaults ?? []).map(normalizeVault).filter(Boolean)),
  ).sort();
  return {
    base: input.base ?? false,
    vaults,
    caps: { sso: input.caps?.sso ?? false },
    billing: input.billing ?? "monthly",
  };
}

export type { AnyTierSlug };
export { normalizeTierSlug };
