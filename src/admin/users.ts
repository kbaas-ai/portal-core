// core/src/admin/users.ts
// Admin user directory: maps Clerk users to roster rows + lists them via the
// Clerk backend SDK. Pure mapping is unit-tested; the Clerk client is created
// per-call like firm-type.ts.

import { createClerkClient } from '@clerk/backend';
import { type AdminConfig, tierReadKeys, readMeta } from './config.ts';

// Minimal shape of a Clerk user we depend on (keeps the pure mapper testable
// without importing Clerk's full User type).
export interface ClerkUserLike {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: Array<{ emailAddress?: string | null }> | null;
  publicMetadata?: Record<string, unknown> | null;
  createdAt?: number | null;
}

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  ownTier: string | null;
  createdAt: string | null;
}

/** Pure: map a Clerk user to a roster row. `ownTier` is the user's OWN metadata
 *  tier only — NOT the authoritative effective tier (that's the Inspector). */
export function clerkUserToRow(u: ClerkUserLike, cfg: AdminConfig): UserRow {
  const email =
    u.primaryEmailAddress?.emailAddress ??
    u.emailAddresses?.[0]?.emailAddress ??
    null;
  const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const rawTier = readMeta(u.publicMetadata as Record<string, unknown> | null, tierReadKeys(cfg));
  return {
    id: u.id,
    name: fullName || email || u.id,
    email,
    ownTier: rawTier,
    createdAt: typeof u.createdAt === 'number' ? new Date(u.createdAt).toISOString() : null,
  };
}

function getClerk() {
  const secretKey = (import.meta as any).env?.CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');
  return createClerkClient({ secretKey });
}

/** List users (optionally filtered by Clerk's `query` search) as roster rows. */
export async function listUsers(query: string, limit: number, cfg: AdminConfig): Promise<{ users: UserRow[]; totalCount: number }> {
  const params: Record<string, unknown> = { limit, orderBy: '-created_at' };
  const q = query.trim();
  if (q) params.query = q;
  const res = await getClerk().users.getUserList(params as any);
  const data = (res.data ?? []) as ClerkUserLike[];
  return { users: data.map((u) => clerkUserToRow(u, cfg)), totalCount: (res as any).totalCount ?? data.length };
}
