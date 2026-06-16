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

/** True if the user holds the given vault grant (id is normalized before compare). */
export function hasVault(ent: Entitlements, vaultId: string): boolean {
  return ent.vaults.includes(normalizeVault(vaultId));
}

/**
 * The knowledge-retrieval allow-list: which vaults this user may query.
 * Empty unless the user holds the base seat (knowledge is a base-gated add-on).
 */
export function vaultScope(ent: Entitlements): string[] {
  return ent.base ? [...ent.vaults] : [];
}

/** Unlocks Ask/Search/Cowork + domain tools: base seat plus at least one vault. */
export function canUseKnowledge(ent: Entitlements): boolean {
  return ent.base && ent.vaults.length > 0;
}

/** API/webhooks ("Team"): base seat on annual billing. Annual is the sole gate. */
export function canUseApi(ent: Entitlements): boolean {
  return ent.base && ent.billing === "annual";
}

/** SSO: base seat plus the sso capability (the IT-asks-for-it add-on). */
export function canUseSso(ent: Entitlements): boolean {
  return ent.base && ent.caps.sso;
}

/**
 * Lossy, transitional mapping from Entitlements → a legacy tier slug, so existing
 * normalizeTierSlug-based page guards keep working while chunk #5 migrates them to
 * the predicates above. The mapping is intentionally approximate:
 *   - base-only (no vault) → "advisor": closest legacy paid slug. NOTE: advisor's
 *     legacy semantics (content unlock) don't match base-only (no knowledge); base
 *     users' engagement access is corrected when guards move to canUseKnowledge/
 *     canUseApi in chunk #5. Do not add new product logic on top of this slug.
 *   - advisor and principal both collapse here to the same "principal" once a vault
 *     is held, matching the spec's "advisor/principal retired → base + vault".
 */
export function deriveTierSlug(ent: Entitlements): AnyTierSlug {
  if (!ent.base) return "free";
  if (canUseSso(ent)) return "enterprise";
  if (canUseApi(ent)) return "team";
  if (ent.vaults.length > 0) return "principal";
  return "advisor";
}

/**
 * Transitional bridge: builds Entitlements from today's resolved tier slug so new
 * entitlement-aware code can run off existing Clerk/Supabase data before the
 * dedicated entitlements store (chunk #2) exists. `defaultVault` is the topic vault
 * a legacy paid subscriber is assumed to hold (logistics portal → "logistics").
 */
export function entitlementsFromTierSlug(
  slug: AnyTierSlug,
  opts: { defaultVault: string },
): Entitlements {
  switch (slug) {
    case "free":
      return makeEntitlements();
    case "advisor":
    case "principal":
      return makeEntitlements({ base: true, vaults: [opts.defaultVault] });
    case "team":
      return makeEntitlements({ base: true, vaults: [opts.defaultVault], billing: "annual" });
    case "enterprise":
      return makeEntitlements({
        base: true,
        vaults: [opts.defaultVault],
        billing: "annual",
        caps: { sso: true },
      });
    default: {
      // Legacy slugs (starter/standard/pro/unlimited): normalize, then re-map.
      const canonical = normalizeTierSlug(slug);
      if (canonical === slug) return makeEntitlements(); // guard against loops
      return entitlementsFromTierSlug(canonical, opts);
    }
  }
}

export type { AnyTierSlug };
export { normalizeTierSlug };
