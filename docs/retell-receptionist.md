# Calvren — Retell AI receptionist (no-charge preparation)

**Status:** integration code prepared on a feature branch, not customer-ready until verified and deployed. **Do not purchase a number, start a paid plan, place a live call, or enable call routing during preparation.** Voice minutes, agent simulation, phone numbers and telephony may incur usage charges even when a provider advertises free trial credits.

## Architecture

Calvren's existing Cloudflare Pages website proxies `/api/*` requests to the existing Supabase Edge Function. The new server module `server/receptionist.mts` adds:

- `POST /api/receptionist/inbound`: Retell inbound-call webhook that **rejects** unapproved, unpaid, unconfigured or disabled clients. On approved requests it sets a verified business name and tenant ID, based on server-held number mapping, not caller-controlled metadata.
- `POST /api/receptionist/webhook`: signed Retell `call_started`, `call_ended`, `call_analyzed` events. Writes minimal call status/times; deliberately does **not** store transcripts, recordings, call media, or SMS, and does not trigger a booking, payment or outbound call.
- `GET /api/receptionist/configs`: operator-only list. Also reports whether the signing key exists (never returns it).
- `PUT /api/receptionist/configs/:client_id`: operator-only registration of a **pre-existing active live Calvren client** and that client's **distinct** Retell agent ID and E.164 phone number. Any reconfiguration forces `enabled=false`.
- `POST /api/receptionist/configs/:client_id/activate`: operator-only activation; requires signing key, active linked subscription, an active live business config, and onboarding with client-approved final scope, plus a separately authorized receptionist Stripe price ID in \`RETELL_RECEPTIONIST_PRICE_IDS\`.
- `POST /api/receptionist/configs/:client_id/deactivate`: operator-only kill switch.
- `GET /api/receptionist/configs/:client_id/calls`: operator-only, recent event summaries (IDs, event status and timestamps, not audio or transcripts).

Database: `supabase/migrations/202611220001_calvren_retell_receptionist.sql`. Both private tables use RLS and service-role-only grants. The event-ingestion SQL function handles retries/out-of-order events without going backward in status.

## Zero-charge steps that can be done now

1. Review and complete the **Retell agent-creation widget** for the inactive **Calvren | AI Receptionist Template (Inactive)**. Suggested language: English; tone: professional and conversational. Use an affordable standard voice. Do not attach a phone number or initiate paid test calls.
2. Keep the template in the Retell workspace for future duplication. For actual customers create **one separate agent per client**, with their approved business name, knowledge, actual availability tools and real transfer number. Do not use one public agent with another client's knowledge or credentials.
3. Review this feature branch and its test results. Apply the migration **only to the existing Calvren Supabase project**, then deploy the matching backend and Cloudflare site after review. Nothing in the migration or backend initiates charges.
4. Before a client is eligible for activation, set \`RETELL_RECEPTIONIST_PRICE_IDS\` in Supabase Edge Function Secrets to a comma-separated list of **verified receptionist-specific Stripe price IDs**. Leave it unset during preparation: all voice activations will fail closed. Existing Starter/Growth/Pro payments alone must not unlock the receptionist. Confirm the individual client's signed quote and Stripe subscription first.\n5. Retell Dashboard → API Keys: create/retrieve a server-side key that Retell marks as eligible for webhook verification. Add that key to **Supabase → Edge Functions → Secrets** as `RETELL_WEBHOOK_KEY`. Never put it in a chat, GitHub, Cloudflare frontend environment, or browser. Keep `CALVREN_ADMIN_TOKEN` private.
6. In Retell workspace webhook settings set the **Call Event Webhook URL** to `https://calvren.ca/api/receptionist/webhook`. Turn on call started, ended and analyzed events.
7. Once a client is paid and approved, link their active live Calvren client record to billing, create a separate Retell agent, obtain a phone number or arrange approved forwarding, and set that number's **Inbound Webhook URL** to `https://calvren.ca/api/receptionist/inbound`. Avoid setting a fallback active agent that would bypass the fail-closed inbound webhook if it becomes unavailable.
8. In the private Calvren operator page, use the **AI Receptionist (Retell)** panel to save the live client ID, real Retell agent ID, and verified E.164 number. Or, from a *private operator tool*, issue an owner-token-authenticated PUT request to `/api/receptionist/configs/:client_id` with `{"retell_agent_id":"<real-client-agent-id>","retell_phone_number":"+16045550123"}` (replace the example number with the client's actual verified number). The response is **disabled** until owner activation.
9. Verify written client scope, signed consent/recording notices, call-routing expectations and actual tool behavior. Run controlled end-to-end tests using your own consenting number only after you are prepared for possible usage charges.
10. Once the client approves, POST to `/api/receptionist/configs/:client_id/activate` with your owner token. For cancellation, incident response or provider issues, POST to `/deactivate` and remove live Retell routing too.

## Configure the Retell callback-request custom function (per approved client)

Create a Retell **Custom Function** for each client's agent after the backend is deployed and the client is approved:

- Name: `save_receptionist_lead`
- Method: `POST`
- URL: `https://calvren.ca/api/receptionist/tools/lead`
- **Payload: args only:** OFF (Retell must include the signed `name`, `call` and `args` wrapper).
- Execution: Wait for completion; no automatic retry on ambiguous results.
- Description: "Only after a caller explicitly agrees to a callback and confirms their name, E.164 telephone number and reason, save a callback request. This does NOT book an appointment, send a text or guarantee a callback time."
- Request argument JSON schema:

```json
{
  "type": "object",
  "required": ["caller_name", "callback_number", "enquiry", "callback_consent"],
  "properties": {
    "caller_name": {"type":"string","description":"Caller-provided name, confirmed aloud"},
    "callback_number": {"type":"string","description":"Explicitly provided and confirmed phone number in +16045550123 format"},
    "enquiry": {"type":"string","description":"Brief non-sensitive reason for requesting a human callback"},
    "preferred_time": {"type":"string","description":"Optional preferred callback day/time, not a promise"},
    "callback_consent": {"type":"boolean","description":"True only after caller explicitly agrees to contact about this request"}
  }
}
```

If the tool returns `saved: true`, the callback is recorded for the private operator workspace under **AI Receptionist → View callback requests**. If not, the agent must not claim success. The tool uses Retell's signed call context, not client IDs invented by the model. No SMS, email, phone call or paid AI action is triggered by this API. Additional customer alerting can be scoped later only after a verified, approved sender is in place.

## Important functionality NOT automatically provisioned

- A free Retell account/agent does **not** give Calvren a phone number without an explicit provider action. Retell call minutes and number rental are usage-priced; **none were purchased in this change**.
- This foundation receives and records call events, securely saves consented callback requests and gates activation, but **does not yet implement live calendar booking**, provider OAuth, actual call transfers, external CRM writeback or a Retell dashboard billing limit. Those are per-client integrations that need authorized accounts, client-specific policies and tests.
- Retell's default fallback behaviour can connect an agent if an inbound webhook fails. Configure the number to fail closed and validate this with Retell; code alone cannot guarantee fallback behaviour.
- A Retell agent prompt can *collect* appointment requests but must not claim appointments are booked until a real integration returns confirmation.
- For clinics and care settings, conduct privacy/compliance review and configure no unnecessary recording or sensitive-data retention before handling callers.
- This feature branch has no public checkout changes; existing receptionist remains **custom quote only**. Do not represent the service as activated until actual tests pass.

## Security and verification

- Signatures use Retell's documented `v=<unix-milliseconds>,d=<HMAC-SHA256>` header. Digest is calculated over the **raw body plus timestamp**, compared in constant time and rejected if older/newer than five minutes.
- Client IDs come from private configured number-and-agent mappings, never from untrusted Retell metadata.
- Calls are stored without transcripts and recordings. Only the owner token can inspect the recent call summaries.
- Launch depends on Stripe-verified entitlement plus client approval, separate from Retell agent existence.
- Local test file: `tests/receptionist-bridge.test.mjs`; project checks: `npm run check`, `npm run build:supabase`, `npm run build:cloudflare`. Inspect deployment and security results before merge.

Retell documentation: https://docs.retellai.com/features/secure-webhook ; https://docs.retellai.com/features/inbound-call-webhook ; https://docs.retellai.com/features/register-webhook .
