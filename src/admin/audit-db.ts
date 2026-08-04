// core/src/admin/audit-db.ts
// Append-only log of admin write actions (grants, revocations, future tenant
// edits). Pure entry construction is unit-tested; the Supabase client is behind
// the same DI seam pattern as comps-db.ts. Writes are best-effort: a failed
// audit insert must never block the action it records (see recordAudit).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuditRow {
  id: string;
  actor_email: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditInput {
  actorEmail: string;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface AuditEntry {
  actor_email: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
}

export type BuildResult =
  | { ok: true; value: AuditEntry }
  | { ok: false; error: string };

/** Pure validation + normalization of an audit entry before insert. */
export function buildAuditEntry(input: AuditInput): BuildResult {
  const actor_email = (input.actorEmail ?? '').trim().toLowerCase();
  if (!actor_email) return { ok: false, error: 'actor email is required' };
  const action = (input.action ?? '').trim();
  if (!action) return { ok: false, error: 'action is required' };
  return {
    ok: true,
    value: {
      actor_email,
      action,
      target_kind: (input.targetKind ?? '').toString().trim() || null,
      target_id: (input.targetId ?? '').toString().trim() || null,
      details: input.details ?? null,
    },
  };
}

// ── Supabase client (DI seam for tests) ───────────────────────────────────
let _sb: SupabaseClient | null = null;
function defaultSb() {
  if (_sb) return _sb;
  const url = (import.meta as any).env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}
let _sbFactory: (() => any) | null = null;
export function __setAuditDepsForTesting(factory: (() => any) | null) { _sbFactory = factory; }
function sb() { return _sbFactory ? _sbFactory() : defaultSb(); }

/**
 * Best-effort audit write. Never throws: an audit failure must not roll back or
 * 500 the action being logged. Returns true on success, false (logged) on error.
 */
export async function recordAudit(input: AuditInput): Promise<boolean> {
  const built = buildAuditEntry(input);
  if (!built.ok) {
    console.error('[audit] skipped malformed entry:', built.error);
    return false;
  }
  try {
    const { error } = await sb().from('admin_audit_log').insert(built.value);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[audit] failed to record entry:', e);
    return false;
  }
}

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const { data, error } = await sb()
    .from('admin_audit_log')
    .select('id, actor_email, action, target_kind, target_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}
