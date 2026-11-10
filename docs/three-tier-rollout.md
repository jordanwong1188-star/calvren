# Calvren verified live subscription plans — November 10, 2026

## Original subscription pricing restored (CAD, before any applicable taxes)

| Tier | Monthly | Initial invoice (includes one-time $349 setup) | Monthly renewal |
| --- | ---: | ---: | ---: |
| Starter | $99 | $448 | $99 |
| Growth | $249 | $598 | $249 |
| Pro | $499 | $848 | $499 |

These prices are flat recurring subscription starting prices with agreed scope and usage limits; advanced custom work beyond the agreed Pro package is quoted separately. The initial checkout includes the recurring first month plus the existing one-time $349 setup price. Subsequent regular renewals include the recurring plan only.

## Stripe IDs (public identifiers, never secret keys)

- Starter: \`price_1UQWVeQ9mewkKyl5kv85ccXb\` — original active live $99/month
- Growth: \`price_1UaAOfQ9mewkKyl5rXDk02Ff\` — restored active live $249/month
- Pro: \`price_1UaAOiQ9mewkKyl5NubJPt0S\` — restored active live $499/month
- Standard setup: \`price_1UQX1gQ9mewkKyl5QpjCrTyt\` — original active live $349 one-time

All prices are in CAD. Growth/Pro have exclusive tax behavior. The preexisting Starter and setup prices remain configured with unspecified tax behavior. Do not assert that automatic Stripe Tax is collecting taxes until the owner configures their tax registration, addresses and tax settings.

**Existing subscribers:** The previous $219 Growth \`price_1Ua3rFQ9mewkKyl5dIhzjarI\` and $389 Pro \`price_1Ua3rNQ9mewkKyl5TrGGeeQU\` subscriptions still map to the corresponding plan for paid entitlements and are not silently repriced. New checkout sessions use **only** the restored live prices. An existing subscription change requires an explicit customer-approved billing decision and a separately designed proration policy.

## Server checkout and billing behavior

The public endpoint \`/api/billing/public\` queries each actual Stripe Price ID and checks active, CAD, exactly $99/$249/$499 monthly (one-month interval), plus the $349 one-time price. A verified account creates a subscription Checkout Session with server-set line items and no browser-supplied price IDs. Hosted Stripe Checkout handles payment-method collection. A signed Stripe webhook reconciles the actual subscription and grants plan permissions only after Stripe confirms a paid/active subscription. The secure client dashboard provides access to a Stripe Billing Portal link for existing customers; it does not give customers control over Stripe prices.

## Live readiness verification

1. Check \`https://calvren.pages.dev/payment.html\` and the \`/#pricing\` homepage cards for the $99, $249 and $499 subscriptions, and $349 setup terms.
2. Check \`https://calvren.pages.dev/api/billing/public\`: \`ready=true\`, \`test_mode=false\`, all three plans are \`ready=true\`, and amounts are exactly 9900, 24900, and 49900 cents.
3. Confirm new Stripe Checkout requests have the desired recurring Price ID and the $349 one-time setup item; verify the hosted checkout URL uses Stripe's legitimate \`checkout.stripe.com\` origin.
4. Run the automated checkout, signed webhook, billing portal, legacy entitlement, browser, and published-readiness checks. No production credit card charge is required for a smoke test.
5. For complete real-money verification, the owner must approve a controlled live-card payment, renewal/cancellation and refund test. No customer charge or production subscription alteration is made by automated tests.
6. Confirm business tax treatment, refund/cancellation terms, provider setup, onboarding approvals, usage limits and deliverables independently. Successful payment is not evidence that every custom integration is production-ready.
