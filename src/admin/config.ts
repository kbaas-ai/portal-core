// core/src/admin/config.ts
//
// Every portal stores its subscription state under its OWN Clerk metadata
// prefix (`logistics_subscription_tier`, `estimating_subscription_tier`, …),
// mirroring TopicConfig in ../access.ts. The admin modules used to hardcode the
// logistics prefix, which is what stopped them being shareable.
//
// A portal constructs one of these once and passes it to the admin functions.

export interface AdminConfig {
  /** Metadata key prefix: "logistics" -> logistics_subscription_tier. */
  topic: string;
  /** Pre-topic key still present on older accounts, e.g. "subscription_tier". */
  legacyTierKey?: string;
  /** Pre-topic status key, e.g. "subscription_status". */
  legacyStatusKey?: string;
  /**
   * Clerk metadata key holding the trial expiry timestamp, or null on portals
   * with no trial concept (the Tier Inspector then omits the trial source).
   */
  trialUntilKey?: string | null;
}

export function tierKey(cfg: AdminConfig): string {
  return `${cfg.topic}_subscription_tier`;
}

export function statusKey(cfg: AdminConfig): string {
  return `${cfg.topic}_subscription_status`;
}

/** Tier metadata keys to READ, in precedence order (topic key first). */
export function tierReadKeys(cfg: AdminConfig): string[] {
  return cfg.legacyTierKey ? [tierKey(cfg), cfg.legacyTierKey] : [tierKey(cfg)];
}

/** Status metadata keys to READ, in precedence order. */
export function statusReadKeys(cfg: AdminConfig): string[] {
  return cfg.legacyStatusKey ? [statusKey(cfg), cfg.legacyStatusKey] : [statusKey(cfg)];
}

/** First non-nullish value across `keys` in a metadata bag. */
export function readMeta(
  meta: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!meta) return null;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
