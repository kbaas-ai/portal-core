// core/src/admin/handlers.ts
//
// API route handlers for the admin console, as factories bound to a portal's
// AdminConfig. Each portal still needs the route FILES (Astro routes must live
// under src/pages), but they become four-line bindings — so the admin gate,
// the validation and the audit writes cannot drift between portals.
//
// Every handler answers 404 (never 401/403) when the caller is not an admin:
// the console should be indistinguishable from a route that does not exist.

import { type AdminConfig } from "./config.ts";
import { getAdminEmail } from "./gate.ts";
import { listGrants, upsertGrant, deleteGrant, validateGrant, type GrantInput } from "./comps-db.ts";
import { listTenants, createTenant, updateTenant, validateTenant, type TenantInput } from "./tenants-db.ts";
import { listAudit, recordAudit } from "./audit-db.ts";
import { listClerkComps, clearClerkComp, CompGuardError } from "./clerk-comps.ts";
import { listUsers } from "./users.ts";
import { inspectEmail } from "./inspect.ts";
import { summarizeGrants } from "./analytics.ts";
import { summarizeQuestions, summarizeToolUsage, type DemandSummary } from "./usage-analytics.ts";

/** Minimal shape of the Astro context the handlers use. */
export interface AdminCtx {
  locals: any;
  url: URL;
  request: Request;
  params?: Record<string, string | undefined>;
}

export interface AdminDeps {
  cfg: AdminConfig;
  /**
   * Service-role Supabase client, for the analytics tab's demand/tool
   * sections. Omit on portals that do not collect that telemetry — those
   * sections degrade to null rather than failing the whole response.
   */
  getSb?: () => any;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NOT_FOUND = () => json({ error: "not_found" }, 404);

function clampLimit(raw: unknown, dflt: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : dflt;
}

// ── GET /api/admin/users ───────────────────────────────────────────────────
export function usersHandler({ cfg }: AdminDeps) {
  return async ({ locals, url }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    const query = url.searchParams.get("query") ?? "";
    const limit = clampLimit(url.searchParams.get("limit"), 50, 100);
    try {
      return json(await listUsers(query, limit, cfg));
    } catch (e: any) {
      return json({ error: e?.message ?? "failed to list users" }, 502);
    }
  };
}

// ── GET /api/admin/inspect?email= ──────────────────────────────────────────
export function inspectHandler({ cfg }: AdminDeps) {
  return async ({ locals, url }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    const email = (url.searchParams.get("email") ?? "").trim();
    if (!email || !email.includes("@")) {
      return json({ error: "a valid email query param is required" }, 400);
    }
    return json(await inspectEmail(email, cfg));
  };
}

// ── GET /api/admin/audit?limit= ────────────────────────────────────────────
export function auditHandler(_deps: AdminDeps) {
  return async ({ locals, url }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    const limit = clampLimit(url.searchParams.get("limit"), 100, 500);
    return json({ entries: await listAudit(limit) });
  };
}

// ── GET/POST /api/admin/comps ──────────────────────────────────────────────
export function compsListHandler(_deps: AdminDeps) {
  return async ({ locals }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    return json(await listGrants());
  };
}

export function compsCreateHandler(_deps: AdminDeps) {
  return async ({ locals, request }: AdminCtx) => {
    const adminEmail = await getAdminEmail(locals);
    if (!adminEmail) return NOT_FOUND();
    let body: GrantInput;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const result = validateGrant(body);
    if (!result.ok) return json({ error: result.error }, 400);
    const g = result.value;
    await upsertGrant(g);
    await recordAudit({
      actorEmail: adminEmail,
      action: "grant.create",
      targetKind: g.kind,
      targetId: g.kind === "user" ? g.email : g.domain,
      details: { tier: g.tier, type: g.type, expires_at: g.expires_at },
    });
    return json({ ok: true }, 201);
  };
}

// ── DELETE /api/admin/comps/[kind]/[id] ────────────────────────────────────
export function compsDeleteHandler(_deps: AdminDeps) {
  return async ({ locals, params }: AdminCtx) => {
    const adminEmail = await getAdminEmail(locals);
    if (!adminEmail) return NOT_FOUND();
    const kind = params?.kind ?? "";
    const id = decodeURIComponent(params?.id ?? "");
    if ((kind !== "user" && kind !== "domain") || !id) return json({ error: "bad request" }, 400);
    const ok = await deleteGrant(kind, id);
    if (!ok) return json({ error: "not_found" }, 404);
    await recordAudit({
      actorEmail: adminEmail,
      action: "grant.revoke",
      targetKind: kind,
      targetId: id,
    });
    return json({ ok: true });
  };
}

// ── GET/POST /api/admin/tenants ────────────────────────────────────────────
export function tenantsListHandler(_deps: AdminDeps) {
  return async ({ locals }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    return json({ tenants: await listTenants() });
  };
}

export function tenantsCreateHandler(_deps: AdminDeps) {
  return async ({ locals, request }: AdminCtx) => {
    const adminEmail = await getAdminEmail(locals);
    if (!adminEmail) return NOT_FOUND();
    let body: TenantInput;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const result = validateTenant(body);
    if (!result.ok) return json({ error: result.error }, 400);
    let tenant;
    try {
      tenant = await createTenant(result.value);
    } catch (e: any) {
      // unique_violation on slug or clerk_org_id
      if (e?.code === "23505") return json({ error: "a tenant with that slug or Clerk org already exists" }, 409);
      throw e;
    }
    await recordAudit({
      actorEmail: adminEmail,
      action: "tenant.create",
      targetKind: "tenant",
      targetId: tenant.slug,
      details: { company_name: tenant.company_name, status: tenant.status },
    });
    return json({ tenant }, 201);
  };
}

// ── PATCH /api/admin/tenants/[id] ──────────────────────────────────────────
export function tenantsUpdateHandler(_deps: AdminDeps) {
  return async ({ locals, request, params }: AdminCtx) => {
    const adminEmail = await getAdminEmail(locals);
    if (!adminEmail) return NOT_FOUND();
    const id = decodeURIComponent(params?.id ?? "");
    if (!id) return json({ error: "bad request" }, 400);
    let body: TenantInput;
    try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const result = validateTenant(body);
    if (!result.ok) return json({ error: result.error }, 400);
    let tenant;
    try {
      tenant = await updateTenant(id, result.value);
    } catch (e: any) {
      if (e?.code === "23505") return json({ error: "a tenant with that slug or Clerk org already exists" }, 409);
      throw e;
    }
    if (!tenant) return json({ error: "not_found" }, 404);
    await recordAudit({
      actorEmail: adminEmail,
      action: "tenant.update",
      targetKind: "tenant",
      targetId: tenant.slug,
      details: { status: tenant.status },
    });
    return json({ tenant });
  };
}

// ── GET /api/admin/clerk-comps ─────────────────────────────────────────────
export function clerkCompsListHandler({ cfg }: AdminDeps) {
  return async ({ locals }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    try {
      const { comps, capped, totalUsers } = await listClerkComps(cfg);
      return json({ comps, capped, totalUsers });
    } catch (e: any) {
      return json({ error: e?.message ?? "failed to scan users" }, 502);
    }
  };
}

// ── DELETE /api/admin/clerk-comps/[userId] ─────────────────────────────────
export function clerkCompsClearHandler({ cfg }: AdminDeps) {
  return async ({ locals, params }: AdminCtx) => {
    const adminEmail = await getAdminEmail(locals);
    if (!adminEmail) return NOT_FOUND();
    const userId = decodeURIComponent(params?.userId ?? "");
    if (!userId) return json({ error: "bad request" }, 400);
    try {
      await clearClerkComp(userId, cfg);
    } catch (e: any) {
      if (e instanceof CompGuardError) return json({ error: e.message }, 409);
      return json({ error: e?.message ?? "clear failed" }, 502);
    }
    await recordAudit({
      actorEmail: adminEmail,
      action: "clerk_comp.clear",
      targetKind: "user",
      targetId: userId,
    });
    return json({ ok: true });
  };
}

// ── GET /api/admin/analytics ───────────────────────────────────────────────
const THIRTY_DAYS_MS = 30 * 86400000;

/**
 * Demand + tool-usage sections. Best effort by design: a portal that lacks the
 * `questions` or `tool_usage` tables, or has no telemetry at all, gets nulls
 * for those cards rather than a 502 that would also hide the entitlement stats
 * that did resolve.
 */
async function buildDemand(
  getSb?: () => any,
): Promise<{ demand: DemandSummary | null; toolUsage: Record<string, number> | null }> {
  if (!getSb) return { demand: null, toolUsage: null };
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  let sb: any;
  try { sb = getSb(); } catch { return { demand: null, toolUsage: null }; }

  let demand: DemandSummary | null = null;
  let toolUsage: Record<string, number> | null = null;

  try {
    const { data, error } = await sb
      .from("questions")
      .select("question_text, user_tier, matched_slugs, answered, was_locked, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (!error && data) demand = summarizeQuestions(data);
  } catch { /* section degrades to null */ }

  try {
    const { data, error } = await sb
      .from("tool_usage")
      .select("tool")
      .gte("created_at", since)
      .limit(10000);
    if (!error && data) toolUsage = summarizeToolUsage(data);
  } catch { /* section degrades to null */ }

  return { demand, toolUsage };
}

export function analyticsHandler({ cfg, getSb }: AdminDeps) {
  return async ({ locals }: AdminCtx) => {
    if (!(await getAdminEmail(locals))) return NOT_FOUND();
    try {
      const [{ users, domains }, tenants, clerk, { demand, toolUsage }] = await Promise.all([
        listGrants(),
        listTenants(),
        listClerkComps(cfg),
        buildDemand(getSb),
      ]);
      const grants = summarizeGrants(users, domains, Date.now());
      const tenantsByStatus: Record<string, number> = {};
      for (const t of tenants) tenantsByStatus[t.status] = (tenantsByStatus[t.status] ?? 0) + 1;

      return json({
        totalUsers: clerk.totalUsers,
        clerkComps: clerk.comps.length,
        clerkCompsCapped: clerk.capped,
        grants,
        tenants: { total: tenants.length, byStatus: tenantsByStatus },
        demand,
        toolUsage,
      });
    } catch (e: any) {
      return json({ error: e?.message ?? "failed to build analytics" }, 502);
    }
  };
}
