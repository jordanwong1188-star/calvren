# Calvren Lead Conversion MVP

The original static marketing site and Netlify Forms remain intact. The reusable engine is in `src/conversion/`; server integration adapters and API handlers are in `netlify/lib/`. Netlify Functions keep credentials off the browser. A dedicated Supabase database persists client configuration, leads, messages, appointments and notifications.

## What runs without accounts

Run `npm install`, then `npm run dev`. Open `http://localhost:8888/lead-demo.html`.

The public demo runs the same engine in the browser with simulated AI, messaging, calendar and notifications. It needs no API key, never sends a real message, and never reserves a real appointment. Its replies are a rules-based simulation; live clients use OpenAI. Demo history is local to the demo session, rather than a production customer database.

1. Choose ABC Plumbing and start a fake lead with “Hi, my kitchen sink is leaking and I need someone to look at it.”
2. Answer the qualifying questions one at a time. Use a routine request, an area such as Vancouver, and a preferred service time.
3. Watch the recorded answers and lead status change.
4. Choose one of the offered appointment times.
5. Inspect the booked appointment, logged business notification and full conversation.
6. Reset the demo for another pitch. You can also test a request for a human or STOP to see automation pause.

The operator page is `/operator.html`. It requires your admin token and a configured Supabase database to manage persistent clients and leads. Without a database its setup panel reports what is missing. The existing `/admin.html` marketing enquiry inbox remains separate.

## Set up persistent storage

Create a **dedicated Calvren Supabase project**. Existing unrelated projects are not used.

Run [the migration](../supabase/migrations/202610030001_calvren_conversion.sql) in that project's SQL editor. It enables RLS and denies browser roles access to the automation tables and RPCs. Only the server's privileged Supabase key can operate this MVP; this is a single-operator tool, without customer logins.

Put the project's URL in `SUPABASE_URL`, and its server secret key in `SUPABASE_SECRET_KEY`. A current `sb_secret_` key is supported; a legacy service-role JWT can also be used in that same variable. Never use either key in public HTML or JavaScript.

## Credentials and activation

For local development, copy `.env.example` to `.env` at the repository root and fill in the values. `.env` is ignored by Git. Netlify Dev reads it for functions.

For hosting, use [Calvren's Netlify project](https://app.netlify.com/projects/calvren) → **Environment variables**. Set server secrets with **Functions** scope and the **Production** context, then trigger a redeploy. No frontend secret variables are required.

| Variable | Where to get the value / purpose |
| --- | --- |
| `CALVREN_ADMIN_TOKEN` | A long random token, for example generated with `openssl rand -hex 32`. Use it to unlock the operator page. Keep it in your password manager. |
| `CALVREN_AUTOMATION_MODE` | Keep `demo` during setup. Set `live` only after the customer is configured and tested. |
| `CALVREN_PUBLIC_URL` | The public HTTPS origin, currently `https://calvren.netlify.app`; it must match the URLs configured in Twilio exactly. |
| `SUPABASE_URL` | The dedicated project's API URL. |
| `SUPABASE_SECRET_KEY` | That project's server secret key or legacy service-role key. |
| `OPENAI_API_KEY` | OpenAI project API key with API billing enabled. |
| `OPENAI_MODEL` | A model that supports Responses API structured output; default `gpt-4o-mini`. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio account credentials. |
| `TWILIO_PHONE_NUMBER` | Optional default sending number; the client's configuration should specify its dedicated Twilio number. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Google Cloud service account with Calendar API enabled. Share each business calendar with this email with permission to make changes. |
| `RESEND_API_KEY` / `NOTIFICATION_FROM_EMAIL` | Resend API key and a sender on your verified domain, for live business notifications. |
| `CALVREN_DATA_ENV` | Keep `production` for the existing marketing enquiry inbox. This guard is separate from the new automation mode. |

Google uses the Calendar `calendar.events` and `calendar.freebusy` scopes. The MVP creates events on a shared calendar and sends confirmations through SMS; it does not add Google event attendees. Each client's calendar ID, hours, duration and booking rules belong in their configuration.

Twilio inbound SMS webhook: `https://calvren.netlify.app/api/conversion/twilio/inbound` (**POST**). The adapter generates each delivery status callback as `https://calvren.netlify.app/api/conversion/twilio/status?message_id=<stored-message-id>` (**POST**); do not replace it with a static callback without that query. Configure the inbound URL exactly; request signatures are checked against the configured public origin. The number must support two-way SMS and meet the registration requirements applicable to your business and region. Test using an explicitly consenting recipient you control.

Live operation requires a production Netlify deployment, explicit global `live` mode, an active client in `live` mode, persistent storage and all live provider credentials. Deployment previews cannot send live customer messages.

## Onboard a customer

1. Open the operator page and create a client using the demo configuration as a starting point.
2. Give the client a unique ID. Fill in their business name, description, services, contact details, timezone and business hours.
3. Set qualifying questions with stable IDs and required flags. Add tone, AI instructions, service areas and booking rules.
4. Configure the customer's dedicated Twilio number and shared Google calendar. Set appointment length, booking horizon and buffer.
5. Configure notification email, follow-up delays in minutes and a maximum attempt count. Default demo timings are 2 hours, 24 hours and 48 hours; stop after 3 follow-ups.
6. Test in demo mode. Confirm that the qualification and handoff rules fit the business, including an emergency and a request for a person.
7. Create/rotate the client's intake key. Keep it on the customer's server or automation tool; never embed it in a public form or JavaScript bundle.
8. Connect that server's website submission handler to `POST /api/leads` or `POST /api/conversion/leads`. Send the configured production client ID and authenticated intake key, a unique idempotency key, lead details, `channel: "sms"` and `consent_sms: true` after collecting explicit consent. A website submission starts the SMS conversation; live website chat is outside this MVP.
9. Confirm all production credentials and the database migration. Create a separate production copy with a new client ID, `mode: "live"`, `calendar.provider: "google"` and the customer's dedicated number. Client ID and mode are immutable. Set global `CALVREN_AUTOMATION_MODE=live` and verify the number, hours and calendar before the first real test.
10. Run a consenting end-to-end test, inspect SMS delivery, the real calendar event and notification email, then start accepting customer leads. Agree who responds to handoffs and how quickly.

Changing configuration reuses the engine; it does not require rebuilding the automation. Client ID and demo/live mode are immutable. Create a production configuration copy rather than converting demo leads into live leads.

## Human handoff and follow-up

A human request, SMS STOP, a sensitive or emergency request, unsupported work, uncertainty or a provider failure pauses automation and clears future follow-ups. A recorded handoff tells the business what needs attention. The operator can resume an eligible lead deliberately; an opted-out lead is not automatically resumed by START.

The scheduled Netlify function runs every five minutes in production and processes a bounded number of overdue leads. It respects client configuration, business hours, consent, maximum attempts and human handoff. Follow-up times are stored in UTC; business-hour calculations use the client's IANA timezone. The five-minute tick is suitable for initial clients, not a high-volume queue.

## Checks and limits

`npm run build` performs TypeScript checking, meaningful unit tests and builds the browser demo from shared source. `npm run test:conversion` runs the conversion tests. GitHub Actions additionally packages the Netlify functions and runs Chromium against the demo, operator workspace and existing marketing pages.

The migration and external integrations must be tested against your dedicated accounts before taking real client traffic. GitHub Actions also applies the migration and exercises transactional RPCs in a disposable PostgreSQL database. Mock tests verify application behavior and provider request formats; they do not verify billing, sender registration, credentials or actual provider delivery. SMS provider timeouts can be ambiguous: automation pauses for review rather than blindly sending the same text again.

Store only information needed to qualify and book. Confirm the customer's privacy notice, consent wording, record retention and handoff owner as part of onboarding. This MVP has no public client login, invoicing or automatic customer account provisioning.

## Later, after the first clients

Add client logins and role permissions, email conversation intake, customer-facing chat, OAuth self-service calendar connection, CRM sync, richer qualification criteria, retention/deletion controls for customer records, a higher-volume job queue, reporting and billing when they become necessary.
