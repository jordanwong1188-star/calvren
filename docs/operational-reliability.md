# Calvren client reliability and owner operations

## Main changes
- Public audit forms attempt to save to Calvren's protected private inbox first. A confirmed 201 response triggers the thanks page and a service-related notification where Resend is configured. If the backend fails with 5xx or times out, Formspree is the fallback. A 4xx/429 must not be bypassed. Without JavaScript, Formspree remains the form action.
- Core form fields: name, business, email, biggest challenge and a short message, with informed contact permission. Phone and industry are optional. A provided phone is only for the requested enquiry, not marketing.
- The owner dashboard includes aggregate counts of failed/unknown sends (last seven days), linked paid clients, client handoffs needing review and onboarding progress.
- The GitHub Actions operations-health workflow calls a protected endpoint every two hours and fails on recorded failed/unknown outbound attempts. Notifications depend on account GitHub Actions settings. Never automatically retry an unknown delivery: it may have gone through.
- Client dashboard distinguishes subscription, onboarding and live automation status.
- Fixes stale payment verification and retired links.

## Important limits
This is not a full external-provider monitoring system or guaranteed uptime. Supabase counts only events recorded by Calvren. A Formspree fallback receipt does not automatically enter the private Supabase inbox; review the Formspree backup account when relevant. GitHub Action monitor requires the existing CALVREN_CRON_TOKEN secret in both GitHub and Supabase. If missing, the scheduled job reports it is disabled; verify coverage manually.

Do not advertise support@calvren.ca or guaranteed response times until an actual mailbox and operations process are verified. Support currently uses Calvren's published phone and email.

## Validation
Run npm run check and both browser suites. Test confirmed backend receipt, Formspree fallback when backend unavailable, and no 429/validation bypass. Verify Supabase snapshot RPC execute privilege is service-role only. Check owner-only endpoints for unauthenticated rejection. Review deployed Cloudflare and Supabase code. Confirm existing Stripe prices and plans have not changed.
