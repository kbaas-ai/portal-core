// core/src/ui/org-context.ts
//
// Resolves the active organization's branding + entitlement flags from Clerk.
//
// This ran inline inside PortalLayout.astro before the chrome extraction. It
// lives here so the shared layout can stay presentation-only: a portal calls
// this, then passes the result down as the `org` prop. A portal that does not
// use Clerk organizations simply never calls it.
//
// currentUser() does NOT populate organizationMemberships in the Astro
// integration, so this calls the Clerk backend SDK directly. Every failure is
// non-fatal — the portal must still render without org branding.

import { deriveAccentPalette, type AccentPalette } from "./accent-color.ts";

export type FirmType = "consultant" | "operator" | "both";

export interface OrgContext {
  imageUrl: string | null;
  name: string | null;
  accentPalette: AccentPalette | null;
  firmType: FirmType | null;
  isComped: boolean;
  /** True when the org exists but has no team_type set yet. */
  needsWorkspaceSetup: boolean;
}

export const EMPTY_ORG_CONTEXT: OrgContext = {
  imageUrl: null,
  name: null,
  accentPalette: null,
  firmType: null,
  isComped: false,
  needsWorkspaceSetup: false,
};

function isFirmType(v: unknown): v is FirmType {
  return v === "consultant" || v === "operator" || v === "both";
}

export interface ResolveOrgContextInput {
  secretKey: string | undefined;
  userId: string | null;
  orgId: string | null;
  /** Pre-known values win over anything fetched (caller-supplied overrides). */
  imageUrl?: string | null;
  name?: string | null;
}

export async function resolveOrgContext({
  secretKey,
  userId,
  orgId,
  imageUrl = null,
  name = null,
}: ResolveOrgContextInput): Promise<OrgContext> {
  const ctx: OrgContext = { ...EMPTY_ORG_CONTEXT, imageUrl, name };
  if (!secretKey) return ctx;

  try {
    const { createClerkClient } = await import("@clerk/backend");
    const clerk = createClerkClient({ secretKey });

    let meta: Record<string, unknown> | null = null;

    if (orgId) {
      // Active org context — fetch the org directly.
      const org = await clerk.organizations.getOrganization({ organizationId: orgId });
      ctx.imageUrl = ctx.imageUrl ?? ((org.imageUrl as string | null) ?? null);
      ctx.name = ctx.name ?? ((org.name as string | null) ?? null);
      meta = (org.publicMetadata || {}) as Record<string, unknown>;
    } else if (userId) {
      // No active org — fall back to the first org the user belongs to.
      const memberships = await clerk.users.getOrganizationMembershipList({ userId, limit: 1 });
      const first = (memberships.data ?? (memberships as any))?.[0];
      if (first?.organization?.imageUrl) {
        ctx.imageUrl = ctx.imageUrl ?? (first.organization.imageUrl as string);
        ctx.name = ctx.name ?? ((first.organization.name as string | null) ?? null);
      }
      meta = first != null ? ((first.organization?.publicMetadata || {}) as Record<string, unknown>) : null;
    }

    if (meta) {
      const accent = (meta as any).accent_color ?? null;
      ctx.accentPalette = accent ? deriveAccentPalette(accent) : null;
      ctx.isComped = (meta as any).comped === true;
      const teamType = (meta as any).team_type ?? null;
      ctx.needsWorkspaceSetup = teamType === null;
      if (isFirmType(teamType)) ctx.firmType = teamType;
    }
  } catch {
    /* non-fatal — render without org branding */
  }

  return ctx;
}
