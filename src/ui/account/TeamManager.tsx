// src/components/account/TeamManager.tsx
import { useEffect, useState } from 'react';

const ROLE_ADMIN = 'org:admin';
const ROLE_MEMBER = 'org:member';

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
const BTN_PRIMARY: React.CSSProperties = {
  padding: '0.5rem 1rem', borderRadius: 7, border: 'none',
  background: 'var(--lp-indigo)', color: '#fff',
  fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit',
};
const BTN_GHOST: React.CSSProperties = {
  padding: '0.3rem 0.65rem', borderRadius: 6,
  border: '1px solid var(--lp-border)',
  background: 'transparent', color: 'var(--lp-steel)',
  fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
};

interface Member { userId: string; firstName: string | null; lastName: string | null; email: string | null; role: string; joinedAt: string | null; }
interface Invitation { id: string; email: string | null; role: string; createdAt: string | null; }
interface OrgMeta { name: string; purchased_seats: number | null; }
interface Payload { org: OrgMeta | null; members: Member[]; invitations: Invitation[]; selfId: string; isAdmin: boolean; }

/**
 * Self-serve seat billing. Supplied only by portals that actually sell a
 * seat-priced plan; omit it and the seat-adjustment control is not rendered at
 * all, leaving member management (invite / role / remove) intact.
 */
export interface SeatPricing {
  /** Annual total for `n` seats, in whole dollars. */
  yearlyPrice: (n: number) => number;
  minSeats: number;
}

export interface TeamManagerProps {
  seatPricing?: SeatPricing | null;
}

function roleLabel(r: string): string { return r === ROLE_ADMIN ? 'Admin' : 'Member'; }
function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function memberName(m: Member): string {
  const n = [m.firstName, m.lastName].filter(Boolean).join(' ').trim();
  return n || m.email || m.userId;
}

export default function TeamManager({ seatPricing = null }: TeamManagerProps = {}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState(ROLE_MEMBER);
  const [inviting, setInviting] = useState(false);

  // seat change (admins, Stripe-billed orgs)
  const [seatInput, setSeatInput] = useState('');
  const [savingSeats, setSavingSeats] = useState(false);

  async function load() {
    setErr(null);
    try {
      const res = await fetch('/api/account/team/members');
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Failed to load team.'); return; }
      setData(d);
    } catch { setErr('Failed to load team.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <p style={{ color: 'var(--lp-steel)', fontSize: '0.875rem' }}>Loading…</p>;
  if (err) return <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>;
  if (!data) return null;

  // Empty state: no active org.
  if (!data.org) {
    return (
      <div style={{ padding: '2rem', background: 'var(--lp-white)', border: '1px solid var(--lp-border)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--lp-text)', margin: '0 0 0.4rem' }}>No team workspace</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--lp-steel)', margin: '0 0 1rem' }}>
          Team workspaces let you share access with colleagues under one plan.
        </p>
        <a href="/pricing" style={{ ...BTN_PRIMARY, textDecoration: 'none', display: 'inline-block' }}>View Team plans</a>
      </div>
    );
  }

  const { org, members, invitations, selfId, isAdmin } = data;
  const adminCount = members.filter((m) => m.role === ROLE_ADMIN).length;
  const seats = org.purchased_seats;
  // Pending invitations hold a seat — mirrors the server-side cap in the invite route.
  const used = members.length + invitations.length;
  const atCap = seats != null && used >= seats;
  const pct = seats && seats > 0 ? Math.min(100, Math.round((used / seats) * 100)) : 0;
  const barColor = pct >= 100 ? '#C0392B' : pct >= 80 ? '#B8860B' : '#1E8E4E';

  async function invite() {
    setErr(null);
    setInviting(true);
    try {
      const res = await fetch('/api/account/team/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Invite failed.'); return; }
      setInviteEmail('');
      await load();
    } finally { setInviting(false); }
  }

  async function changeRole(userId: string, role: string) {
    setErr(null);
    const res = await fetch(`/api/account/team/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Role change failed.'); }
  }

  async function remove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the team?`)) return;
    setErr(null);
    const res = await fetch(`/api/account/team/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Remove failed.'); }
  }

  async function updateSeats() {
    const n = Number(seatInput);
    if (!Number.isInteger(n) || n <= 0) { setErr('Seats must be a whole number.'); return; }
    if (!seatPricing) return;
    const total = seatPricing.yearlyPrice(n).toLocaleString('en-US');
    const prorated = seats != null && n > seats ? ' The increase is prorated and charged now.' : '';
    if (!confirm(`Set ${n} seats — $${total}/year at renewal.${prorated}`)) return;
    setErr(null);
    setSavingSeats(true);
    try {
      const res = await fetch('/api/account/team/seats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats: n }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Seat change failed.'); return; }
      setSeatInput('');
      await load();
    } finally { setSavingSeats(false); }
  }

  async function revoke(id: string) {
    setErr(null);
    const res = await fetch(`/api/account/team/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); setErr(e.error ?? 'Revoke failed.'); }
  }

  return (
    <div>
      {/* ── Seat usage strip ── */}
      <div style={{ padding: '1rem 1.1rem', background: 'var(--lp-white)', border: '1px solid var(--lp-border)', borderRadius: 8, marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--lp-text)' }}>{org.name}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--lp-steel)', fontFamily: 'var(--lp-font-mono)' }}>
            {used} used{invitations.length > 0 ? ` (${members.length} members + ${invitations.length} pending)` : ''}{seats != null ? ` / ${seats} seats` : ' · unlimited seats'}
          </span>
        </div>
        {seats != null && seats > 0 && (
          <div style={{ height: 7, borderRadius: 4, background: 'var(--lp-border)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.2s' }} />
          </div>
        )}
        {seats != null && used > seats && (
          <p style={{ fontSize: '0.78rem', color: '#C0392B', margin: '0.5rem 0 0' }}>
            You're over your purchased seats. New invites are blocked until you add seats or remove members.
          </p>
        )}
        {isAdmin && seats != null && seatPricing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.75rem' }}>
            <input
              type="number" min={Math.max(used, seatPricing.minSeats)} step={1}
              value={seatInput} onChange={(e) => setSeatInput(e.target.value)}
              placeholder={String(seats)}
              style={{ ...INPUT, width: 90, padding: '0.35rem 0.55rem', fontSize: '0.8rem' }}
              aria-label="Seat count"
            />
            <button onClick={updateSeats} disabled={savingSeats || !seatInput}
              style={{ ...BTN_GHOST, opacity: (savingSeats || !seatInput) ? 0.5 : 1 }}>
              {savingSeats ? 'Updating…' : 'Update seats'}
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--lp-steel-lt)' }}>
              min {Math.max(used, seatPricing.minSeats)} · increases prorated now, decreases apply at renewal
            </span>
          </div>
        )}
      </div>

      {err && <p style={{ color: '#C0392B', fontSize: '0.85rem' }}>{err}</p>}

      {/* ── Invite form (admins only) ── */}
      {isAdmin && (
        <div style={{ padding: '1rem', background: 'var(--lp-white)', border: '1px solid var(--lp-border)', borderRadius: 8, marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--lp-text)', margin: '0 0 0.6rem' }}>Invite a member</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.6rem' }}>
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="person@company.com"
              disabled={atCap}
              onKeyDown={(e) => { if (e.key === 'Enter' && inviteEmail && !atCap) invite(); }} style={{ ...INPUT, opacity: atCap ? 0.5 : 1 }} />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} disabled={atCap} style={INPUT}>
              <option value={ROLE_MEMBER}>Member</option>
              <option value={ROLE_ADMIN}>Admin</option>
            </select>
            <button onClick={invite} disabled={inviting || !inviteEmail || atCap}
              style={{ ...BTN_PRIMARY, opacity: (inviting || !inviteEmail || atCap) ? 0.5 : 1 }}>
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          {atCap && (
            <p style={{ fontSize: '0.78rem', color: '#B8860B', margin: '0.6rem 0 0' }}>
              Seat limit reached — all {seats} seats are in use (including pending invites).{seatPricing ? ' Add seats above to invite more people.' : ''}
            </p>
          )}
        </div>
      )}

      {/* ── Roster ── */}
      <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Members ({members.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: invitations.length ? '2rem' : 0 }}>
        <thead>
          <tr>
            <th style={TH}>Name</th><th style={TH}>Email</th><th style={TH}>Role</th><th style={TH}>Joined</th>
            {isAdmin && <th style={{ ...TH, textAlign: 'right' }}></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.userId === selfId;
            const lastAdmin = m.role === ROLE_ADMIN && adminCount <= 1;
            return (
              <tr key={m.userId}>
                <td style={CELL}>{memberName(m)}{isSelf ? ' (you)' : ''}</td>
                <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{m.email ?? '—'}</td>
                <td style={CELL}>
                  {isAdmin && !isSelf ? (
                    <select value={m.role} onChange={(e) => changeRole(m.userId, e.target.value)}
                      disabled={lastAdmin}
                      style={{ ...INPUT, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>
                      <option value={ROLE_MEMBER}>Member</option>
                      <option value={ROLE_ADMIN}>Admin</option>
                    </select>
                  ) : roleLabel(m.role)}
                </td>
                <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{fmt(m.joinedAt)}</td>
                {isAdmin && (
                  <td style={{ ...CELL, textAlign: 'right' }}>
                    {!isSelf && !lastAdmin && (
                      <button onClick={() => remove(m.userId, memberName(m))} style={{ ...BTN_GHOST, color: '#C0392B' }}>Remove</button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Pending invitations ── */}
      {invitations.length > 0 && (
        <>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Pending invitations ({invitations.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Email</th><th style={TH}>Role</th><th style={TH}>Invited</th>
                {isAdmin && <th style={{ ...TH, textAlign: 'right' }}></th>}
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td style={CELL}>{i.email ?? '—'}</td>
                  <td style={CELL}>{roleLabel(i.role)}</td>
                  <td style={{ ...CELL, color: 'var(--lp-steel)' }}>{fmt(i.createdAt)}</td>
                  {isAdmin && (
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      <button onClick={() => revoke(i.id)} style={{ ...BTN_GHOST, color: '#C0392B' }}>Revoke</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
