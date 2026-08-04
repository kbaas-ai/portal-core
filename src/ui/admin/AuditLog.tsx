// src/components/admin/AuditLog.tsx
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
const MONO: React.CSSProperties = {
  fontFamily: 'var(--lp-font-mono)',
  fontSize: '0.78rem',
};

interface Entry {
  id: string;
  actor_email: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

function summarizeDetails(d: Record<string, unknown> | null): string {
  if (!d || Object.keys(d).length === 0) return '—';
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${v === null || v === undefined ? '—' : String(v)}`)
    .join(', ');
}

export default function AuditLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/audit?limit=200');
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? 'Failed to load audit log.');
        return;
      }
      setEntries(d.entries ?? []);
    } catch {
      setErr('Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--lp-steel)', margin: 0 }}>
          {loading ? 'Loading…' : `${entries.length} most recent admin action${entries.length === 1 ? '' : 's'}`}
        </p>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '0.4rem 0.85rem', borderRadius: 7,
            border: '1px solid var(--lp-border)', background: 'var(--lp-white)',
            color: 'var(--lp-text)', cursor: 'pointer', fontSize: '0.8rem',
            fontFamily: 'inherit', opacity: loading ? 0.5 : 1,
          }}
        >
          Refresh
        </button>
      </div>

      {err && <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>}

      {!err && !loading && entries.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--lp-steel)' }}>No admin actions recorded yet.</p>
      )}

      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>When</th>
              <th style={TH}>Admin</th>
              <th style={TH}>Action</th>
              <th style={TH}>Target</th>
              <th style={TH}>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ ...CELL, whiteSpace: 'nowrap', color: 'var(--lp-steel)' }}>
                  {new Date(e.created_at).toLocaleString()}
                </td>
                <td style={CELL}>{e.actor_email}</td>
                <td style={{ ...CELL, ...MONO }}>{e.action}</td>
                <td style={CELL}>
                  {e.target_kind || e.target_id
                    ? `${e.target_kind ?? '—'}${e.target_id ? `: ${e.target_id}` : ''}`
                    : '—'}
                </td>
                <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{summarizeDetails(e.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
