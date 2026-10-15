# Calvren — Managed client onboarding

**Implementation status:** feature branch only. Do not merge/deploy before database migration, billing validation and browser tests.

## Client journey

1. Sign in to the Calvren client account by email, then open /payment.html.
2. Use authenticated Stripe Checkout. The server sets the Supabase user ID on Checkout and subscription metadata.
3. Stripe's signed webhook grants an active billing membership. Do not manually interpret redirect success as proof of payment.
4. The client opens /client.html and selects **Start or track onboarding**.
5. Complete the four-page questionnaire:
   - Business details and primary owner
   - Services, lead source, questions, office hours, booking rules
   - Calendar owner and human handoff (no credentials requested)
   - Review and confirm the limited onboarding acknowledgements
6. Save a draft or submit. Submissions cannot be overwritten by the customer unless Calvren reopens the record as needs_details.
7. View implementation milestones and any owner note at /onboarding.html.
8. Access automation activity after Calvren has linked an active live client configuration and tested providers.

## Test the sample in Cloudflare Pages (no payment or backend changes)

- Production remains **https://calvren.pages.dev** on the `main` branch.
- The isolated development branch is `feature/client-onboarding-portal-20261014` (draft PR #1).
- In Cloudflare Dashboard → Workers & Pages → Calvren → Deployments, locate a **Preview** deployment for that branch. Git-linked Cloudflare Pages supports automatic preview builds of non-production branches if branch controls allow them.
- If no deployment exists, go to Settings → Builds → Branch control; allow preview deployment for this branch (or all non-production branches). Confirm build command `npm run build:cloudflare`, build output `public`, and the repository source. Do not change the production branch or merge the PR.
- Click **Visit deployment** and append `/onboarding-preview.html` to the verified Cloudflare preview URL.
- Preview data stays in your browser's `sessionStorage`; no Supabase, Stripe, email, messaging or live customer records are changed. Use the **Restart sample** control to reset.
- The real paid-client `/onboarding.html` flow is not suitable for preview testing until its Supabase migration and authenticated client/server integration are explicitly approved and deployed.

## Owner operating procedure

1. Open /operator.html using your private operator token. Do not share it with clients.
2. Under **Client onboarding**, inspect the questionnaire and confirm the agreed written scope, allowed accounts, usage fees and service level.
3. Mark as **reviewing**; respond to questions or switch to **needs_details** to let the customer revise.
4. Arrange access outside the form using each provider's own account-sharing or authorized setup flows. Never ask for passwords, private service keys or billing logins in the questionnaire.
5. Create a demo configuration from your chosen service template. Verify business hours, weekday time preferences, handoff, follow-up, and STOP.
6. Assign dedicated Twilio number and configure Google Calendar sharing. Configure verified notification email; connect a consent-based lead form using the client intake key on the client's server.
7. Create a separate live client with a unique ID, mode=live and correct calendar/phone. Start inactive where appropriate. Verify the global live gate, real API calls, SMS sender and calendar events before accepting actual leads.
8. Select **building**, then **testing** in the owner queue.
9. Link the subscriber's billing membership to the verified *active live* client by entering that exact ID. The backend refuses demo or inactive configurations. Linking is one-to-one.
10. After written approval and a consenting end-to-end test, mark **live**. Only then tell the customer their automation is running.
11. Check provider charges and agreed support and usage limits each month.

## Deploy and activation checklist

- [ ] Complete a code review; test that the new checkout backend is ready with the *correct* CA$349 setup and CA$99 recurring Stripe prices.
- [ ] Confirm Supabase Auth redirect allowlist covers https://calvren.pages.dev/client (used by the sign-in emails).
- [ ] Ensure the Stripe webhook targets https://calvren.pages.dev/api/billing/webhook and the signed event is actually processed.
- [ ] Apply supabase/migrations/202610140003_calvren_onboarding.sql to the **Calvren** Supabase project only, after the billing membership migration.
- [ ] Verify RLS and grants: no anon/authenticated API access to calvren_onboarding; service access only.
- [ ] Run npm run check and npm run build:cloudflare, plus preview browser tests at mobile and desktop sizes.
- [ ] Test unpaid, expired, paid, unlinked, submitted, revision-needed and live states.
- [ ] Test the owner cannot link a demo client or the same live configuration to two subscriber identities.
- [ ] Verify no public website route or response exposes the operator token, provider secrets or private forms.
- [ ] Merge to main only after approval. Follow Cloudflare / Supabase deployment checks.
- [ ] Confirm marketing site, payment flow and existing client auth still work in production.

## Boundaries

Calvren's onboarding UI collects implementation information; it does not itself connect Google, verify a Twilio number, activate OpenAI or launch a customer automation. The operator performs the approved integration work. Booking, messaging and notification providers must be independently verified.

Questionnaire acknowledgements are **not** a substitute for service terms, a data processing agreement, a signed scope, SMS consent or the client's privacy notice.

Do not switch CALVREN_AUTOMATION_MODE to live for the first customer until every provider is properly configured and a real end-to-end test succeeds.

## Suggested customer welcome message (manual until email delivery is verified)

Subject: Welcome to Calvren — let's set up your automation

Welcome aboard. Your Calvren client workspace is ready.

Please sign in at https://calvren.pages.dev/client.html using the email associated with your subscription. Select **Start or track onboarding** and complete the guided business questionnaire. You can save your answers and return anytime.

After we review your details, we'll arrange a short setup call for account permissions, messaging and calendar integration. You can follow each implementation milestone in your portal. No passwords or API credentials should be entered in the onboarding questionnaire.

If you have questions, reply to this email or reach us at https://calvren.pages.dev/contact.html.

— The Calvren team
