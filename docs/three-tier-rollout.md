# Calvren Starter / Growth / Pro rollout

Updated November 9, 2026. These changes are on a review branch, not deployed production.

## Pricing (CAD; taxes extra if applicable)
- **Starter**: $99/month with a $349 one-time setup fee. Lead response and booking.
- **Growth**: $249/month with the same standard $349 setup fee. Starter plus follow-up sequences, review requests, and monthly reporting.
- **Pro**: starting at $499/month, custom setup and scope. Custom integrations, advanced workflows, unified inbox, extra support. Pro is quote-only, not self-serve checkout.

## Already implemented in this branch
- Public comparison cards on home and payment pages, plus safe plan selection.
- Checkout plan IDs chosen server-side, with Stripe verification of CAD amount, one-month interval and active price.
- Signed webhook matching of configured Stripe subscription price IDs; plan feature list is derived from paid membership, not browser input.
- Existing $99 recurring price and $349 setup price are unchanged; no schema migration is required.
- Client dashboard labels plan inclusion, clearly separate from live activation.
- A read-only, tenant-scoped current-month summary is implemented for paid Growth / Pro clients. It reports lead and booked-appointment counts but does **not** automatically email a monthly report; it uses a capped query and indicates partial results if the record volume exceeds that cap.
- Growth's checkout is disabled until a correct verified recurring Growth price is installed.
- Pro requests a proposal; it cannot accidentally create a $499 subscription.

## Required before accepting Growth/Pro payments or promising full functionality
1. Confirm whether Calvren is registered to collect GST/PST or uses Stripe Tax. Current existing Stripe prices have tax_behavior=unspecified; check tax setup before adding live prices.
2. Create a CAD $249/month recurring Growth price in Calvren's Stripe account, confirm tax behavior, then set `STRIPE_GROWTH_PRICE_ID` in Supabase Edge Function Secrets. Do not put secret keys in the website.
3. Test Starter and Growth subscriptions, Stripe signed webhooks, cancellation, refunds, proration, client isolation, and email onboarding with test-mode fixtures before allowing new charges.
4. Implement and test the production review-request scheduler and scheduled monthly report delivery. A read-only monthly summary is present; email delivery and historical snapshotting are not. The underlying follow-up engine already exists, but it needs plan-scoped execution rules. These modules are not activated by checkout alone.
5. Implement and secure the unified inbox and advanced integrations. Pro remains a tailored quote, not an immediately provisioned product.
6. Agree usage limits (messages, AI calls), additional support response time, and setup fee exceptions in customer contracts.

## Security and operational model
Do not authorize tiers from query strings or frontend state. Stripe signed events confirm paid entitlements. Customers are scoped to a server-linked client ID. A paid tier is not permission to send communications without consent; review requests must comply with Google Business Profile policies, and SMS follow-ups with applicable Canadian anti-spam requirements.
