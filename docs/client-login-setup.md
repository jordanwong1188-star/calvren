# Calvren client email sign-in — production setup

Calvren's `/client` and `/payment` pages use Supabase Auth `signInWithOtp` and passwordless magic-link email authentication. The browser supplies a **public** Supabase publishable key; it never has a secret/service-role key.

## Required Supabase Dashboard configuration

Project: `xjfsukhfmkgvlfpgjevg`.

1. Open **Authentication → URL Configuration**: https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/url-configuration
2. Set **Site URL** to `https://calvren.pages.dev`, replacing `http://localhost:3000`. Save it.
3. Add **Redirect URL** `https://calvren.pages.dev/client.html` EXACTLY, with scheme and `.html`, as an allowed destination. Save it. The website always requests this address.
4. Confirm **Authentication → Providers → Email** is enabled.
5. Open **Authentication → SMTP Settings**: https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/smtp and configure a **custom SMTP provider** with a verified sender domain. The built-in sender is not suitable for real customer email; by default it sends only to addresses authorized on the Supabase organization's team. Set the SMTP host, port, username, password, sender email/name and enable custom SMTP. Do not store SMTP secrets in the GitHub repo or client JavaScript.
6. Optional: configure **Authentication → Email Templates → Magic Link** to use Calvren branding. Preserve Supabase's valid `{{ .ConfirmationURL }}` template variable or the official equivalent link so email verification works.

## Verified problem (October 14, 2026)

Supabase Auth logs recorded `POST /auth/v1/otp` with `redirect_to=https://calvren.pages.dev/client.html` and status 200, and a corresponding `mail.send` event from the default Supabase sender. When the link was followed, `GET /auth/v1/verify` redirected to `http://localhost:3000`, demonstrating that the project URL allowlist or default Site URL was misconfigured. Correcting the URL configuration is the necessary dashboard-side fix.

## End-to-end verification — no credit card required

- Open `https://calvren.pages.dev/client` in a private browser window, enter an email authorized to receive sign-in emails and select **Send secure sign-in link**.
- Check inbox/spam. Confirm the email was sent by your configured mail provider.
- Open the link once. It must return to `https://calvren.pages.dev/client.html` and display **Signed in as ...** with your own verified email.
- An authenticated account without a linked verified subscription should show **No subscription** (or setup pending), not other clients' data. Stripe Payment Links do not automatically associate their Checkout customer with this Supabase Auth user. Manual onboarding/verified linking is required until the separate Stripe-webhook reconciliation integration is completed.
- Test once again with a non-team client email address only after SMTP is configured. Monitor Supabase Auth logs for any delivery or redirect errors. Do not copy login links or tokens into logs, tickets or chat.

Supabase docs: https://supabase.com/docs/guides/auth/redirect-urls ; https://supabase.com/docs/guides/auth/auth-smtp ; https://supabase.com/docs/guides/auth/auth-email-passwordless
