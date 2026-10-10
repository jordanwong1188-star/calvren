# Instant demo access and optional introduction

The public website captures an email with POST /api/demo-access and then displays an Open the demo link. No Supabase Auth account or magic link is created. Emails are unverified. This is a browser gate for an illustrative simulation, not authorization for client data or an operator account. A tab-local access marker expires after 24 hours.

Storage: calvren_private_records keys demo-signups/<id>. Each record stores the email, signup timestamps, explicit promotional consent, consent timestamp, send state and an unsubscribe token hash. Only the server/service role can read or write; RLS and existing database grants are unchanged. Owner can inspect/delete signup records in Supabase's table editor. Deleting a record also removes its suppression history; keep an unsubscribed marker if needed to preserve the opt-out.

The optional promotional checkbox is unchecked by default. A selected checkbox requests one promotional introduction, not a recurring subscription. It has fixed content, contact details, a link to the demo, a business mailing-address footer and a token-protected unsubscribe link. GET displays confirmation; POST confirms the opt-out (also supports List-Unsubscribe one-click). Unsubscribed addresses are not re-enrolled through this form.

## Email delivery
Set these in Supabase Dashboard → Edge Functions → Secrets:
- RESEND_API_KEY: an API key from the owner's Resend account.
- NOTIFICATION_FROM_EMAIL: a sender on a domain verified in Resend.
- CALVREN_BUSINESS_ADDRESS: the owner's real business mailing address, included in the footer.
- CALVREN_PUBLIC_URL=https://calvren.pages.dev (or the final production domain).

No sender secrets belong in Cloudflare/frontend variables. Supabase Auth SMTP and redirect settings are not required by this new demo flow. These Resend credentials are also used by configured business notifications.

Requests without consent never call Resend. Missing sender/address settings, provider failure or timeout never block demo access. A compare-and-swap reserves one send, and Resend receives a stable Idempotency-Key. Repeated submissions do not resend. If an earlier request was unavailable because configuration was missing, a later explicit opted-in submission may send once configuration is complete. Failed/uncertain attempts are not automatically retried. A provider-accepted result does not prove inbox delivery.

The public signup has bounded JSON validation, a honeypot and hashed global/IP/email rate limits. The form allows three submissions per email per day, ten per IP per hour, and thirty total per hour as first-client MVP limits. Direct backend headers can be spoofed, so global and recipient limits are enforced independently.

## Test
1. Click Test the full demo on the landing page.
2. Enter a test email with the promotional checkbox off.
3. Submit. Open the demo appears immediately on the same page; click it.
4. Clear demo access; submit another test email with the promotional checkbox on.
5. With email configured, inspect the received introduction and test unsubscribe.
6. Submit the same address again and verify there is no second email. A previously opted-out address remains opted out.
7. With email settings absent, the demo still opens and the UI reports the introductory email is unavailable.
8. Verify /operator and /admin still require their separate strong operator token.

Apply supabase/migrations/202610090002_calvren_demo_signup.sql before deploying the updated backend.

The live verification workflow uses an example.com test address with promotional consent off. Its private signup record is identifiable by the calvren-probe- prefix; it is a test fixture, not a customer or marketing recipient. Remove that fixture through the Supabase table editor if desired.
