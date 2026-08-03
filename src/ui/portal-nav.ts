// core/src/ui/portal-nav.ts
//
// The shared SHAPE of the portal sidebar nav, plus the active-route rule.
// Each portal builds its own nav MODEL (which items exist, what unlocks them)
// and hands it to @core/ui/PortalLayout.astro to render — see
// logistics-portal/src/lib/portal-nav.ts for one such model.
//
// Nothing here knows about a specific portal's routes or tiers.

export type FirmType = "consultant" | "operator" | "both";

export interface PortalNavItem {
  /** Stable key. Also the fallback display text. */
  label: string;
  /** Translated text to render, when the portal does i18n. Defaults to label. */
  displayLabel?: string;
  href: string;
  /** Extra path prefixes (besides href) that should mark this item active. */
  activeMatch?: string[];
  /**
   * Match href EXACTLY rather than as a path prefix. Use when a child route
   * has its own nav item that would otherwise be shadowed — e.g. "/account"
   * must not light up while the user is on "/account/integrations".
   */
  exact?: boolean;
  locked?: boolean;
  lockHref?: string;
  badge?: string;
}

export interface PortalNavGroup {
  /** Stable key, also emitted as `data-act` for the per-act accent. */
  label: string;
  /** Translated heading to render. Defaults to label. */
  displayLabel?: string;
  items: PortalNavItem[];
  /**
   * Render as a <details> accordion rather than a flat labelled block. For
   * long, browsable lists — a knowledge-base pillar tree, say — where a flat
   * render would push the rest of the sidebar off-screen. The group opens
   * automatically when it contains the active route.
   */
  collapsible?: boolean;
  /** Start a collapsible group open even when nothing inside it is active. */
  defaultOpen?: boolean;
  /** Shown inside a collapsible group that has no items. */
  emptyText?: string;
}

export interface PortalNav {
  dashboard: PortalNavItem;
  groups: PortalNavGroup[];
}

/**
 * Is `href` the active route for `path`?
 *
 * Prefix matching is segment-aware: "/tools" matches "/tools" and "/tools/x"
 * but NOT "/toolsmith". The previous inline implementation used a bare
 * `path.startsWith(href)`, which had that false-positive, and worked around
 * the "/account" vs "/account/integrations" case with a hardcoded per-route
 * branch. `exact` replaces those hardcoded branches.
 */
export function isActiveHref(
  path: string,
  href: string,
  exact = false,
): boolean {
  if (!href || href === "#") return false;
  const norm = (s: string) => (s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s);
  const p = norm(path);
  const h = norm(href);
  if (p === h) return true;
  if (exact) return false;
  return p.startsWith(h + "/");
}

/** True when the item (or any of its activeMatch prefixes) is the active route. */
export function isItemActive(path: string, item: PortalNavItem): boolean {
  if (isActiveHref(path, item.href, item.exact)) return true;
  return (item.activeMatch ?? []).some((m) => isActiveHref(path, m));
}

/** Which group (act) the current path belongs to, or null. */
export function currentActFor(path: string, nav: PortalNav): string | null {
  for (const group of nav.groups) {
    if (group.items.some((item) => isItemActive(path, item))) return group.label;
  }
  return null;
}
