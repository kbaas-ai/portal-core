// core/src/admin/comps-db.ts
// Admin CRUD over the comped_users + comp_domains tables (service role).
// Pure validation/mapping is unit-tested; the Supabase client is behind a DI seam.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const GRANT_TIERS = ['advisor', 'principal', 'team', 'enterprise'] as const;
export type GrantTier = (typeof GRANT_TIERS)[number];
export type GrantType = 'comp' | 'trial';

export interface CompUserRow {
  id: string; email: string; tier: string; type: string;
  expires_at: string | null; notes: string | null; created_at: string;
}
export interface CompDomainRow {
  domain: string; tier: string; type: string;
  note: string | null; expires_at: string | null; created_at: string;
}

export interface GrantInput {
  kind: 'user' | 'domain';
  email?: string;
  domain?: string;
  tier: string;
  type: string;
  expires_at?: string | null;
  notes?: string | null;
}

export interface NormalizedGrant {
  kind: 'user' | 'domain';
  email?: string;
  domain?: string;
  tier: GrantTier;
  type: GrantType;
  expires_at: string | null;
  notes: string | null;
}

export type ValidateResult =
  | { ok: true; value: NormalizedGrant }
  | { ok: false; error: string };

/** Pure validation + normalization of an admin grant request. */
export function validateGrant(input: GrantInput): ValidateResult {
  if (!(GRANT_TIERS as readonly string[]).includes(input.tier)) {
    return { ok: false, error: `tier must be one of ${GRANT_TIERS.join(', ')}` };
  }
  if (input.type !== 'comp' && input.type !== 'trial') {
    return { ok: false, error: "type must be 'comp' or 'trial'" };
  }
  const expires_at = input.expires_at ? new Date(input.expires_at).toISOString() : null;
  if (input.type === 'trial' && !expires_at) {
    return { ok: false, error: 'trial grants require an expiry date' };
  }
  const notes = (input.notes ?? null) || null;

  if (input.kind === 'user') {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) return { ok: false, error: 'a valid email is required' };
    return { ok: true, value: { kind: 'user', email, tier: input.tier as GrantTier, type: input.type, expires_at, notes } };
  }
  if (input.kind === 'domain') {
    const domain = (input.domain ?? '').trim().toLowerCase();
    if (!domain || domain.includes('@') || !domain.includes('.')) return { ok: false, error: 'a valid domain is required' };
    return { ok: true, value: { kind: 'domain', domain, tier: input.tier as GrantTier, type: input.type, expires_at, notes } };
  }
  return { ok: false, error: "kind must be 'user' or 'domain'" };
}

/** Map a validated grant to its target table + row (handles notes vs note). */
export function grantToRow(g: NormalizedGrant): { table: 'comped_users' | 'comp_domains'; row: Record<string, unknown>; conflict: string } {
  if (g.kind === 'user') {
    return {
      table: 'comped_users',
      conflict: 'email',
      row: { email: g.email, tier: g.tier, type: g.type, expires_at: g.expires_at, notes: g.notes },
    };
  }
  return {
    table: 'comp_domains',
    conflict: 'domain',
    row: { domain: g.domain, tier: g.tier, type: g.type, expires_at: g.expires_at, note: g.notes },
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
export function __setCompDepsForTesting(factory: (() => any) | null) { _sbFactory = factory; }
function sb() { return _sbFactory ? _sbFactory() : defaultSb(); }

export async function listGrants(): Promise<{ users: CompUserRow[]; domains: CompDomainRow[] }> {
  const [u, d] = await Promise.all([
    sb().from('comped_users').select('id, email, tier, type, expires_at, notes, created_at').order('created_at', { ascending: false }),
    sb().from('comp_domains').select('domain, tier, type, note, expires_at, created_at').order('created_at', { ascending: false }),
  ]);
  if (u.error) throw u.error;
  if (d.error) throw d.error;
  return { users: (u.data ?? []) as CompUserRow[], domains: (d.data ?? []) as CompDomainRow[] };
}

export async function upsertGrant(g: NormalizedGrant): Promise<void> {
  const { table, row, conflict } = grantToRow(g);
  const { error } = await sb().from(table).upsert(row, { onConflict: conflict });
  if (error) throw error;
}

export async function deleteGrant(kind: string, id: string): Promise<boolean> {
  if (kind === 'user') {
    const { data, error } = await sb().from('comped_users').delete().eq('id', id).select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
  if (kind === 'domain') {
    const { data, error } = await sb().from('comp_domains').delete().eq('domain', id).select('domain');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
  return false;
}
