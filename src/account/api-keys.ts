// core/src/account/api-keys.ts
//
// Generic programmatic-access key management: mint, hash, verify, rate-limit,
// revoke. Lived under lib/consult/ for historical reasons only — nothing here
// knows about engagements.
// API key generation, hashing, and bearer token parsing.
// Public v1 routes authenticate via the withApiAuth() wrapper below.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { APIContext, APIRoute } from 'astro';

/** First N chars of the raw key, stored alongside the hash for indexed lookup. */
export const API_KEY_PREFIX_LENGTH = 12;

// NOTE: the full raw string including the 'kb_live_' prefix is what gets hashed.
// Do not strip the prefix before calling hashKey().
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = 'kb_live_' + randomBytes(24).toString('hex');
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, API_KEY_PREFIX_LENGTH) };
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time comparison of two hex-encoded SHA-256 hashes. */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

let _sb: SupabaseClient | null = null;

function getSb() {
  if (_sb) return _sb;
  const url = (import.meta as any).env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

export interface ApiKeyRecord {
  id: string;
  org_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export const API_RATE_LIMIT_PER_MINUTE = 60;

/** Aggregate quota across all of an org's keys, enforced by check_rate_limit. */
export const API_ORG_RATE_LIMIT_PER_MINUTE = 300;

export interface RateLimitInfo {
  limit: number;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Unix epoch seconds when the current window expires. */
  reset: number;
}

export type ApiKeyVerification =
  | { ok: true; orgId: string; keyId: string; rateLimit: RateLimitInfo }
  | { ok: false; reason: 'invalid_key' }
  | { ok: false; reason: 'rate_limited'; rateLimit: RateLimitInfo };

/**
 * Verify raw key from Authorization header. Distinguishes an invalid/expired
 * key (→ 401) from a valid key that is over its rate limit (→ 429), and
 * carries the real limit/remaining/reset values from the check_rate_limit RPC
 * (which enforces both the per-key and the per-org limit).
 *
 * Lookup fetches candidate rows by key_prefix and compares full hashes with
 * crypto.timingSafeEqual. Keys created before the key_prefix column existed
 * have no prefix stored (only the hash), so they fall back to the original
 * hash-equality lookup.
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKeyVerification> {
  const sb = getSb();
  const hash = hashKey(rawKey);
  const prefix = rawKey.slice(0, API_KEY_PREFIX_LENGTH);

  const { data: candidates } = await sb
    .from('api_keys')
    .select('id, org_id, expires_at, key_hash')
    .eq('key_prefix', prefix);

  let data = (candidates ?? []).find((row) => hashesMatch(row.key_hash, hash)) ?? null;

  if (!data) {
    // Legacy keys (no prefix stored) — hash-equality lookup as before.
    const { data: legacy } = await sb
      .from('api_keys')
      .select('id, org_id, expires_at, key_hash')
      .eq('key_hash', hash)
      .is('key_prefix', null)
      .single();
    data = legacy;
  }

  if (!data) return { ok: false, reason: 'invalid_key' };

  // Reject expired keys.
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, reason: 'invalid_key' };

  // Atomic rate-limit check; NULL means the key vanished between the lookup
  // above and the RPC (revoked mid-request) — treat as invalid.
  const { data: rl, error: rlError } = await sb.rpc('check_rate_limit', {
    p_key_id: data.id,
    p_limit: API_RATE_LIMIT_PER_MINUTE,
    p_org_id: data.org_id,
    p_org_limit: API_ORG_RATE_LIMIT_PER_MINUTE,
  });
  if (rlError) throw rlError;
  const result = rl as { allowed: boolean; limit?: number; remaining: number; reset: number } | null;
  if (!result) return { ok: false, reason: 'invalid_key' };

  const rateLimit: RateLimitInfo = {
    // 'limit' is whichever of the key/org limits was tighter for this request.
    limit: typeof result.limit === 'number' ? result.limit : API_RATE_LIMIT_PER_MINUTE,
    remaining: result.remaining,
    reset: result.reset,
  };
  if (!result.allowed) return { ok: false, reason: 'rate_limited', rateLimit };

  return { ok: true, orgId: data.org_id, keyId: data.id, rateLimit };
}

// ── Route wrapper ─────────────────────────────────────────────────────────────

export interface ApiAuthInfo {
  orgId: string;
  keyId: string;
}

function jsonError(body: unknown, status: number, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function rateLimitHeaders(rl: RateLimitInfo): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(Math.max(0, rl.remaining)),
    'X-RateLimit-Reset': String(rl.reset),
  };
}

/**
 * Wrap a public v1 route handler with bearer parsing, key verification,
 * rate limiting, and a catch-all error boundary:
 *  - missing/malformed Authorization → 401
 *  - invalid or expired key → 401
 *  - over the per-key rate limit → 429 with Retry-After
 *  - any throw from the handler (or the DB) → generic 500, no detail leaked
 * Real X-RateLimit-* headers are stamped onto every authenticated response.
 * The `deps` parameter exists for tests only.
 */
export function withApiAuth(
  handler: (context: APIContext, auth: ApiAuthInfo) => Promise<Response> | Response,
  deps: { verify?: typeof verifyApiKey } = {},
): APIRoute {
  const verify = deps.verify ?? verifyApiKey;
  return async (context) => {
    try {
      const rawKey = parseBearer(context.request.headers.get('Authorization'));
      if (!rawKey) {
        return jsonError({ error: 'Missing or malformed Authorization header. Use: Bearer <api_key>' }, 401);
      }

      const verified = await verify(rawKey);
      if (!verified.ok) {
        if (verified.reason === 'rate_limited') {
          return jsonError({ error: 'Rate limit exceeded' }, 429, {
            ...rateLimitHeaders(verified.rateLimit),
            'Retry-After': String(Math.max(1, verified.rateLimit.reset - Math.floor(Date.now() / 1000))),
          });
        }
        return jsonError({ error: 'Invalid API key' }, 401);
      }

      const response = await handler(context, { orgId: verified.orgId, keyId: verified.keyId });
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(rateLimitHeaders(verified.rateLimit))) headers.set(k, v);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (err) {
      console.error('[api/v1] unhandled error:', err);
      return jsonError({ error: 'internal_error' }, 500);
    }
  };
}

/** List all non-revoked keys for an org (excludes hash). */
export async function listApiKeys(orgId: string): Promise<ApiKeyRecord[]> {
  const sb = getSb();
  const { data, error } = await sb
    .from('api_keys')
    .select('id, org_id, label, created_at, last_used_at, expires_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Create a new API key. Returns the raw key (shown once) and the stored record. */
export async function createApiKey(
  orgId: string,
  label: string,
  expiresAt?: Date | null,
): Promise<{ raw: string; record: ApiKeyRecord }> {
  const sb = getSb();
  const { raw, hash, prefix } = generateApiKey();
  const { data, error } = await sb
    .from('api_keys')
    .insert({ org_id: orgId, key_hash: hash, key_prefix: prefix, label, expires_at: expiresAt ?? null })
    .select('id, org_id, label, created_at, last_used_at, expires_at')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create API key');
  return { raw, record: data };
}

/**
 * Revoke (delete) a key. Verifies ownership before deleting.
 * Returns true if a row was actually deleted, false if no key matched
 * (wrong id or org-context mismatch) — callers use this to return 404
 * instead of silently reporting success.
 */
export async function revokeApiKey(id: string, orgId: string): Promise<boolean> {
  const sb = getSb();
  const { data, error } = await sb
    .from('api_keys')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
