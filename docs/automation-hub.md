# Growth and Pro production automation hub
Updated 2026-11-10.

## What is implemented

**Growth ($249/mo):**
- The original guarded AI lead response/booking workflow.
- Scheduled lead follow-ups are authorized **only** for linked, active, approved live Growth/Pro clients.
- A secure client dashboard switch for **neutral Google Business review invitations** and a validated Google review URL.
- Explicit `consent_review: true` is captured at lead intake only when a customer separately opts in. An SMS consent checkbox does **not** imply review-email consent. Existing leads without recorded permission cannot be auto-solicited.
- A client confirms the appointment was genuinely completed in the dashboard. At least 24h later, the daily scheduler sends at most one review invitation via Resend, including an expiring signed opt-out link. No rewards, rating gating, suppression of negative reviews, or incentives.
- Opt-outs are stored as tenant-scoped SHA-256 hashes and respected before any future review invitation.
- A monthly report email with new-lead, qualified-lead and booked-appointment totals; sent during days 1–7 for the previous UTC calendar month. If an account has over 1000 leads/appointments, automated sending pauses rather than sending an inaccurate partial report.
- Per-client switches default to **off** until activated by an authorized, linked, live customer.

**Pro ($499/mo):**
- All Growth features.
- Tenant-isolated unified conversation inbox combining recorded website/SMS/email-channel lead messages, statuses and appointment activity.
- Internal notes linked to a conversation and the authorized signed-in user.
- Human-reviewed SMS replies through existing live Twilio numbers only if a lead has explicit SMS consent, has not opted out, the business is launched, the Twilio provider is configured, and the operator confirms the send. Rate limit 5 replies per lead/hour. Unexpected/ambiguous delivery never triggers an automatic retry.
- Optional human-handoff notification emails via Resend.
- Owner-approved signed outbound HTTPS webhooks for bookings or required human handoffs. Integration payloads only include tenant/lead IDs, status, time, and event (no contact name/email/phone). HMAC headers can be verified by the approved receiving system. Connector is disabled until both the owner-approved endpoint and signing secret exist.

## Setup requirements
1. Apply the migration `supabase/migrations/202611100001_growth_pro_automation_hub.sql` in the existing Supabase project, and deploy the newest `calvren` function after the build passes.
2. The existing `CALVREN_CRON_TOKEN` must match GitHub Actions and Supabase server secrets. The new GitHub workflow `growth-pro-automation.yml` runs once daily at 13:19 UTC. It calls `/api/internal/hub-scheduler` with that token. The existing follow-up worker now checks paid Growth/Pro eligibility before messaging.
3. Configure `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` (a verified sending domain) in Supabase Edge Function secrets, or outgoing review/report/handoff emails will fail safely. Test to an owned consented inbox before enabling real delivery.
4. Calvren must link a **paid Growth/Pro subscriber** to their **live** client ID and finish the existing onboarding launch approval. No customer action can bypass that approval.
5. Client signs in at `/client.html`, enables their module settings, and supplies their genuine Google Business review link. Customer form intake should provide an **unchecked** separate opt-in for post-service review-email requests; send `consent_review: true` only if ticked. The consent is persisted in the lead on first intake.
6. Client manually confirms completed appointments in the dashboard. Do not confirm canceled, disputed or unperformed work just to trigger an invitation.
7. For Pro automation platform integrations, the owner configures **`CALVREN_INTEGRATION_ALLOWED_HOSTS`** (comma-separated exact hostnames) and **`CALVREN_INTEGRATION_SECRET`** (random 32+ byte secret) securely in Supabase. With the existing owner operator token, the owner POSTs an approved endpoint using:
   `POST /api/internal/hub/integration` with JSON `{"client_id":"approved_live_client","enabled":true,"url":"https://approved-provider.example/webhook"}`. The hostname must exactly match the owner-configured allowlist. This is an authorized owner-only action; it is not possible from the public website.
8. The review unsubscribe signer uses `CALVREN_REVIEW_UNSUB_SECRET` if configured, otherwise a domain-separated HMAC from the existing protected Stripe webhook signing secret. Do not rotate the signing secret without considering outstanding opt-out links.

## Guardrails / operational notes
- Subscription payment alone does **not** enable live customer messaging. Billing entitlements, tenant assignment, approved onboarding, consent and module switches are checked independently.
- Cron processes no more than 20 outgoing actions per run, uses a unique delivery ledger and Resend idempotency keys, and marks ambiguous provider results as **unknown** instead of automatically retrying.
- A client report contains **only counts**. A review invitation includes a signed unsubscribe link and the review URL but never shares a lead's details with a third-party integration webhook.
- The inbox currently consolidates conversations recorded by Calvren. It is **not** an OAuth inbox that syncs every external Gmail, WhatsApp, Instagram or HubSpot message. Those services require customer-specific OAuth permissions and separate integrations.
- Cloudflare and the codebase cannot verify customer-owned Twilio/Calendar or Resend provider credentials without a controlled authorized test. No real customer data or messages should be used in automated CI tests.
- Before selling Pro as fully custom, agree exact supported integrations, support hours, usage caps and delivery milestones in the signed client scope. Integration-specific adapters depend on each paying client's access credentials.
- This module does not create automated favorable Google reviews: see the Google Business Profile fake engagement and rating manipulation policies.
- Tenant tables are service-role-only, RLS enabled, with no public table policies. Do not add a browser service_role key.

## Monitoring
Review the scheduled GitHub Actions results and `calvren_hub_deliveries` entries with `status='failed'` or `status='unknown'`. The scheduler exits nonzero for rejected/unknown sends and never silently retries uncertain outcomes. Consider adding an owner-facing retry/remediation console when real customer volume increases.
