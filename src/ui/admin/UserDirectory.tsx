// src/components/admin/UserDirectory.tsx
import { useEffect, useState } from 'react';

const CELL: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderBottom: '1px solid var(--lp-border)',
  fontSize: '0.83rem',
  color: 'var(--lp-text)',
  verticalAlign: 'middle',
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
const BTN_GHOST: React.CSSProperties = {
  padding: '0.3rem 0.65rem', borderRadius: 6,
  border: '1px solid var(--lp-border)',
  background: 'transparent', color: 'var(--lp-steel)',
  fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
  textDecoration: 'none', display: 'inline-block',
};

interface UserRow { id: string; name: string; email: string | null; ownTier: string | null; createdAt: string | null; }

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function UserDirectory() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load(q: string) {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?limit=50${q ? `&query=${encodeURIComponent(q)}` : ''}`);
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Failed to load users.'); return; }
      setUsers(d.users ?? []);
      setTotal(d.totalCount ?? (d.users?.length ?? 0));
    } catch { setErr('Failed to load users.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(''); }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(query); }}
          placeholder="Search by name or email…"
          style={{ ...INPUT, flex: 1 }}
        />
        <button onClick={() => load(query)} disabled={loading} style={{ ...BTN_GHOST, padding: '0.5rem 1rem' }}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {err && <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>}

      {!loading && (
        <p style={{ fontSize: '0.78rem', color: 'var(--lp-steel)', margin: '0 0 0.5rem' }}>
          {users.length} shown{total > users.length ? ` of ${total} matching` : ''}. Tier shown is the user's own
          metadata — click <strong>Inspect</strong> for the authoritative effective tier.
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={TH}>Name</th><th style={TH}>Email</th><th style={TH}>Own tier</th><th style={TH}>Joined</th>
            <th style={{ ...TH, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={CELL}>{u.name}</td>
              <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{u.email ?? '—'}</td>
              <td style={CELL}>{u.ownTier ?? '—'}</td>
              <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{fmt(u.createdAt)}</td>
              <td style={{ ...CELL, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {u.email && (
                  <>
                    <a href={`/admin?tab=inspector&email=${encodeURIComponent(u.email)}`} style={{ ...BTN_GHOST, marginRight: '0.4rem' }}>Inspect</a>
                    <a href={`/admin?tab=comps&email=${encodeURIComponent(u.email)}`} style={BTN_GHOST}>Comp</a>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!loading && users.length === 0 && <tr><td style={{ ...CELL, color: 'var(--lp-steel)' }} colSpan={5}>No users found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
