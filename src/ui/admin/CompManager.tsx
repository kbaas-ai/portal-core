// src/components/admin/CompManager.tsx
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
  fontFamily: 'inherit', fontSize: '0.875rem',
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

interface CompUser { id: string; email: string; tier: string; type: string; expires_at: string | null; notes: string | null; created_at: string; }
interface CompDomain { domain: string; tier: string; type: string; note: string | null; expires_at: string | null; created_at: string; }
interface ClerkComp { userId: string; email: string | null; tier: string; status: string | null; }

const TIERS = ['advisor', 'principal', 'team', 'enterprise'];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function expired(iso: string | null): boolean { return !!iso && new Date(iso) < new Date(); }

export default function CompManager() {
  const [users, setUsers] = useState<CompUser[]>([]);
  const [domains, setDomains] = useState<CompDomain[]>([]);
  const [clerkComps, setClerkComps] = useState<ClerkComp[]>([]);
  const [clerkCapped, setClerkCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'user' | 'domain'>('user');
  const [target, setTarget] = useState('');
  const [tier, setTier] = useState('principal');
  const [type, setType] = useState<'comp' | 'trial'>('comp');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/comps');
    if (res.ok) { const d = await res.json(); setUsers(d.users ?? []); setDomains(d.domains ?? []); }
    // Manual Clerk-metadata comps (best-effort — scan may be slow/unavailable).
    try {
      const cr = await fetch('/api/admin/clerk-comps');
      if (cr.ok) { const cd = await cr.json(); setClerkComps(cd.comps ?? []); setClerkCapped(!!cd.capped); }
    } catch { /* non-fatal */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Deep-link support: /admin?tab=comps&email=… prefills the grant target.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email');
    if (e) { setKind('user'); setTarget(e); }
  }, []);

  async function save() {
    setErr(null);
    if (type === 'trial' && !expiresAt) { setErr('Trials need an expiry date.'); return; }
    setSaving(true);
    try {
      const body: any = { kind, tier, type, expires_at: expiresAt || null, notes: notes || null };
      if (kind === 'user') body.email = target.trim(); else body.domain = target.trim();
      const res = await fetch('/api/admin/comps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Failed to save grant.'); return; }
      setTarget(''); setNotes(''); setExpiresAt('');
      await load();
    } finally { setSaving(false); }
  }

  async function revoke(k: 'user' | 'domain', id: string) {
    if (!confirm(`Revoke this ${k} grant?`)) return;
    const res = await fetch(`/api/admin/comps/${k}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); alert(e.error ?? 'Failed to revoke.'); }
  }

  async function clearClerk(userId: string, email: string | null) {
    if (!confirm(`Clear the manual Clerk comp for ${email ?? userId}?`)) return;
    const res = await fetch(`/api/admin/clerk-comps/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); alert(e.error ?? 'Failed to clear.'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--lp-text)', margin: 0 }}>Grant a comp or trial</h2>
      </div>
      <div style={{ padding: '1rem', background: 'var(--lp-white)', border: '1px solid var(--lp-border)', borderRadius: 8, marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem' }}>
          <select value={kind} onChange={e => setKind(e.target.value as any)} style={INPUT}>
            <option value="user">By email</option>
            <option value="domain">By domain</option>
          </select>
          <input value={target} onChange={e => setTarget(e.target.value)}
            placeholder={kind === 'user' ? 'person@company.com' : 'company.com'} style={INPUT} />
          <select value={tier} onChange={e => setTier(e.target.value)} style={INPUT}>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value as any)} style={INPUT}>
            <option value="comp">comp</option>
            <option value="trial">trial</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.6rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--lp-steel)' }}>Expires{type === 'trial' ? ' *' : ''}</label>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={INPUT} />
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="notes (who/why)" style={INPUT} />
        </div>
        {err && <p style={{ color: '#C0392B', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
          <button onClick={save} disabled={saving || !target} style={{ ...BTN_PRIMARY, opacity: (saving || !target) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Grant'}
          </button>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--lp-steel)', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && (
        <>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Comped users ({users.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
            <thead><tr><th style={TH}>Email</th><th style={TH}>Tier</th><th style={TH}>Type</th><th style={TH}>Expires</th><th style={TH}>Notes</th><th style={{ ...TH, textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={CELL}>{u.email}</td>
                  <td style={CELL}>{u.tier}</td>
                  <td style={CELL}>{u.type}</td>
                  <td style={{ ...CELL, color: expired(u.expires_at) ? '#C0392B' : 'var(--lp-steel)' }}>{fmt(u.expires_at)}{expired(u.expires_at) ? ' (expired)' : ''}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{u.notes ?? '—'}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}><button onClick={() => revoke('user', u.id)} style={{ ...BTN_GHOST, color: '#C0392B' }}>Revoke</button></td>
                </tr>
              ))}
              {users.length === 0 && <tr><td style={{ ...CELL, color: 'var(--lp-steel)' }} colSpan={6}>None.</td></tr>}
            </tbody>
          </table>

          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Comped domains ({domains.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Domain</th><th style={TH}>Tier</th><th style={TH}>Type</th><th style={TH}>Expires</th><th style={TH}>Notes</th><th style={{ ...TH, textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {domains.map(d => (
                <tr key={d.domain}>
                  <td style={CELL}>{d.domain}</td>
                  <td style={CELL}>{d.tier}</td>
                  <td style={CELL}>{d.type}</td>
                  <td style={{ ...CELL, color: expired(d.expires_at) ? '#C0392B' : 'var(--lp-steel)' }}>{fmt(d.expires_at)}{expired(d.expires_at) ? ' (expired)' : ''}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{d.note ?? '—'}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}><button onClick={() => revoke('domain', d.domain)} style={{ ...BTN_GHOST, color: '#C0392B' }}>Revoke</button></td>
                </tr>
              ))}
              {domains.length === 0 && <tr><td style={{ ...CELL, color: 'var(--lp-steel)' }} colSpan={6}>None.</td></tr>}
            </tbody>
          </table>

          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '2rem 0 0.25rem' }}>Clerk metadata comps ({clerkComps.length})</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--lp-steel)', margin: '0 0 0.5rem' }}>
            Manual tiers set directly on a Clerk user (not backed by a Stripe subscription). Paid subscriptions are
            excluded and can't be cleared here. New comps should go through the grant form above.
            {clerkCapped && ' (Showing the first 500 users.)'}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Email</th><th style={TH}>Tier</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {clerkComps.map(c => (
                <tr key={c.userId}>
                  <td style={CELL}>{c.email ?? c.userId}</td>
                  <td style={CELL}>{c.tier}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{c.status ?? '—'}</td>
                  <td style={{ ...CELL, textAlign: 'right' }}><button onClick={() => clearClerk(c.userId, c.email)} style={{ ...BTN_GHOST, color: '#C0392B' }}>Clear</button></td>
                </tr>
              ))}
              {clerkComps.length === 0 && <tr><td style={{ ...CELL, color: 'var(--lp-steel)' }} colSpan={4}>None.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
