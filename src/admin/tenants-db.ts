// core/src/admin/tenants-db.ts
// Admin CRUD over the tenants table (service role). One row per enterprise/teams
// client with a private vault deployment. Pure validation/normalization is
// unit-tested; the Supabase client is behind the same DI seam as comps-db.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TENANT_STATUSES = ['active', 'paused', 'offboarded'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface TenantRow {
  id: string;
  slug: string;
  company_name: string;
  clerk_org_id: string | null;
  vault_repo: string | null;
  vercel_project_id: string | null;
  vercel_deploy_hook_url: string | null;
  domain: string | null;
  stripe_customer_id: string | null;
  status: string;
  vault_last_ingested_at: string | null;
  onboarded_at: string;
  offboarded_at: string | null;
}

export interface TenantInput {
  slug?: string;
  company_name?: string;
  clerk_org_id?: string | null;
  vault_repo?: string | null;
  vercel_project_id?: string | null;
  vercel_deploy_hook_url?: string | null;
  domain?: string | null;
  stripe_customer_id?: string | null;
  status?: string;
}

export interface NormalizedTenant {
  slug: string;
  company_name: string;
  clerk_org_id: string | null;
  vault_repo: string | null;
  vercel_project_id: string | null;
  vercel_deploy_hook_url: string | null;
  domain: string | null;
  stripe_customer_id: string | null;
  status: TenantStatus;
}

export type ValidateResult =
  | { ok: true; value: NormalizedTenant }
  | { ok: false; error: string };

const SLUG_RE = /^[a-z0-9-]+$/;

/** Trim a string; map empty (or null/undefined) to null. */
function nullable(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s || null;
}

/** Pure validation + normalization of an admin tenant create/update request. */
export function validateTenant(input: TenantInput): ValidateResult {
  const slug = (input.slug ?? '').trim().toLowerCase();
  if (!slug) return { ok: false, error: 'a slug is required' };
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug may only contain lowercase letters, numbers and hyphens' };

  const company_name = (input.company_name ?? '').trim();
  if (!company_name) return { ok: false, error: 'a company name is required' };

  const status = (input.status ?? 'active') as TenantStatus;
  if (!(TENANT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `status must be one of ${TENANT_STATUSES.join(', ')}` };
  }

  const vercel_deploy_hook_url = nullable(input.vercel_deploy_hook_url);
  if (vercel_deploy_hook_url && !/^https?:\/\//i.test(vercel_deploy_hook_url)) {
    return { ok: false, error: 'deploy hook URL must start with http:// or https://' };
  }

  return {
    ok: true,
    value: {
      slug,
      company_name,
      clerk_org_id: nullable(input.clerk_org_id),
      vault_repo: nullable(input.vault_repo),
      vercel_project_id: nullable(input.vercel_project_id),
      vercel_deploy_hook_url,
      domain: nullable(input.domain),
      stripe_customer_id: nullable(input.stripe_customer_id),
      status,
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
export function __setTenantDepsForTesting(factory: (() => any) | null) { _sbFactory = factory; }
function sb() { return _sbFactory ? _sbFactory() : defaultSb(); }

const COLS =
  'id, slug, company_name, clerk_org_id, vault_repo, vercel_project_id, vercel_deploy_hook_url, domain, stripe_customer_id, status, vault_last_ingested_at, onboarded_at, offboarded_at';

export async function listTenants(): Promise<TenantRow[]> {
  const { data, error } = await sb().from('tenants').select(COLS).order('onboarded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TenantRow[];
}

export async function createTenant(t: NormalizedTenant): Promise<TenantRow> {
  const row = { ...t, offboarded_at: t.status === 'offboarded' ? new Date().toISOString() : null };
  const { data, error } = await sb().from('tenants').insert(row).select(COLS).single();
  if (error) throw error;
  return data as TenantRow;
}

/**
 * Update a tenant by id. Keeps offboarded_at in sync with status: stamps it when
 * a tenant moves to 'offboarded', clears it when it moves back to active/paused.
 */
export async function updateTenant(id: string, t: NormalizedTenant): Promise<TenantRow | null> {
  const row = { ...t, offboarded_at: t.status === 'offboarded' ? new Date().toISOString() : null };
  const { data, error } = await sb().from('tenants').update(row).eq('id', id).select(COLS).maybeSingle();
  if (error) throw error;
  return (data as TenantRow) ?? null;
}
