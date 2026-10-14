# Calvren Stripe subscriptions — production handoff

## Approved prices (CAD)
- One-time setup and onboarding: **CA$349**, Stripe price `price_1UQX1gQ9mewkKyl5QpjCrTyt` (product `prod_VRPKQiNjWCDDPh`).
- Ongoing updates and maintenance: **CA$99/month**, Stripe price `price_1UQWVeQ9mewkKyl5kv85ccXb` (product `prod_VRPEflqPI2JCAT`).
- First Checkout session includes both prices, total **CA$448 before applicable taxes**.
- Optional owner-negotiated code: **Calvren15%** (typed into Calvren's /payment page). Stripe codes cannot contain `%`, so the backend maps that alias to Stripe code `CALVREN15`, backed by coupon `tlQfQM4u` (15% discount with `duration=once`). Initial invoice **CA$380.80 before tax** after applying the code; renewals remain **CA$99/month before tax**. Stripe promotion ID `promo_1UQX7IQ9mewkKyl5lR0GMbi4`. Anyone given the shared code can redeem it; create customer-specific promotion codes later if needed. Stripe creates only the monthly recurring subscription item; subsequent invoices do not include the setup fee. A wholly new checkout for a canceled/restarting subscriber currently includes setup again; handle exceptions individually.

## Security model
1. `/payment` serves the client login and price details; Stripe-hosted Checkout collects card details.
2. Supabase Auth verifies the customer email via a passwordless sign-in link. Redirect URLs should include `https://calvren.pages.dev/client.html`.
3. Client access is granted only by **Stripe signed subscription webhook events**. Successful checkout redirects alone do not mark customers paid.
4. The private membership table `calvren_billing_memberships` has RLS enabled and no customer-facing policies. Only the server's secret-key API can read it.
5. Customer access is scoped by authenticated user ID and assigned client ID. Payment grants membership, **not** a raw Calvren operator credential and not automatic live messaging.
6. Each customer is assigned a Calvren client record after supervised onboarding. Never share operator credentials.

## REQUIRED secrets — do not put keys in chat, GitHub, or public assets

Go to Supabase project `xjfsukhfmkgvlfpgjevg` → Edge Functions → Secrets. Set:
- `STRIPE_SECRET_KEY`: **newly rotated** Stripe restricted key (`rk_test_...` for testing, `rk_live_...` for production) for the Calvren account. Give it only minimum necessary permissions to read Prices, Subscriptions and Promotion Codes and create Checkout Sessions and Billing Portal Sessions. Verify exact permissions in Stripe before accepting payments. Enter it directly in Supabase Edge Functions → Secrets; NEVER share it in chat, source code, or website assets. The Stripe ChatGPT connector requires no manual API key.
- `STRIPE_PRICE_ID`: `price_1UQWVeQ9mewkKyl5kv85ccXb`
- `STRIPE_SETUP_PRICE_ID`: `price_1UQX1gQ9mewkKyl5QpjCrTyt`
- `STRIPE_WEBHOOK_SECRET`: signing secret from the Calvren Stripe webhook endpoint (`whsec_...`), **not** an API key
- `CALVREN_PUBLIC_URL`: `https://calvren.pages.dev`

Stripe Developers → Webhooks → Add endpoint:
- URL: `https://calvren.pages.dev/api/billing/webhook`
- Listen for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`
- Select account events, not connected-account events
- Use production events **only after a complete test mode rehearsal**.

Stripe Settings → Billing → Customer portal: activate it for subscription management, including cancellation if offered under your agreements. Check payment method updates and invoices. Set a business statement descriptor and determine tax registrations/collection rules before charging.

Supabase Dashboard → Authentication → URL Configuration: add `https://calvren.pages.dev/client.html` as an allowed redirect URL. Make sure passwordless email sign-in delivers to real customer addresses; built-in SMTP may be limited. This is separate from marketing forms in Formspree.

## Test checklist before accepting money
- Use Stripe **test keys and test prices** in a separate test setup. Do not mix test keys with the live price IDs above.
- Open `/payment`; sign in with a test email; verify no customer records leak from a different account.
- Complete a test subscription: confirm the first invoice includes setup and monthly plan exactly once, that the next invoice is monthly only, and that failed/expired payment does not grant access.
- Check signed webhook delivery, duplicate events, cancellation, subscription updates, portal and passwordless email redirect.
- Confirm that a subscription creates a membership but shows setup pending until onboarding is completed.
- After real checkout is verified, switch to production keys and correct live prices and webhook signing secret on the server. Never enable checkout without verifying all four values.

**Do not treat successful GitHub deploy or a Stripe product as proof of live card acceptance.** The backend intentionally hides Checkout while mandatory server secrets are absent.
