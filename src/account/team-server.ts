// core/src/account/team-server.ts
// Clerk-backend wrappers for org team management. All Clerk SDK surface lives
// here so the API routes stay thin. Pure decisions live in ./team.ts.

import { createClerkClient } from '@clerk/backend';
import { ROLE_ADMIN, ROLE_MEMBER, type OrgRole } from './team.ts';
import { type TopicKeyConfig, teamSeatsKey } from '../topic-config.ts';

function getClerk() {
  const secretKey = (import.meta as any).env?.CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');
  return createClerkClient({ secretKey });
}

/** Normalize Clerk's role slug to our two canonical roles. */
function normalizeRole(raw: unknown): OrgRole {
  return raw === ROLE_ADMIN || raw === 'admin' ? ROLE_ADMIN : ROLE_MEMBER;
}

export interface Member {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: OrgRole;
  joinedAt: string | null;
}
export interface Invitation {
  id: string;
  email: string | null;
  role: OrgRole;
  createdAt: string | null;
}
export interface OrgMeta {
  name: string;
  purchased_seats: number | null;
}

function isoOrNull(ms: unknown): string | null {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null;
}

export async function fetchMembers(orgId: string): Promise<Member[]> {
  const res = await getClerk().organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 });
  return (res.data ?? []).map((m: any) => ({
    userId: m.publicUserData?.userId ?? '',
    firstName: m.publicUserData?.firstName ?? null,
    lastName: m.publicUserData?.lastName ?? null,
    email: m.publicUserData?.identifier ?? null,
    role: normalizeRole(m.role),
    joinedAt: isoOrNull(m.createdAt),
  }));
}

export async function fetchInvitations(orgId: string): Promise<Invitation[]> {
  const res = await getClerk().organizations.getOrganizationInvitationList({
    organizationId: orgId, status: ['pending'], limit: 100,
  } as any);
  return (res.data ?? []).map((i: any) => ({
    id: i.id,
    email: i.emailAddress ?? null,
    role: normalizeRole(i.role),
    createdAt: isoOrNull(i.createdAt),
  }));
}

export async function fetchOrgMeta(orgId: string, cfg: TopicKeyConfig): Promise<OrgMeta> {
  const org = await getClerk().organizations.getOrganization({ organizationId: orgId });
  const raw = (org.publicMetadata as any)?.[teamSeatsKey(cfg)];
  const seats = raw == null ? null : Number(raw);
  return {
    name: org.name ?? 'Your team',
    purchased_seats: Number.isFinite(seats) ? (seats as number) : null,
  };
}

/** Billing pointers for the seats route: Stripe sub id + purchased seats. */
export async function fetchOrgBilling(orgId: string, cfg: TopicKeyConfig): Promise<{ subscriptionId: string | null; seats: number | null }> {
  const org = await getClerk().organizations.getOrganization({ organizationId: orgId });
  const meta = (org.publicMetadata ?? {}) as Record<string, unknown>;
  const rawSeats = meta[teamSeatsKey(cfg)];
  const seats = rawSeats == null ? null : Number(rawSeats);
  const subId = meta.stripe_subscription_id;
  return {
    subscriptionId: typeof subId === 'string' && subId ? subId : null,
    seats: Number.isFinite(seats) ? (seats as number) : null,
  };
}

/**
 * Write the new seat count to the Clerk org: publicMetadata mirror (immediate
 * UI consistency — the stripe webhook later re-writes the same value) and
 * maxAllowedMemberships as a backstop so memberships created outside our
 * routes are capped by Clerk itself.
 */
export async function syncOrgSeats(orgId: string, seats: number, cfg: TopicKeyConfig): Promise<void> {
  const clerk = getClerk();
  const org = await clerk.organizations.getOrganization({ organizationId: orgId });
  const existing = (org.publicMetadata ?? {}) as Record<string, unknown>;
  await clerk.organizations.updateOrganization(orgId, {
    publicMetadata: { ...existing, [teamSeatsKey(cfg)]: seats },
    maxAllowedMemberships: seats,
  } as any);
}

export function adminCount(members: Member[]): number {
  return members.filter((m) => m.role === ROLE_ADMIN).length;
}

/**
 * Resolve the caller's org context for write routes: their userId, active orgId,
 * the full member list, and whether they're an admin. Null when there's no
 * authenticated org session.
 */
export async function loadOrgContext(
  locals: App.Locals,
): Promise<{ userId: string; orgId: string; members: Member[]; isAdmin: boolean } | null> {
  const auth = locals.auth?.();
  const userId = auth?.userId ?? null;
  const orgId = auth?.orgId ?? null;
  if (!userId || !orgId) return null;
  const members = await fetchMembers(orgId);
  const isAdmin = members.some((m) => m.userId === userId && m.role === ROLE_ADMIN);
  return { userId, orgId, members, isAdmin };
}

export async function createInvite(orgId: string, email: string, role: OrgRole, inviterUserId: string): Promise<void> {
  await getClerk().organizations.createOrganizationInvitation({
    organizationId: orgId, emailAddress: email, role, inviterUserId,
  } as any);
}

export async function setRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await getClerk().organizations.updateOrganizationMembership({ organizationId: orgId, userId, role } as any);
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  await getClerk().organizations.deleteOrganizationMembership({ organizationId: orgId, userId } as any);
}

export async function revokeInvite(orgId: string, invitationId: string, requestingUserId: string): Promise<void> {
  await getClerk().organizations.revokeOrganizationInvitation({
    organizationId: orgId, invitationId, requestingUserId,
  } as any);
}

export { ROLE_ADMIN, ROLE_MEMBER };
