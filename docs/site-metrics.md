# Calvren first-party website activity (November 2026)

## What it does
Counts observed marketing-page loads, free-audit button clicks and successful Formspree receipts, demo openings/starts/simulated bookings, pricing-section views, plan clicks and estimator interactions. The private **/admin.html** workspace shows the latest 30 days after owner authentication.

Counters are grouped by UTC day, an allowlisted event name and an allowlisted public page path. They **do not** contain full URLs, UTM parameters, IPs, visitor identifiers, device fingerprints, names, email addresses, message text or prices entered into the calculator. No analytics cookies, ad trackers or third-party analytics scripts are used. The browser honours Do Not Track and Global Privacy Control. Cloudflare/Supabase may still process normal HTTP request metadata as part of hosting.

These are **event counts, not unique users**, and may be affected by reloads, blockers, bots, browser privacy settings and network availability. Do not present the counts as attributable leads or verified sales. Success on the Formspree endpoint is a receipt, not guaranteed delivery.

## Access and architecture
- The public JavaScript posts only two fixed strings to POST /api/metrics/event on Calvren's own origin.
- The Supabase Edge Function checks Origin, Sec-Fetch-Site, type, size and exact allowlists before calling a service-role-only, security-invoker database function that atomically increments aggregate daily counters.
- The metrics table has RLS enabled and **no anon/authenticated policies or grants**. The RPC is not executable by them.
- GET /api/metrics/summary requires the existing Calvren owner token. Nothing is public-facing in the dashboard.
- A metric outage never blocks lead forms, demo use or subscription checkout.

## Validation and maintenance
Run npm run check, tests/site-metrics.test.mjs, the live read-only audit, and verify the owner dashboard with an authorized token. Inspect the database aggregate table without recording real visitor data. Monitor API request volume and abuse; Origin alone does not authenticate clients and counts are directional.
