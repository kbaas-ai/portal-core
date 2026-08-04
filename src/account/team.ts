// core/src/account/team.ts
// Pure helpers for org team management — no Clerk imports so they're unit-testable.
// Roles use Clerk's native org role slugs.

export const ROLE_ADMIN = 'org:admin';
export const ROLE_MEMBER = 'org:member';
export type OrgRole = typeof ROLE_ADMIN | typeof ROLE_MEMBER;

const ROLES: readonly string[] = [ROLE_ADMIN, ROLE_MEMBER];

export type InviteInput = { email: string; role: OrgRole };
export type InviteResult = { ok: true; value: InviteInput } | { ok: false; error: string };

/** Validate + normalize an invite request (email + role). */
export function validateInviteInput(email: string, role: string): InviteResult {
  const e = (email ?? '').trim().toLowerCase();
  // Require a local part, an @, and a dotted domain.
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return { ok: false, error: 'a valid email is required' };
  }
  if (!ROLES.includes(role)) {
    return { ok: false, error: 'role must be admin or member' };
  }
  return { ok: true, value: { email: e, role: role as OrgRole } };
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether `targetId` may be removed from the org. Blocks self-removal and
 * removing the last remaining admin (which would lock the org out).
 */
export function canRemoveMember(args: {
  targetId: string; targetRole: string; selfId: string; adminCount: number;
}): GuardResult {
  const { targetId, targetRole, selfId, adminCount } = args;
  if (targetId === selfId) return { ok: false, reason: 'You cannot remove yourself.' };
  if (targetRole === ROLE_ADMIN && adminCount <= 1) {
    return { ok: false, reason: 'You cannot remove the last admin.' };
  }
  return { ok: true };
}

/**
 * Seat usage for cap enforcement: active members PLUS pending invitations, so
 * an admin can't hold invites open to slip past the purchased-seat cap.
 */
export function seatUsage(memberCount: number, pendingInviteCount: number): number {
  return memberCount + pendingInviteCount;
}

/**
 * Whether a new invite may be sent. `seats == null` means no purchased seat
 * count on the org (comped/manual) — unlimited, matching existing behavior.
 * Existing members are never affected by the cap; only new invites are blocked.
 */
export function canInvite(args: { used: number; seats: number | null }): GuardResult {
  const { used, seats } = args;
  if (seats == null) return { ok: true };
  if (used < seats) return { ok: true };
  return { ok: false, reason: `All ${seats} purchased seats are in use (including pending invites). Add seats or remove a member first.` };
}

export type SeatChangeResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Validate a requested seat count. Floor = max(current usage, plan minimum):
 * you can't shrink below the people already on (or invited to) the plan, or
 * below the Team plan's seat minimum.
 */
export function validateSeatChange(args: { newSeats: number; used: number; minSeats: number }): SeatChangeResult {
  const { newSeats, used, minSeats } = args;
  if (typeof newSeats !== 'number' || !Number.isInteger(newSeats)) {
    return { ok: false, error: 'seats must be a whole number' };
  }
  const floor = Math.max(used, minSeats);
  if (newSeats < floor) {
    return { ok: false, error: `seats cannot go below ${floor} (current usage or plan minimum)` };
  }
  return { ok: true, value: newSeats };
}

export interface SeatSubscription {
  items: { data: Array<{ id: string; quantity?: number | null }> };
  metadata: Record<string, string> | null;
}

export interface SeatUpdateParams {
  items: Array<{ id: string; quantity: number }>;
  metadata: Record<string, string>;
  proration_behavior: 'create_prorations' | 'none';
}

export type SeatUpdateResult = { ok: true; value: SeatUpdateParams } | { ok: false; error: string };

/**
 * Build the Stripe `subscriptions.update` params for a seat change: the real
 * line-item quantity (what Stripe bills) plus `metadata.seats` (what the
 * webhook mirrors to Clerk org metadata) in one atomic call. Increases prorate
 * immediately; decreases don't refund mid-year — the lower price applies at renewal.
 */
export function buildSeatUpdateParams(sub: SeatSubscription, newSeats: number): SeatUpdateResult {
  const item = sub.items?.data?.[0];
  if (!item) return { ok: false, error: 'subscription has no line item' };
  const current = item.quantity ?? 0;
  return {
    ok: true,
    value: {
      items: [{ id: item.id, quantity: newSeats }],
      metadata: { ...(sub.metadata ?? {}), seats: String(newSeats) },
      proration_behavior: newSeats > current ? 'create_prorations' : 'none',
    },
  };
}

/**
 * Whether `targetId`'s role may change to `newRole`. Blocks changing your own
 * role and demoting the last remaining admin.
 */
export function canChangeRole(args: {
  targetId: string; targetCurrentRole: string; newRole: string; selfId: string; adminCount: number;
}): GuardResult {
  const { targetId, targetCurrentRole, newRole, selfId, adminCount } = args;
  if (!ROLES.includes(newRole)) return { ok: false, reason: 'Invalid role.' };
  if (targetId === selfId) return { ok: false, reason: 'You cannot change your own role.' };
  if (targetCurrentRole === ROLE_ADMIN && newRole === ROLE_MEMBER && adminCount <= 1) {
    return { ok: false, reason: 'You cannot demote the last admin.' };
  }
  return { ok: true };
}
