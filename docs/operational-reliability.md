# Calvren client reliability and owner operations

## Main changes
- Public audit forms attempt to save to Calvren's protected private inbox first. A confirmed 201 response triggers the thanks page and a service-related notification where Resend is configured. If the backend fails with 5xx or times out, Formspree is the fallback. A 4xx/429 must not be bypassed. Without JavaScript, Formspree remains the form action.
- Core form fields: name, business, email, biggest challenge and a short message, with informed contact permission. Phone and industry are optional. A provided phone is only for the requested enquiry, not marketing.
- The owner dashboard includes aggregate counts of failed/unknown sends (last seven days), linked paid clients, client handoffs needing review and onboarding progress.
- Supabase's native signed cron (stored in Vault) is the production scheduler. A new server-only execution heartbeat records when the backend *actually* ran, whether it succeeded and aggregate counts. The owner workspace shows recent-success or overdue states without exposing customer data.
- The duplicate GitHub customer-sending schedules are disabled to avoid redundant dispatches; their workflows remain available only for deliberate manual fallback. An unconfigured token causes a manual run to fail rather than show a false success.
- GitHub's two-hour monitor tests the public API without a secret. If the optional CALVREN_CRON_TOKEN is configured, it also reads protected delivery counts and reports recorded failures. No automatic resend occurs for uncertain deliveries.
- Client dashboard distinguishes subscription, onboarding and live automation status.
- Fixes stale payment verification and retired links.

## Important limits
This is not a full external-provider monitoring system or guaranteed uptime. Supabase counts only events recorded by Calvren. A Formspree fallback receipt does not automatically enter the private Supabase inbox; review the Formspree backup account when relevant. The native Supabase jobs already have their own Vault signing secret, independent of GitHub Actions. GitHub's optional private checks require CALVREN_CRON_TOKEN and only run when configured. Without it, GitHub verifies API reachability, not customer delivery health. The owner workspace continues to show private server-side counts.

Do not advertise support@calvren.ca or guaranteed response times until an actual mailbox and operations process are verified. Support currently uses Calvren's published phone and email.

## Validation
Run npm run check and both browser suites. Test confirmed backend receipt, Formspree fallback when backend unavailable, and no 429/validation bypass. Verify Supabase snapshot RPC execute privilege is service-role only. Check owner-only endpoints for unauthenticated rejection. Review deployed Cloudflare and Supabase code. Confirm existing Stripe prices and plans have not changed.
