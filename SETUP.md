# New portal setup

Replace `TOPIC` throughout with the portal's slug (e.g. `logistics`, `estimating`).

## 1. Create the repo and submodules

```bash
gh repo create kbaas-ai/TOPIC-portal --private --clone
cd TOPIC-portal

# Vault (private, topic-specific content)
git submodule add https://github.com/kbaas-ai/TOPIC-vault vault

# Core (public, shared logic)
git submodule add https://github.com/kbaas-ai/portal-core core
```

## 2. tsconfig.json path alias

```json
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["core/src/*"]
    }
  }
}
```

## 3. vercel.json

Copy `vercel.json.template` from this repo to the portal root.
Replace every occurrence of `TOPIC` in the CSP header with the actual topic slug.

## 4. src/lib/tiers.ts

```ts
export * from "@core/tiers";
```

## 5. src/lib/access.ts

```ts
import {
  getUserTier as _getUserTier,
  getUserTiers as _getUserTiers,
  getUserPlan as _getUserPlan,
  getUserAskTier as _getUserAskTier,
  type TopicConfig,
} from "@core/access";

export {
  hasAccess, canRead, TIER_RANK, PLAN_DISPLAY, TIER_DISPLAY,
  monthlyQueryLimitForTier, canUseSkills, unlocksProContentForTier,
} from "@core/access";

export type {
  ContentTier, PlanSlug, Tier, ClerkAuth, TopicConfig,
} from "@core/access";

export type { TierSlug } from "@core/tiers";

const TOPIC_CFG: TopicConfig = { topic: "TOPIC" };

export const getUserTier   = (auth: any) => _getUserTier(auth, TOPIC_CFG);
export const getUserTiers  = (auth: any) => _getUserTiers(auth, TOPIC_CFG);
export const getUserPlan   = (auth: any) => _getUserPlan(auth, TOPIC_CFG);
export const getUserAskTier = (auth: any) => _getUserAskTier(auth, TOPIC_CFG);
```

## 6. src/pages/api/stripe-webhook.ts

Key names follow the convention `TOPIC_subscription_tier` / `TOPIC_subscription_status`.

```ts
import {
  decideTierForEvent, resolveClerkUserId, syncToClerk,
  getExistingTier, logSyncFailure,
} from "@core/stripe-utils";

const TIER_KEY   = "TOPIC_subscription_tier";
const STATUS_KEY = "TOPIC_subscription_status";

function priceIdToTier(priceId: string | null | undefined) {
  if (!priceId) return null;
  const env = import.meta.env;
  if (priceId === env.STRIPE_PRICE_STARTER_MONTHLY)   return "starter"   as const;
  if (priceId === env.STRIPE_PRICE_PRO_MONTHLY ||
      priceId === env.STRIPE_PRICE_PRO_ANNUAL)         return "pro"       as const;
  if (priceId === env.STRIPE_PRICE_UNLIMITED_MONTHLY)  return "unlimited" as const;
  if (priceId === env.STRIPE_PRICE_STANDARD_MONTHLY ||
      priceId === env.STRIPE_PRICE_STANDARD_ANNUAL)    return "standard"  as const;
  return null;
}
```

## 7. src/pages/api/ask.ts — tierFromSessionClaims

Read the topic-scoped metadata keys:

```ts
const tier   = meta[`TOPIC_subscription_tier`];
const status = meta[`TOPIC_subscription_status`];
```

## 8. Vercel environment variables

| Variable | Description |
|---|---|
| `VAULT_GIT_TOKEN` | GitHub PAT with `repo` scope — clones the private vault and core submodules |
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | Embeddings |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER_MONTHLY` | Stripe price ID |
| `STRIPE_PRICE_STANDARD_MONTHLY` | Stripe price ID |
| `STRIPE_PRICE_STANDARD_ANNUAL` | Stripe price ID |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe price ID |
| `STRIPE_PRICE_PRO_ANNUAL` | Stripe price ID |
| `STRIPE_PRICE_UNLIMITED_MONTHLY` | Stripe price ID |
| `IP_HASH_SALT` | Random secret for hashing requester IPs |
| `KB_DEV_TIER_SECRET` | Optional — enables `x-kb-tier` header override for local testing |

## 9. Clerk metadata key convention

Clerk `publicMetadata` keys per user:

```
TOPIC_subscription_tier   — "free" | "starter" | "standard" | "pro" | "unlimited"
TOPIC_subscription_status — "active" | "trialing" | "past_due" | "canceled" | ...
```

Set by the Stripe webhook on subscription events.
