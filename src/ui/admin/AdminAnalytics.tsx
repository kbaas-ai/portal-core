// src/components/admin/AdminAnalytics.tsx
import { useEffect, useState } from 'react';

interface RecentQuestion { text: string; tier: string; at: string }

interface Analytics {
  totalUsers: number;
  clerkComps: number;
  clerkCompsCapped: boolean;
  grants: { compUsers: number; compDomains: number; trials: number; expiringSoon: number; byTier: Record<string, number> };
  tenants: { total: number; byStatus: Record<string, number> };
  demand: {
    total: number; unanswered: number; locked: number;
    byTier: Record<string, number>;
    topSlugs: Array<{ slug: string; count: number }>;
    recentUnanswered: RecentQuestion[];
    recentLocked: RecentQuestion[];
  } | null;
  toolUsage: Record<string, number> | null;
}

const CARD: React.CSSProperties = {
  padding: '1rem 1.1rem', background: 'var(--lp-white)',
  border: '1px solid var(--lp-border)', borderRadius: 8,
};
const STAT: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 700, color: 'var(--lp-text)', lineHeight: 1.1 };
const LABEL: React.CSSProperties = {
  fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--lp-steel)', fontFamily: 'var(--lp-font-mono)', marginTop: '0.4rem',
};
const SUB: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--lp-steel)', marginTop: '0.3rem' };

function Card({ stat, label, sub }: { stat: React.ReactNode; label: string; sub?: string }) {
  return (
    <div style={CARD}>
      <div style={STAT}>{stat}</div>
      <div style={LABEL}>{label}</div>
      {sub && <div style={SUB}>{sub}</div>}
    </div>
  );
}

function breakdown(rec: Record<string, number>): string {
  const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(' · ') : '—';
}

const SECTION_H: React.CSSProperties = {
  fontSize: '0.8rem', fontWeight: 600, color: 'var(--lp-steel)', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontFamily: 'var(--lp-font-mono)', margin: '0 0 0.6rem',
};
const LIST_ITEM: React.CSSProperties = {
  fontSize: '0.82rem', color: 'var(--lp-text)', padding: '0.35rem 0',
  borderBottom: '1px solid var(--lp-border)', display: 'flex', gap: '0.6rem', alignItems: 'baseline',
};
const LIST_META: React.CSSProperties = {
  fontSize: '0.68rem', color: 'var(--lp-steel-lt)', fontFamily: 'var(--lp-font-mono)',
  textTransform: 'uppercase', whiteSpace: 'nowrap',
};

function QuestionList({ title, items, empty }: { title: string; items: RecentQuestion[]; empty: string }) {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginTop: 0, marginBottom: '0.5rem' }}>{title}</div>
      {items.length === 0 ? (
        <div style={SUB}>{empty}</div>
      ) : (
        items.map((qn, i) => (
          <div key={i} style={{ ...LIST_ITEM, borderBottom: i === items.length - 1 ? 'none' : LIST_ITEM.borderBottom }}>
            <span style={{ flex: 1 }}>{qn.text}</span>
            <span style={LIST_META}>{qn.tier} · {new Date(qn.at).toLocaleDateString()}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function AdminAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/analytics');
        const d = await res.json();
        if (!res.ok) { setErr(d.error ?? 'Failed to load analytics.'); return; }
        setData(d);
      } catch { setErr('Failed to load analytics.'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <p style={{ color: 'var(--lp-steel)', fontSize: '0.875rem' }}>Loading…</p>;
  if (err) return <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>;
  if (!data) return null;

  const grid: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--lp-steel)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--lp-font-mono)', margin: '0 0 0.6rem' }}>Users</h2>
        <div style={grid}>
          <Card stat={data.totalUsers} label="Total users" />
          <Card stat={data.clerkComps} label="Manual Clerk comps" sub={data.clerkCompsCapped ? 'first 500 scanned' : undefined} />
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--lp-steel)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--lp-font-mono)', margin: '0 0 0.6rem' }}>Comps &amp; trials (Supabase)</h2>
        <div style={grid}>
          <Card stat={data.grants.compUsers} label="Comped users" sub={breakdown(data.grants.byTier)} />
          <Card stat={data.grants.compDomains} label="Comped domains" />
          <Card stat={data.grants.trials} label="Active trials" />
          <Card stat={data.grants.expiringSoon} label="Expiring ≤ 30 days" sub={data.grants.expiringSoon > 0 ? 'needs attention' : undefined} />
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--lp-steel)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--lp-font-mono)', margin: '0 0 0.6rem' }}>Tenants</h2>
        <div style={grid}>
          <Card stat={data.tenants.total} label="Tenants" sub={breakdown(data.tenants.byStatus)} />
        </div>
      </div>

      <div>
        <h2 style={SECTION_H}>Demand — last 30 days</h2>
        {data.demand ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={grid}>
              <Card stat={data.demand.total} label="Questions asked" sub={breakdown(data.demand.byTier)} />
              <Card stat={data.demand.unanswered} label="Unanswered (content gaps)" sub={data.demand.unanswered > 0 ? 'vault couldn’t answer these' : undefined} />
              <Card stat={data.demand.locked} label="Paywall hits" sub={data.demand.locked > 0 ? 'under-tier users blocked by a skill match' : undefined} />
              <Card
                stat={data.demand.topSlugs[0]?.slug ?? '—'}
                label="Top matched skill"
                sub={data.demand.topSlugs.slice(0, 5).map(s => `${s.slug}: ${s.count}`).join(' · ') || undefined}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.85rem' }}>
              <QuestionList title="Recent unanswered" items={data.demand.recentUnanswered} empty="No unanswered questions — the vault is keeping up." />
              <QuestionList title="Recent paywall hits" items={data.demand.recentLocked} empty="No paywall friction in the window." />
            </div>
          </div>
        ) : (
          <p style={SUB}>Demand stats unavailable (questions query failed — check logs).</p>
        )}
      </div>

      <div>
        <h2 style={SECTION_H}>Tool usage — last 30 days</h2>
        {data.toolUsage ? (
          Object.keys(data.toolUsage).length === 0 ? (
            <p style={SUB}>No calculator runs recorded yet (telemetry started 2026-07-13).</p>
          ) : (
            <div style={grid}>
              {Object.entries(data.toolUsage).sort((a, b) => b[1] - a[1]).map(([tool, count]) => (
                <Card key={tool} stat={count} label={tool} />
              ))}
            </div>
          )
        ) : (
          <p style={SUB}>Tool usage unavailable (tool_usage query failed — check logs).</p>
        )}
      </div>
    </div>
  );
}
