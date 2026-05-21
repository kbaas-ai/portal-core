import type Stripe from "stripe";
import { createClerkClient } from "@clerk/backend";

export type SubTier = "advisor" | "principal" | "starter" | "standard" | "pro" | "unlimited";
type ClerkClient = ReturnType<typeof createClerkClient>;

const VALID_SUB_TIERS: ReadonlySet<string> = new Set<SubTier>([
  "advisor", "principal", "starter", "standard", "pro", "unlimited",
]);

export function decideTierForEvent(
  mappedTier: SubTier | null,
  existingTier: SubTier | null,
): { tier: SubTier; reason: "mapped" | "preserved" | "defaulted" } {
  if (mappedTier) return { tier: mappedTier, reason: "mapped" };
  if (existingTier) return { tier: existingTier, reason: "preserved" };
  return { tier: "pro", reason: "defaulted" };
}

export async function getExistingTier(
  clerk: ClerkClient,
  clerkUserId: string,
  tierKey: string,
  legacyTierKey?: string,
): Promise<SubTier | null> {
  const user = await clerk.users.getUser(clerkUserId);
  const meta = (user.publicMetadata as Record<string, unknown>) || {};
  const t = meta[tierKey] ?? (legacyTierKey ? meta[legacyTierKey] : undefined);
  return typeof t === "string" && VALID_SUB_TIERS.has(t) ? (t as SubTier) : null;
}

export async function syncToClerk(
  clerk: ClerkClient,
  clerkUserId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const user = await clerk.users.getUser(clerkUserId);
  const merged = { ...(user.publicMetadata as Record<string, unknown>), ...patch };
  await clerk.users.updateUserMetadata(clerkUserId, { publicMetadata: merged });
}

async function findClerkUserByEmail(
  clerk: ClerkClient,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  try {
    const res = await clerk.users.getUserList({ emailAddress: [normalized], limit: 10 });
    const list = (res as any).data ?? (res as any) ?? [];
    for (const u of list) {
      const emails: Array<{ emailAddress?: string }> = u.emailAddresses || [];
      if (emails.some((e) => (e.emailAddress || "").toLowerCase() === normalized)) return u.id;
    }
    return null;
  } catch (err) {
    console.error("[stripe-webhook][lookup] Clerk email lookup threw", err instanceof Error ? err.message : err);
    return null;
  }
}

async function customerEmail(stripe: Stripe, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if ((cust as Stripe.DeletedCustomer).deleted) return null;
    return ((cust as Stripe.Customer).email || "").toLowerCase() || null;
  } catch { return null; }
}

async function customerClerkIdFromMetadata(stripe: Stripe, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if ((cust as Stripe.DeletedCustomer).deleted) return null;
    const meta = (cust as Stripe.Customer).metadata || {};
    return (meta.clerk_user_id as string | undefined) || null;
  } catch { return null; }
}

export async function resolveClerkUserId(
  stripe: Stripe,
  clerk: ClerkClient,
  obj: {
    metadata?: Stripe.Metadata | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
    customer_email?: string | null;
    client_reference_id?: string | null;
  },
): Promise<{ userId: string; source: string } | null> {
  const direct = obj.metadata?.clerk_user_id;
  if (direct) return { userId: direct, source: "object.metadata" };

  if (obj.client_reference_id) return { userId: obj.client_reference_id, source: "client_reference_id" };

  const customerId =
    typeof obj.customer === "string"
      ? obj.customer
      : obj.customer && !("deleted" in obj.customer && obj.customer.deleted)
        ? (obj.customer as Stripe.Customer).id
        : null;

  const fromCustomerMeta = await customerClerkIdFromMetadata(stripe, customerId);
  if (fromCustomerMeta) return { userId: fromCustomerMeta, source: "customer.metadata" };

  const email = (obj.customer_email && obj.customer_email.toLowerCase()) || (await customerEmail(stripe, customerId));
  if (email) {
    const byEmail = await findClerkUserByEmail(clerk, email);
    if (byEmail) {
      if (customerId) {
        try {
          await stripe.customers.update(customerId, { metadata: { clerk_user_id: byEmail } });
        } catch (err) {
          console.warn("[stripe-webhook][lookup] failed to stamp customer.metadata.clerk_user_id", err instanceof Error ? err.message : err);
        }
      }
      return { userId: byEmail, source: "email" };
    }
  }

  return null;
}

export function logSyncFailure(eventType: string, eventId: string, detail: Record<string, unknown>): void {
  console.error(`[stripe-webhook][sync-failure] event=${eventType} id=${eventId}`, JSON.stringify(detail));
}
