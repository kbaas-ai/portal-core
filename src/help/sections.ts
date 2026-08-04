// core/src/help/sections.ts
//
// The help centre's section vocabulary, shared so every portal's help
// collection validates against the same set and the index page can render
// sections in one known order. The ARTICLES themselves stay per-portal —
// each portal documents its own features.

export const HELP_SECTIONS = [
  "getting-started",
  "features",
  "integrations",
  "account",
  "faq",
] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number];

export const SECTION_LABELS: Record<string, string> = {
  "getting-started": "Getting Started",
  features: "Features",
  integrations: "Integrations",
  account: "Account",
  faq: "FAQ",
};

export function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key;
}

/**
 * Zod shape for a portal's `help` collection. Passed the portal's `z` so the
 * core package needs no direct dependency on the astro:content zod instance.
 */
export function helpSchema(z: any) {
  return z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(HELP_SECTIONS),
    order: z.number().int().default(99),
    tags: z.array(z.string()).default([]),
  });
}
