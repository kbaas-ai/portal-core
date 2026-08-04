// core/src/account/handlers.ts
//
// Org team-management API handlers, as factories bound to a portal's topic
// config. Ported verbatim from the logistics routes — the guard rails here
// (admin-only, no self-removal, no removing the last admin, seat cap) are
// exactly the logic that must not drift between portals.
//
// Seat BILLING is deliberately not here. Changing a seat count means mutating
// a Stripe seat-priced subscription, which only exists on a portal that sells
// one; see seats-server.ts in the logistics portal.

import { type TopicKeyConfig } from "../topic-config.ts";
import { validateInviteInput, seatUsage, canInvite, canRemoveMember, canChangeRole } from "./team.ts";
import {
  fetchMembers,
  fetchInvitations,
  fetchOrgMeta,
  loadOrgContext,
  adminCount,
  createInvite,
  setRole,
  removeMember,
  revokeInvite,
  ROLE_ADMIN,
} from "./team-server.ts";

export interface TeamCtx {
  locals: any;
  request: Request;
  params?: Record<string, string | undefined>;
}

export interface TeamDeps {
  cfg: TopicKeyConfig;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── GET /api/account/team/members ──────────────────────────────────────────
// org: null when the caller has no active org session — the client renders an
// empty state rather than an error.
export function membersListHandler({ cfg }: TeamDeps) {
  return async ({ locals }: TeamCtx) => {
    const auth = locals.auth?.();
    const userId = auth?.userId ?? null;
    if (!userId) return json({ error: "not_authenticated" }, 401);
    const orgId = auth?.orgId ?? null;
    if (!orgId) {
      return json({ org: null, members: [], invitations: [], selfId: userId, isAdmin: false });
    }
    try {
      const [members, invitations, org] = await Promise.all([
        fetchMembers(orgId),
        fetchInvitations(orgId),
        fetchOrgMeta(orgId, cfg),
      ]);
      const isAdmin = members.some((m) => m.userId === userId && m.role === ROLE_ADMIN);
      return json({ org, members, invitations, selfId: userId, isAdmin });
    } catch (e: any) {
      return json({ error: e?.message ?? "failed to load team" }, 502);
    }
  };
}

// ── POST /api/account/team/invite ──────────────────────────────────────────
export function inviteHandler({ cfg }: TeamDeps) {
  return async ({ locals, request }: TeamCtx) => {
    const ctx = await loadOrgContext(locals);
    if (!ctx) return json({ error: "org_session_required" }, 400);
    if (!ctx.isAdmin) return json({ error: "admin_required" }, 403);

    let body: { email?: string; role?: string };
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const result = validateInviteInput(body.email ?? "", body.role ?? "");
    if (!result.ok) return json({ error: result.error }, 400);

    // Seat cap: members + pending invites must stay below purchased seats.
    // A portal that never writes a seat count has purchased_seats null, and
    // canInvite treats that as uncapped.
    const [meta, invitations] = await Promise.all([
      fetchOrgMeta(ctx.orgId, cfg),
      fetchInvitations(ctx.orgId),
    ]);
    const used = seatUsage(ctx.members.length, invitations.length);
    const gate = canInvite({ used, seats: meta.purchased_seats });
    if (!gate.ok) {
      return json(
        { error: "seat_limit_reached", reason: gate.reason, seats: meta.purchased_seats, used },
        409,
      );
    }

    try {
      await createInvite(ctx.orgId, result.value.email, result.value.role, ctx.userId);
    } catch (e: any) {
      // Clerk returns a useful message for already-member / already-invited.
      return json({ error: e?.errors?.[0]?.message ?? e?.message ?? "invite failed" }, 400);
    }
    return json({ ok: true }, 201);
  };
}

// ── PATCH /api/account/team/members/[id] ───────────────────────────────────
export function memberRoleHandler(_deps: TeamDeps) {
  return async ({ locals, params, request }: TeamCtx) => {
    const ctx = await loadOrgContext(locals);
    if (!ctx) return json({ error: "org_session_required" }, 400);
    if (!ctx.isAdmin) return json({ error: "admin_required" }, 403);

    const targetId = decodeURIComponent(params?.id ?? "");
    const target = ctx.members.find((m) => m.userId === targetId);
    if (!target) return json({ error: "not_found" }, 404);

    let body: { role?: string };
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const newRole = body.role ?? "";

    const guard = canChangeRole({
      targetId,
      targetCurrentRole: target.role,
      newRole,
      selfId: ctx.userId,
      adminCount: adminCount(ctx.members),
    });
    if (!guard.ok) return json({ error: guard.reason }, 400);

    try {
      await setRole(ctx.orgId, targetId, newRole as any);
    } catch (e: any) {
      return json({ error: e?.message ?? "role change failed" }, 502);
    }
    return json({ ok: true });
  };
}

// ── DELETE /api/account/team/members/[id] ──────────────────────────────────
export function memberRemoveHandler(_deps: TeamDeps) {
  return async ({ locals, params }: TeamCtx) => {
    const ctx = await loadOrgContext(locals);
    if (!ctx) return json({ error: "org_session_required" }, 400);
    if (!ctx.isAdmin) return json({ error: "admin_required" }, 403);

    const targetId = decodeURIComponent(params?.id ?? "");
    const target = ctx.members.find((m) => m.userId === targetId);
    if (!target) return json({ error: "not_found" }, 404);

    const guard = canRemoveMember({
      targetId,
      targetRole: target.role,
      selfId: ctx.userId,
      adminCount: adminCount(ctx.members),
    });
    if (!guard.ok) return json({ error: guard.reason }, 400);

    try {
      await removeMember(ctx.orgId, targetId);
    } catch (e: any) {
      return json({ error: e?.message ?? "remove failed" }, 502);
    }
    return json({ ok: true });
  };
}

// ── DELETE /api/account/team/invitations/[id] ──────────────────────────────
export function invitationRevokeHandler(_deps: TeamDeps) {
  return async ({ locals, params }: TeamCtx) => {
    const ctx = await loadOrgContext(locals);
    if (!ctx) return json({ error: "org_session_required" }, 400);
    if (!ctx.isAdmin) return json({ error: "admin_required" }, 403);

    const invitationId = decodeURIComponent(params?.id ?? "");
    if (!invitationId) return json({ error: "bad request" }, 400);

    try {
      await revokeInvite(ctx.orgId, invitationId, ctx.userId);
    } catch (e: any) {
      return json({ error: e?.message ?? "revoke failed" }, 502);
    }
    return json({ ok: true });
  };
}

// ── PATCH /api/account/accent-color ────────────────────────────────────────
//
// Caches the org accent extracted client-side from its logo (see
// public/scripts/extract-accent.js) onto Clerk org publicMetadata.accent_color.
// resolveOrgContext reads it back on the next render, so the palette is applied
// server-side with no flash of the default brand colour.
//
// Org-only by design: there is no per-user fallback, because the accent themes
// a shared workspace rather than an individual's session.
export function accentColorHandler(_deps: TeamDeps) {
  return async ({ locals, request }: TeamCtx) => {
    const auth = locals.auth?.();
    const userId = auth?.userId ?? null;
    const orgId = auth?.orgId ?? null;
    if (!userId || !orgId) return json({ error: "Org session required" }, 400);

    const body = await request.json().catch(() => ({} as any));
    const value = body?.accent_color;

    // Accept null (reset) or a 6-digit hex.
    if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value ?? "")) {
      return json({ error: "accent_color must be #RRGGBB or null" }, 400);
    }

    const secretKey =
      (import.meta as any).env?.CLERK_SECRET_KEY ?? process.env.CLERK_SECRET_KEY;
    if (!secretKey) return json({ error: "server misconfigured" }, 500);

    try {
      const { createClerkClient } = await import("@clerk/backend");
      const clerk = createClerkClient({ secretKey });
      const org = await clerk.organizations.getOrganization({ organizationId: orgId });
      await clerk.organizations.updateOrganization(orgId, {
        publicMetadata: { ...(org.publicMetadata as object), accent_color: value },
      });
    } catch (e: any) {
      return json({ error: e?.message ?? "update failed" }, 500);
    }

    return json({ ok: true, accent_color: value });
  };
}
