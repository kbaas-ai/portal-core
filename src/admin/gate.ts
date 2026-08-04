// src/lib/admin/gate.ts
// Global platform-admin gating. Admins are identified by primary email against
// the ADMIN_EMAILS env var (comma-separated). Deny by default when unset.

function getEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name] !== undefined) return process.env[name];
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) return (import.meta as any).env[name];
  return undefined;
}

/** Parse a comma-separated allowlist into a lowercased Set. */
export function adminEmailSet(raw: string | undefined = getEnv('ADMIN_EMAILS')): Set<string> {
  return new Set((raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/** True if `email` is an allowlisted platform admin. */
export function isAdminEmail(email: string | null | undefined, raw?: string): boolean {
  if (!email) return false;
  return adminEmailSet(raw).has(email.trim().toLowerCase());
}

/**
 * Resolve the signed-in user's primary email from Astro locals and return it
 * only if they are an admin; otherwise null. Used by /admin pages + APIs.
 */
export async function getAdminEmail(locals: App.Locals): Promise<string | null> {
  const user = await locals.currentUser?.();
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;
  return isAdminEmail(email) ? email : null;
}
