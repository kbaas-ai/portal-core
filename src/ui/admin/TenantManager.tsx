// src/components/admin/TenantManager.tsx
import { useEffect, useState } from 'react';

const CELL: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderBottom: '1px solid var(--lp-border)',
  fontSize: '0.83rem',
  color: 'var(--lp-text)',
  verticalAlign: 'top',
};
const TH: React.CSSProperties = {
  ...CELL,
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--lp-steel)',
  fontFamily: 'var(--lp-font-mono)',
  background: 'transparent',
};
const INPUT: React.CSSProperties = {
  padding: '0.5rem 0.7rem', borderRadius: 7,
  border: '1px solid var(--lp-border)',
  background: 'var(--lp-white)', color: 'var(--lp-text)',
  fontFamily: 'inherit', fontSize: '0.875rem', width: '100%', boxSizing: 'border-box',
};
const BTN_PRIMARY: React.CSSProperties = {
  padding: '0.5rem 1rem', borderRadius: 7, border: 'none',
  background: 'var(--lp-indigo)', color: '#fff',
  fontWeight: 600, cursor: 'pointer',
  fontSize: '0.875rem', fontFamily: 'inherit',
};
const BTN_GHOST: React.CSSProperties = {
  padding: '0.3rem 0.65rem', borderRadius: 6,
  border: '1px solid var(--lp-border)',
  background: 'transparent', color: 'var(--lp-steel)',
  fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
};
const LABEL: React.CSSProperties = {
  fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--lp-steel)', fontFamily: 'var(--lp-font-mono)', marginBottom: '0.25rem', display: 'block',
};

const STATUSES = ['active', 'paused', 'offboarded'];
const STATUS_COLOR: Record<string, string> = { active: '#1E8E4E', paused: '#B8860B', offboarded: '#C0392B' };

interface Tenant {
  id: string; slug: string; company_name: string;
  clerk_org_id: string | null; vault_repo: string | null;
  vercel_project_id: string | null; vercel_deploy_hook_url: string | null;
  domain: string | null; stripe_customer_id: string | null;
  status: string; vault_last_ingested_at: string | null;
  onboarded_at: string; offboarded_at: string | null;
}

type Form = {
  slug: string; company_name: string; clerk_org_id: string; vault_repo: string;
  vercel_project_id: string; vercel_deploy_hook_url: string; domain: string;
  stripe_customer_id: string; status: string;
};

const EMPTY_FORM: Form = {
  slug: '', company_name: '', clerk_org_id: '', vault_repo: '',
  vercel_project_id: '', vercel_deploy_hook_url: '', domain: '',
  stripe_customer_id: '', status: 'active',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function TenantManager() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/tenants');
    if (res.ok) { const d = await res.json(); setTenants(d.tenants ?? []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function startEdit(t: Tenant) {
    setEditingId(t.id);
    setErr(null);
    setForm({
      slug: t.slug, company_name: t.company_name,
      clerk_org_id: t.clerk_org_id ?? '', vault_repo: t.vault_repo ?? '',
      vercel_project_id: t.vercel_project_id ?? '', vercel_deploy_hook_url: t.vercel_deploy_hook_url ?? '',
      domain: t.domain ?? '', stripe_customer_id: t.stripe_customer_id ?? '', status: t.status,
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() { setEditingId(null); setForm(EMPTY_FORM); setErr(null); }

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const url = editingId ? `/api/admin/tenants/${editingId}` : '/api/admin/tenants';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Failed to save tenant.'); return; }
      cancelEdit();
      await load();
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--lp-text)', margin: 0 }}>
          {editingId ? `Edit tenant: ${form.slug}` : 'Add a tenant'}
        </h2>
        {editingId && <button onClick={cancelEdit} style={BTN_GHOST}>+ New tenant</button>}
      </div>

      <div style={{ padding: '1rem', background: 'var(--lp-white)', border: '1px solid var(--lp-border)', borderRadius: 8, marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Slug *</label>
            <input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="foth" style={INPUT} disabled={!!editingId} />
          </div>
          <div>
            <label style={LABEL}>Company name *</label>
            <input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Foth Companies" style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={INPUT}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL}>Clerk org id</label>
            <input value={form.clerk_org_id} onChange={(e) => set('clerk_org_id', e.target.value)} placeholder="org_…" style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>Custom domain</label>
            <input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="logistics.foth.com" style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>Vault repo</label>
            <input value={form.vault_repo} onChange={(e) => set('vault_repo', e.target.value)} placeholder="kbaas-ai/foth-vault" style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>Vercel project id</label>
            <input value={form.vercel_project_id} onChange={(e) => set('vercel_project_id', e.target.value)} placeholder="prj_…" style={INPUT} />
          </div>
          <div>
            <label style={LABEL}>Stripe customer id</label>
            <input value={form.stripe_customer_id} onChange={(e) => set('stripe_customer_id', e.target.value)} placeholder="cus_…" style={INPUT} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LABEL}>Vercel deploy hook URL</label>
            <input value={form.vercel_deploy_hook_url} onChange={(e) => set('vercel_deploy_hook_url', e.target.value)} placeholder="https://api.vercel.com/v1/integrations/deploy/…" style={INPUT} />
          </div>
        </div>
        {err && <p style={{ color: '#C0392B', fontSize: '0.8rem', margin: '0.6rem 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
          <button onClick={save} disabled={saving || !form.slug || !form.company_name}
            style={{ ...BTN_PRIMARY, opacity: (saving || !form.slug || !form.company_name) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create tenant'}
          </button>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--lp-steel)', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && (
        <>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Tenants ({tenants.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Slug</th><th style={TH}>Company</th><th style={TH}>Status</th>
                <th style={TH}>Clerk org</th><th style={TH}>Vault repo</th><th style={TH}>Onboarded</th>
                <th style={{ ...TH, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...CELL, fontFamily: 'var(--lp-font-mono)', fontSize: '0.78rem' }}>{t.slug}</td>
                  <td style={CELL}>{t.company_name}</td>
                  <td style={{ ...CELL, color: STATUS_COLOR[t.status] ?? 'var(--lp-steel)', fontWeight: 600 }}>{t.status}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{t.clerk_org_id ?? '—'}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{t.vault_repo ?? '—'}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{fmt(t.onboarded_at)}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    <button onClick={() => startEdit(t)} style={BTN_GHOST}>Edit</button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && <tr><td style={{ ...CELL, color: 'var(--lp-steel)' }} colSpan={7}>No tenants yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
