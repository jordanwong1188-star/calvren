# Demo email accounts
The homepage retains its public quick preview. Hero and full-demo invitation links open an accessible native dialog. /try-demo.html provides a direct signup link and email-link callback. /lead-demo.html initializes its browser-only simulation only after Supabase Auth verifies a confirmed user.
The public Supabase project URL and publishable key in public/demo-access.js are intentionally browser safe. No service-role, OpenAI, Twilio, operator, or calendar credentials are used for visitor sign-in. Existing table/RPC security continues to deny anon and authenticated visitors access to business data. This static-page access gate is for the illustrative simulation, not authorization for private data.

## Required Supabase dashboard configuration
1. Authentication → URL Configuration: set Site URL to https://calvren.netlify.app and add the exact redirect URL https://calvren.netlify.app/try-demo.html to Redirect URLs. Avoid wildcard redirect entries.
2. Authentication → Sign In / Providers: enable Email sign-in and new-user signup. Keep email confirmation enabled.
3. Authentication → Email / SMTP Settings: connect a verified sender with custom SMTP before inviting external customers. Supabase's default sender restricts recipients to project-team emails and is not suitable for public signup. Use an SMTP provider you control; SMTP passwords belong only in Supabase settings.
4. Keep the default Magic Link template using {{ .ConfirmationURL }} so the emailed link verifies the account before returning to Calvren.
5. Test with a non-owner email: request link, verify inbox arrival, open it, confirm full demo unlocks; sign out and confirm direct demo navigation returns to signup. Repeat on mobile. Dashboard → Authentication → Users shows registered accounts.
6. Review Authentication rate limits, optionally configure CAPTCHA before promoting widely (CAPTCHA integration requires an additional frontend challenge).

## Scope and behavior
No passwords, payment details, automatic marketing consent, or operator access. Tokens live in sessionStorage only for the current tab until their expiry; the fragment is cleared before rendering callback content and a no-referrer policy is used on the callback page. Signing out clears local access before attempting provider logout. Each initial load verifies the session with Supabase instead of trusting a browser flag. No external provider deliveries happen in the demo.

## Checks
Browser tests mock only Supabase Auth, exercise signed-out redirect, modal open/close, OTP request, verified email callback, rejected identity, sign-out, and the full existing demonstration. A successful mocked test does not certify real SMTP delivery. Complete step 5 before advertising email account access.
