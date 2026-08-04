// src/components/admin/TierInspector.tsx
import { useState, useEffect } from 'react';

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

interface Result {
  email: string; found: boolean; effectiveTier: string; winningSource: string;
  breakdown: {
    clerkUser: { tier: string | null; status: string | null } | null;
    org: { tier: string | null } | null;
    compUser: { tier: string; type: string; expires_at: string | null } | null;
    compDomain: { tier: string; type: string; expires_at: string | null } | null;
    trial: { until: number | null; active: boolean } | null;
  };
}

export default function TierInspector() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function inspectFor(value: string) {
    const target = value.trim();
    if (!target) return;
    setErr(null); setResult(null); setLoading(true);
    try {
      const res = await fetch(`/api/admin/inspect?email=${encodeURIComponent(target)}`);
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Lookup failed.'); return; }
      setResult(d);
    } finally { setLoading(false); }
  }
  function inspect() { inspectFor(email); }

  // Deep-link support: /admin?tab=inspector&email=… prefills and auto-runs.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email');
    if (e) { setEmail(e); inspectFor(e); }
  }, []);

  function row(label: string, value: string, isWinner: boolean) {
    return (
      <tr>
        <td style={{ ...CELL, fontWeight: isWinner ? 700 : 400 }}>{label}{isWinner ? ' ◀ winning' : ''}</td>
        <td style={CELL}>{value}</td>
      </tr>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem' }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="person@company.com"
          onKeyDown={e => { if (e.key === 'Enter' && email) inspect(); }} style={{ ...INPUT, flex: 1 }} />
        <button onClick={inspect} disabled={loading || !email} style={{ ...BTN_PRIMARY, opacity: (loading || !email) ? 0.5 : 1 }}>
          {loading ? 'Looking up…' : 'Inspect'}
        </button>
      </div>
      {err && <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>}
      {result && (
        <div>
          <p style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
            <strong>{result.email}</strong>{!result.found && ' (no Clerk account)'} — effective tier:{' '}
            <strong style={{ color: 'var(--lp-indigo)' }}>{result.effectiveTier}</strong>
            {' '}(source: {result.winningSource})
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Source</th><th style={TH}>Value</th></tr></thead>
            <tbody>
              {row('Clerk user metadata', result.breakdown.clerkUser ? `${result.breakdown.clerkUser.tier ?? '—'} (status: ${result.breakdown.clerkUser.status ?? '—'})` : '—', result.winningSource === 'clerkUser')}
              {row('Org metadata', result.breakdown.org ? (result.breakdown.org.tier ?? '—') : '—', result.winningSource === 'org')}
              {row('Comped user', result.breakdown.compUser ? `${result.breakdown.compUser.tier} (${result.breakdown.compUser.type}${result.breakdown.compUser.expires_at ? `, expires ${result.breakdown.compUser.expires_at.slice(0, 10)}` : ''})` : '—', result.winningSource === 'compUser')}
              {row('Comped domain', result.breakdown.compDomain ? `${result.breakdown.compDomain.tier} (${result.breakdown.compDomain.type}${result.breakdown.compDomain.expires_at ? `, expires ${result.breakdown.compDomain.expires_at.slice(0, 10)}` : ''})` : '—', result.winningSource === 'compDomain')}
              {row('Campaign trial', result.breakdown.trial?.until ? `${result.breakdown.trial.active ? 'active' : 'expired'} (until ${new Date(result.breakdown.trial.until).toLocaleDateString()})` : '—', result.winningSource === 'trial')}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
