# Calvren live subscription tiers — November 9, 2026

## Three monthly plans (CAD, before any applicable taxes)

| Tier | Monthly | First invoice (includes one-time $349 setup) | Renewal |
| --- | ---: | ---: | ---: |
| Starter | CA$99 | CA$448 | CA$99 |
| Growth | CA$219 | CA$568 | CA$219 |
| Pro | CA$389 | CA$738 | CA$389 |

The initial charge includes onboarding. The setup fee is not charged on regular monthly renewals. Additional custom integrations and support must be scoped during onboarding; these published monthly prices do not authorize unlimited third-party usage.

## Live Stripe price IDs (not secrets)
- Starter `price_1UQWVeQ9mewkKyl5kv85ccXb` — existing $99/month.
- Growth `price_1Ua3rFQ9mewkKyl5dIhzjarI` — live $219/month.
- Pro `price_1Ua3rNQ9mewkKyl5TrGGeeQU` — live $389/month.
- Setup `price_1UQX1gQ9mewkKyl5QpjCrTyt` — existing $349 one-time fee.

All are on the live Calvren Stripe account, billed in CAD. Growth and Pro price tax behavior is `exclusive`; the old Starter/setup prices remain `unspecified`. There are **no current Stripe Tax registrations**, and Stripe Tax has no head office configured, so automatic tax collection must not be claimed. Confirm registration requirements with the business's tax adviser before collecting tax. Do not configure fictitious tax registrations.

## Server, checkout, and access rules
- The live backend pins the two new verified Price IDs. The existing Starter price, setup price, Stripe API key and webhook signing key remain securely configured through server-only secrets.
- The public billing endpoint returns a `ready` flag for each plan only after Stripe verifies that the corresponding live Price ID is active, CAD, and exactly $99/$219/$389 monthly.
- Logged-in verified customers choose the plan; the backend creates the Stripe-hosted subscription Checkout Session. The first invoice also includes the one-time $349 setup price.
- A successful redirect **does not** grant subscription access. Only a valid signed Stripe webhook, reconciled with the current Stripe subscription and an allowed verified price ID, can update paid membership.
- Paid plan entitlements are server-derived. The client dashboard is scoped to the signed-in account and only a server-assigned business client ID.
- Existing paid customers are not silently upgraded, downgraded, or rebilled; plan changes for existing subscriptions need a separate owner-approved proration and billing policy.

## Delivery and activation limitations
The pricing and billing system is separate from activation of production automations. Starter's lead-response and booking providers require customer-owned integrations, consent and live tests. Growth has a read-only monthly activity summary; review-request delivery and automated monthly report emails still require implementation. Pro's unified inbox, advanced integrations and support arrangements require scoped implementation. The website must disclose that onboarding and testing precede activation. Never promise fully working services merely because payment succeeded.

## Production readiness checklist
1. Check `https://calvren.pages.dev/api/billing/public`: `ready===true`, `test_mode===false`, and `plans.starter.ready`, `plans.growth.ready`, and `plans.pro.ready` are all true with $99/$219/$389 minor units.
2. Check the public signup/login page and all three plan selectors route to the correct Stripe-hosted checkout. This does **not** require or justify a real test purchase on a live card.
3. Confirm the Stripe webhook endpoint is enabled for `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Test signed event and cancellation behavior in a sandbox before processing customer payments.
4. Complete an owner-approved test-mode rehearsal of checkout, webhook membership, initial invoice, recurring invoice, billing portal, cancellation and failed-payment behavior.
5. Set up merchant tax registrations, terms, onboarding expectations, usage limits, and support scope as legally appropriate.
