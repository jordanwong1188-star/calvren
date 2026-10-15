# Calvren customer account launch: email + password

## Simplified customer experience
1. Customer opens the site and chooses Pricing or Client access.
2. Client account page `/client.html` has **Sign in** and **Create account** tabs.
3. New clients choose an email and a strong password (at least 12 characters), then confirm the email once via Supabase Auth.
4. Returning clients sign in with email and password. The verified session persists on the same website for the client dashboard, Stripe Checkout, and onboarding.
5. An unpaid user sees a direct **Continue to secure Stripe checkout** action. Calvren only marks the customer paid from verified Stripe webhook and subscription status, never from the success redirect.
6. The customer can request a password reset through Supabase Auth. On returning from the secure recovery link, they set a new password.
7. Existing magic-link-only clients can choose **Previously used an email sign-in link?** and request a link **only for an existing account** (`shouldCreateUser:false`). After signing in, they can select **Set or change password**. This keeps legitimate previous clients from being locked out.

Never store a password in Calvren's own database or GitHub. Supabase Auth handles password hashing, verification, account email confirmation, rate limiting and session handling. Stripe Checkout handles all card information. A password does not replace verified email ownership; Turnstile mitigates automation and Supabase also offers MFA for stronger account protection.

## Supabase dashboard settings (owner action)
- [Authentication → Providers](https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/providers): keep **Email** enabled and **Confirm email** enabled. Allow password logins and email signup. Never disable email confirmation to hide an email-delivery problem.
- [Authentication → URL Configuration](https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/url-configuration): Site URL `https://calvren.pages.dev`; allow redirect `https://calvren.pages.dev/client` for confirmation, recovery and existing-user one-time migration links. Keep any needed `.html` redirect variations already working.
- [Authentication → Email Templates](https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/templates): **Confirm signup**, **Reset password**, and (for existing clients) **Magic Link** must keep Supabase's `{{ .ConfirmationURL }}` variable. Make the subject read as a Calvren service message. Do not set up a custom sender as `@gmail.com` without ownership/verification. Supabase's default outgoing email service can be restricted; complete a controlled signup and recovery test.
- For existing users, confirm the one-time migration link works and account access is retained. Do not remove the recovery route until migrated.

## Optional free Cloudflare Turnstile (not enabled yet)
Cloudflare Turnstile is available on a free plan and integrates with Supabase Auth CAPTCHA protection.
1. Cloudflare dashboard → **Turnstile** → **Add widget**. Set hostname `calvren.pages.dev` and select Managed/invisible as appropriate. Copy the **sitekey**, which is public, and the **secret**, which must stay private.
2. Add the public sitekey as a meta element in the HEAD of `public/client.html`:
   `<meta name="calvren-turnstile-site-key" content="YOUR_PUBLIC_SITEKEY">`
   The shipped client auth module detects this tag, loads Turnstile only if configured, and passes its captcha token to sign-in, signup, password recovery and existing-user migration. The sitekey is not a secret.
3. **Only once the public widget is deployed and tested**, configure Supabase → Authentication → Security and Protection → **Bot and Abuse Protection** → Turnstile and save the private secret key. Supabase validates the tokens. Do not post the secret key publicly.
4. Test signup, login, reset, and existing-user one-time link with the widget. If token verification fails, undo the new CAPTCHA enforcement setting; users must not be permanently locked out.

Turnstile is not active until both sides are configured. A sitekey alone or a decorative checkbox offers no protection.

Official guide: https://supabase.com/docs/guides/auth/auth-captcha

## Stripe live readiness
Calvren accepts either **`sk_live_`** or the safer restricted **`rk_live_`** API key under the server secret **`STRIPE_SECRET_KEY`**, but a restricted key must be granted the operations that Calvren actually performs:
- Read Stripe prices (`GET /v1/prices/{id}`).
- Create Checkout sessions (`POST /v1/checkout/sessions`).
- Retrieve subscriptions (`GET /v1/subscriptions/{id}`).
- Create billing portal sessions (`POST /v1/billing_portal/sessions`).

Ensure the separately configured **`STRIPE_WEBHOOK_SECRET`** corresponds to Calvren's enabled endpoint and starts `whsec_`. Never paste either value in GitHub, chat, source files or a browser.

Pricing is CA$349 one-time setup plus CA$99 monthly, before applicable taxes/discounts, verified through the server; do not hardcode a fake payment URL or reveal hidden Checkout when the server responds `ready:false`.

### Launch verification checklist
- Create a fresh password account. Confirm the link returns to Calvren and the client can sign in again.
- Request a password reset, follow it, change the password, and verify the old password no longer works.
- Migrate an existing magic-link user and verify password login and billing data.
- Confirm on `/client.html` that an unpaid user sees a **secure Checkout** action without redirect loops.
- Confirm `/payment.html` hides checkout until authenticated and backend-ready; verify no hardcoded Stripe session URLs.
- Validate price, currency, promotion codes and tax disclosures on the live hosted Stripe page, **without completing an actual charge**.
- In Stripe test mode (isolated test keys, test prices and test webhook secrets), complete a controlled payment and check signed webhook processing, the corresponding `calvren_billing_memberships` record, new paid client dashboard and onboarding access, and cancellation updates. Do not mix test secrets with live.
- For a live end-to-end test, use a legitimately authorized small transaction and refund if appropriate, after fees/taxes and billing implications are understood. No automated test or unpaid Checkout preview proves a completed live payment works.

The UI and scripted CI can verify flow wiring but **cannot guarantee that payment links work 100% or that SMTP/Stripe live provider delivery succeeds** without those controlled real-world tests.
