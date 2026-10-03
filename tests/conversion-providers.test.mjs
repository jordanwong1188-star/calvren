import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac, generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import ts from "typescript";

function compile(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
const contracts = compile(await readFile(new URL("../src/conversion/contracts.mts", import.meta.url), "utf8"));
const contractsUrl = "data:text/javascript;base64," + Buffer.from(contracts).toString("base64");
const providerSource = await readFile(new URL("../netlify/lib/conversion-providers.mts", import.meta.url), "utf8");
const providerCode = compile(providerSource).replace('"../../src/conversion/contracts.mjs"', JSON.stringify(contractsUrl));
const {
  createLiveProviders, createOpenAIService, createTwilioMessagingService, validateTwilioWebhook,
  createGoogleCalendarService, createResendNotificationService, googleEventId,
} = await import("data:text/javascript;base64," + Buffer.from(providerCode).toString("base64"));

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const NOW = "2026-10-05T15:00:00.000Z"; // Monday 8 AM in Vancouver.
const ACCOUNT = "AC" + "1".repeat(32), SID = "SM" + "2".repeat(32);
const client = {
  id: "abc-plumbing", business_name: "ABC Plumbing", industry: "Plumbing",
  description: "Local plumbing services.", services: ["Leak repair", "Drain cleaning"],
  phone_number: "+16045550100", email: "business@example.com", timezone: "America/Vancouver",
  business_hours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"]
    .map(day => [day, { open: "09:00", close: "17:00" }])),
  ai_tone: "Friendly and concise", system_prompt: "Help our plumbing customers.",
  qualifying_questions: [
    { id: "service", prompt: "What service do you need?", required: true },
    { id: "emergency", prompt: "Is it an emergency?", required: true },
    { id: "area", prompt: "Where are you located?", required: true },
    { id: "timing", prompt: "When do you need service?", required: true },
  ],
  booking_enabled: true, follow_up_enabled: true, follow_up_delay: [120, 1440],
  max_follow_up_attempts: 3, notification_email: "owner@example.com",
  calendar: { provider: "google", calendar_id: "bookings@example.com", duration_minutes: 30,
    horizon_days: 7, buffer_minutes: 15 },
  booking_rules: "Book a standard inspection.", service_areas: ["Vancouver"], active: true, mode: "live",
};
const lead = {
  id: "lead-123", client_id: client.id, name: "Jamie", phone: "+16045550199", email: "jamie@example.com",
  original_message: "Hi, my kitchen sink is leaking.", source: "test", created_at: NOW, updated_at: NOW,
  status: "responding", qualification_status: "pending", appointment_status: "none",
  last_contacted_at: null, last_inbound_at: NOW, next_follow_up_at: null, follow_up_attempts: 0,
  answers: {}, offered_slots: [], automation_active: true, consent_sms: true, opted_out: false,
  mode: "live", channel: "sms", version: 1, handoff_reason: null,
};
const message = {
  id: "message-123", client_id: client.id, lead_id: lead.id, sender: "assistant",
  message: "Hi Jamie, is the leak an emergency?", channel: "sms", timestamp: NOW, ai: true,
  status: "pending", provider_id: null, idempotency_key: "message-123",
};
const notification = {
  id: "notification-123", client_id: client.id, lead_id: lead.id, event: "qualified",
  message: "Jamie is qualified for a leak inspection.", created_at: NOW, status: "pending", provider_id: null,
};
const defaultAction = {
  message: "Hi Jamie, is the leak an emergency?", intent: "qualify", lead_status: "responding",
  qualified: false, ready_to_book: false, needs_human: false,
  answers: { service: "Leak repair", emergency: "", area: "", timing: "" },
  selected_slot_id: null, handoff_reason: null,
};
const allAnswers = { service: "Leak repair", emergency: "No", area: "Vancouver", timing: "Tomorrow" };
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function clone(value) { return structuredClone(value); }
function fixture(handler) {
  const values = {
    OPENAI_API_KEY: "synthetic-openai-key", OPENAI_MODEL: "gpt-4o-mini",
    TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: "synthetic-twilio-token",
    TWILIO_PHONE_NUMBER: client.phone_number, CALVREN_PUBLIC_URL: "https://calvren.example",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "calvren@demo-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey, RESEND_API_KEY: "synthetic-resend-key",
    NOTIFICATION_FROM_EMAIL: "notify@example.com",
  };
  const calls = [];
  const options = {
    env: name => values[name], now: () => new Date(NOW),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (!handler) throw new Error("Unexpected external provider call.");
      return handler(String(url), init, calls);
    },
  };
  return { values, calls, options };
}
function bundle(input = lead) {
  return { lead: clone(input), messages: [{ ...message, sender: "lead", ai: false, status: "received",
    message: input.original_message }], appointments: [], notifications: [] };
}
function aiPayload(action = defaultAction) {
  return { status: "completed", output: [{ type: "message",
    content: [{ type: "output_text", text: JSON.stringify(action) }] }] };
}
function errorCode(code) { return error => error.code === code; }

test("live factory refuses missing settings without returning secret values", () => {
  const f = fixture(); delete f.values.OPENAI_API_KEY;
  assert.throws(() => createLiveProviders(f.options), error => {
    assert.equal(error.code, "CONFIGURATION_INCOMPLETE");
    assert.match(error.message, /OPENAI_API_KEY/);
    assert.doesNotMatch(error.message, /synthetic-twilio-token/);
    return true;
  });
  assert.equal(f.calls.length, 0);
});
test("every live adapter rejects demo leads before any external request", async () => {
  const f = fixture(), providers = createLiveProviders(f.options), demoLead = { ...lead, mode: "demo" };
  await assert.rejects(providers.ai.analyze({ client, bundle: bundle(demoLead), reason: "inbound" }), errorCode("MODE_MISMATCH"));
  await assert.rejects(providers.messaging.send({ client, lead: demoLead, message }), errorCode("MODE_MISMATCH"));
  await assert.rejects(providers.calendar.available({ client, lead: demoLead, now: NOW }), errorCode("MODE_MISMATCH"));
  await assert.rejects(providers.calendar.book({ client, lead: demoLead, appointment: {} }), errorCode("MODE_MISMATCH"));
  await assert.rejects(providers.notifications.send({ client, lead: demoLead, notification }), errorCode("MODE_MISMATCH"));
  assert.equal(f.calls.length, 0);
});
test("every live adapter rejects demo client configuration and tenant mismatch", async () => {
  const f = fixture(), providers = createLiveProviders(f.options);
  await assert.rejects(providers.ai.analyze({ client: { ...client, mode: "demo" }, bundle: bundle(), reason: "inbound" }),
    errorCode("MODE_MISMATCH"));
  await assert.rejects(providers.messaging.send({ client: { ...client, id: "other" }, lead, message }), errorCode("CLIENT_MISMATCH"));
  await assert.rejects(providers.notifications.send({ client: { ...client, active: false }, lead, notification }), errorCode("CLIENT_MISMATCH"));
  assert.equal(f.calls.length, 0);
});
test("Responses API sends business config, history and strict dynamic schema server-side", async () => {
  const f = fixture(() => json(aiPayload())), ai = createOpenAIService(f.options);
  const result = await ai.analyze({ client, bundle: bundle(), reason: "inbound" });
  assert.equal(result.message, defaultAction.message);
  assert.deepEqual(result.answers, { service: "Leak repair" });
  const call = f.calls[0], body = JSON.parse(call.init.body);
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.text.format.schema.properties.answers.required, ["service", "emergency", "area", "timing"]);
  const input = JSON.parse(body.input[0].content);
  assert.equal(input.business.business_name, client.business_name);
  assert.equal(input.conversation[0].message, lead.original_message);
  assert.equal(input.lead.phone, undefined);
  assert.ok(call.init.signal instanceof AbortSignal);
});
test("AI refuses fabricated bookings, unknown slots and missing required qualification", async () => {
  const actions = [
    { ...defaultAction, lead_status: "booked" },
    { ...defaultAction, selected_slot_id: "fabricated" },
    { ...defaultAction, qualified: true, ready_to_book: true },
    { ...defaultAction, intent: "book", selected_slot_id: null },
    { ...defaultAction, needs_human: true },
    { ...defaultAction, answers: { ...defaultAction.answers, unexpected: "injection" } },
  ];
  for (const action of actions) {
    const f = fixture(() => json(aiPayload(action)));
    await assert.rejects(createOpenAIService(f.options).analyze({ client, bundle: bundle(), reason: "inbound" }),
      errorCode("AI_INVALID_RESPONSE"));
  }
});
test("AI accepts a supported booking selection and configured qualifying answers", async () => {
  const slot = { id: "offered-1", start: "2026-10-06T16:00:00.000Z", end: "2026-10-06T16:30:00.000Z", label: "Tue 9 AM" };
  const action = { ...defaultAction, intent: "book", lead_status: "booking", answers: allAnswers,
    qualified: true, ready_to_book: true, selected_slot_id: slot.id };
  const f = fixture(() => json(aiPayload(action)));
  const result = await createOpenAIService(f.options).analyze({
    client, bundle: bundle({ ...lead, offered_slots: [slot] }), reason: "inbound",
  });
  assert.equal(result.selected_slot_id, slot.id);
  assert.deepEqual(result.answers, allAnswers);
});
test("AI refusal, incomplete JSON and provider failure are safe errors", async () => {
  const cases = [
    [() => json({ status: "incomplete", output: [] }), "AI_INVALID_RESPONSE"],
    [() => json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }), "AI_REFUSAL"],
    [() => json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{broken" }] }] }), "AI_INVALID_RESPONSE"],
    [() => json({ secret: "provider internals" }, 429), "AI_UNAVAILABLE"],
    [() => { throw new Error("network details synthetic-openai-key"); }, "AI_UNAVAILABLE"],
  ];
  for (const [handler, code] of cases) {
    const f = fixture(handler);
    await assert.rejects(createOpenAIService(f.options).analyze({ client, bundle: bundle(), reason: "inbound" }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret|synthetic|provider internals/);
      return true;
    });
  }
});
test("SMS validates consent and paused automation before calling Twilio", async () => {
  const f = fixture(), service = createTwilioMessagingService(f.options);
  for (const data of [{ ...lead, consent_sms: false }, { ...lead, opted_out: true },
    { ...lead, automation_active: false }, { ...lead, status: "needs_human" }])
    await assert.rejects(service.send({ client, lead: data, message }));
  await assert.rejects(service.send({ client, lead, message: { ...message, client_id: "other" } }), errorCode("SMS_NOT_ALLOWED"));
  assert.equal(f.calls.length, 0);
});
test("website response delivery stays local and returns a stable reference", async () => {
  const f = fixture(), service = createTwilioMessagingService(f.options);
  const result = await service.send({ client, lead: { ...lead, channel: "website", consent_sms: false },
    message: { ...message, channel: "website" } });
  assert.equal(result.provider_id, "website:" + message.id);
  assert.equal(f.calls.length, 0);
});
test("Twilio send includes a fixed verified status callback and records accepted SID", async () => {
  const f = fixture(() => json({ sid: SID, status: "queued", account_sid: ACCOUNT, to: lead.phone, from: client.phone_number }, 201));
  const result = await createTwilioMessagingService(f.options).send({ client, lead, message });
  assert.deepEqual(result, { provider_id: SID, status: "sent" });
  const call = f.calls[0], fields = new URLSearchParams(call.init.body);
  assert.equal(call.url, "https://api.twilio.com/2010-04-01/Accounts/" + ACCOUNT + "/Messages.json");
  assert.equal(fields.get("To"), lead.phone);
  assert.equal(fields.get("From"), client.phone_number);
  assert.equal(fields.get("StatusCallback"), "https://calvren.example/api/conversion/twilio/status?message_id=" + message.id);
  assert.equal(fields.get("Body"), message.message);
});
test("Twilio network uncertainty never becomes a retryable successful send", async () => {
  for (const handler of [
    () => { throw new Error("timeout after accepted"); },
    () => json({}, 503),
    () => json({ sid: SID, status: "failed" }, 201),
    () => new Response("not json", { status: 201 }),
  ]) {
    const f = fixture(handler);
    await assert.rejects(createTwilioMessagingService(f.options).send({ client, lead, message }), errorCode("DELIVERY_UNKNOWN"));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(() => json({ code: 21610 }, 400));
  await assert.rejects(createTwilioMessagingService(f.options).send({ client, lead, message }), errorCode("SMS_REJECTED"));
});
function signedRequest(f, fields = {}, path = "/api/conversion/twilio/inbound", overrides = {}) {
  const params = { AccountSid: ACCOUNT, MessageSid: SID, From: lead.phone, To: client.phone_number,
    Body: "The leak is not an emergency.", ...fields };
  const publicUrl = "https://calvren.example" + path;
  const signed = Object.keys(params).sort().reduce((value, key) => value + key + params[key], publicUrl);
  const signature = createHmac("sha1", f.values.TWILIO_AUTH_TOKEN).update(signed).digest("base64");
  return new Request(overrides.url || publicUrl, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": overrides.signature ?? signature },
    body: overrides.body ?? new URLSearchParams(params).toString(),
  });
}
test("Twilio inbound verification uses configured origin, exact signed body and account", async () => {
  const f = fixture(), path = "/api/conversion/twilio/inbound";
  const fields = await validateTwilioWebhook({ request: signedRequest(f), env: f.options.env, path });
  assert.equal(fields.MessageSid, SID);
  assert.equal(fields.Body, "The leak is not an emergency.");
  const hostChanged = await validateTwilioWebhook({
    request: signedRequest(f, {}, path, { url: "https://untrusted-host.example" + path }), env: f.options.env, path,
  });
  assert.equal(hostChanged.MessageSid, SID); // Request host cannot alter the canonical signature URL.
  assert.equal(f.calls.length, 0);
});
test("Twilio webhook rejects forged, mutated, wrong-account and wrong-route requests", async () => {
  const f = fixture(), path = "/api/conversion/twilio/inbound";
  for (const req of [
    signedRequest(f, {}, path, { signature: "A".repeat(27) + "=" }),
    signedRequest(f, {}, path, { body: new URLSearchParams({ AccountSid: ACCOUNT, MessageSid: SID,
      From: lead.phone, To: client.phone_number, Body: "tampered" }).toString() }),
    signedRequest(f, { AccountSid: "AC" + "3".repeat(32) }),
  ]) await assert.rejects(validateTwilioWebhook({ request: req, env: f.options.env, path }), errorCode("WEBHOOK_UNAUTHORISED"));
  await assert.rejects(validateTwilioWebhook({
    request: signedRequest(f, {}, path, { url: "https://calvren.example" + path + "?spoof=1" }),
    env: f.options.env, path,
  }), errorCode("INVALID_WEBHOOK"));
});
test("Twilio webhook bounds bodies and rejects duplicate parameters", async () => {
  const f = fixture(), path = "/api/conversion/twilio/inbound";
  for (const body of ["Body=" + "x".repeat(20001), "Body=hello&Body=duplicate", "Body=bad%zz"]) {
    await assert.rejects(validateTwilioWebhook({ request: signedRequest(f, {}, path, { body }),
      env: f.options.env, path }), errorCode("INVALID_WEBHOOK"));
  }
});
test("Twilio signed status callbacks are accepted without an inbound Body", async () => {
  const f = fixture(), path = "/api/conversion/twilio/status";
  const fields = { AccountSid: ACCOUNT, MessageSid: SID, From: client.phone_number, To: lead.phone,
    MessageStatus: "delivered" };
  const callbackUrl = "https://calvren.example" + path + "?message_id=" + message.id;
  const raw = Object.keys(fields).sort().reduce((result, key) => result + key + fields[key], callbackUrl);
  const req = new Request(callbackUrl, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": createHmac("sha1", f.values.TWILIO_AUTH_TOKEN).update(raw).digest("base64") },
    body: new URLSearchParams(fields).toString() });
  assert.equal((await validateTwilioWebhook({ request: req, env: f.options.env, path })).MessageStatus, "delivered");
});
function calendarFixture({ busy = [], eventStatus = 200, existing = false } = {}) {
  let savedEvent = null;
  const f = fixture((url, init) => {
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "synthetic-google-token", expires_in: 3600 });
    if (url.endsWith("/freeBusy")) return json({ calendars: { [client.calendar.calendar_id]: { busy } } });
    if (init.method === "POST" && url.endsWith("/events")) {
      savedEvent = JSON.parse(init.body);
      return json({ ...savedEvent, status: "confirmed" }, eventStatus);
    }
    if (url.includes("/events/")) {
      if (savedEvent || existing) return json({ ...(savedEvent || existing), status: "confirmed" });
      return json({}, 404);
    }
    throw new Error("Unexpected calendar request");
  });
  return { ...f, event: () => savedEvent };
}
test("Google service-account token has correct scope and verifiable RS256 signature", async () => {
  const f = calendarFixture(), service = createGoogleCalendarService(f.options);
  await service.available({ client, lead, now: NOW });
  const call = f.calls.find(item => item.url === "https://oauth2.googleapis.com/token");
  const assertion = new URLSearchParams(call.init.body).get("assertion"), pieces = assertion.split(".");
  const payload = JSON.parse(Buffer.from(pieces[1], "base64url"));
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  assert.equal(payload.iss, f.values.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  assert.match(payload.scope, /calendar.events/);
  assert.match(payload.scope, /calendar.freebusy/);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(verify("RSA-SHA256", Buffer.from(pieces[0] + "." + pieces[1]),
    createPublicKey(privateKey), Buffer.from(pieces[2], "base64url")), true);
});
test("availability applies local business hours, provider busy time and appointment buffer", async () => {
  const f = calendarFixture({ busy: [{ start: "2026-10-05T16:00:00.000Z", end: "2026-10-05T17:00:00.000Z" }] });
  const service = createGoogleCalendarService(f.options);
  const slots = await service.available({ client, lead, now: NOW });
  assert.equal(slots.length, 6);
  assert.equal(slots[0].start, "2026-10-05T17:30:00.000Z"); // 10:30 AM; 10:00-10:30 intersects buffer.
  assert.match(slots[0].label, /10:30/);
  assert.match(slots[0].label, /PDT/);
  assert.ok(slots.every(slot => Date.parse(slot.end) - Date.parse(slot.start) === 30 * 60_000));
  const again = await service.available({ client, lead, now: NOW });
  assert.deepEqual(again, slots);
  assert.equal(f.calls.filter(call => call.url === "https://oauth2.googleapis.com/token").length, 1);
});
test("availability respects DST and never offers nonexistent wall-clock times", async () => {
  const f = calendarFixture(), service = createGoogleCalendarService(f.options);
  const special = { ...client, business_hours: { sunday: { open: "01:00", close: "04:00" } },
    calendar: { ...client.calendar, horizon_days: 1, buffer_minutes: 0 } };
  const slots = await service.available({ client: special, lead, now: "2027-03-14T08:00:00.000Z" });
  assert.ok(slots.some(slot => /3:00/.test(slot.label)));
  assert.ok(slots.every(slot => !/\s2:/.test(slot.label)));
  assert.ok(slots.every(slot => Date.parse(slot.end) - Date.parse(slot.start) === 30 * 60_000));
});
test("calendar permission errors fail closed instead of returning apparently free time", async () => {
  const f = fixture((url) => url.includes("oauth2") ? json({ access_token: "token", expires_in: 3600 })
    : json({ calendars: { [client.calendar.calendar_id]: { errors: [{ reason: "notFound" }], busy: [] } } }));
  await assert.rejects(createGoogleCalendarService(f.options).available({ client, lead, now: NOW }), errorCode("CALENDAR_UNAVAILABLE"));
});
function appointmentFixture() {
  const slot = { id: "offered-1", start: "2026-10-05T16:00:00.000Z", end: "2026-10-05T16:30:00.000Z", label: "Mon 9 AM PDT" };
  const appointment = { id: "appointment-123", client_id: client.id, lead_id: lead.id, slot,
    status: "pending", provider_id: null, created_at: NOW };
  return { appointment, qualifiedLead: { ...lead, answers: allAnswers, status: "booking", qualification_status: "qualified",
    offered_slots: [slot], appointment_status: "pending" } };
}
test("booking rechecks free/busy, creates stable owned event and excludes attendees", async () => {
  const f = calendarFixture(), { appointment, qualifiedLead } = appointmentFixture();
  const result = await createGoogleCalendarService(f.options).book({ client, lead: qualifiedLead, appointment });
  assert.equal(result.provider_id, googleEventId(appointment.id));
  const event = f.event();
  assert.equal(event.id, result.provider_id);
  assert.match(event.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(event.attendees, undefined);
  assert.equal(event.start.timeZone, client.timezone);
  assert.equal(event.extendedProperties.private.calvren_lead_id, lead.id);
  const freeBusyIndex = f.calls.findIndex(call => call.url.endsWith("/freeBusy"));
  const insertIndex = f.calls.findIndex(call => call.url.endsWith("/events") && call.init.method === "POST");
  assert.ok(freeBusyIndex >= 0 && freeBusyIndex < insertIndex);
});
test("booking retries reconcile an existing owned appointment without inserting a duplicate", async () => {
  const f = calendarFixture(), { appointment, qualifiedLead } = appointmentFixture();
  const service = createGoogleCalendarService(f.options);
  const first = await service.book({ client, lead: qualifiedLead, appointment });
  const second = await service.book({ client, lead: qualifiedLead, appointment });
  assert.deepEqual(second, first);
  assert.equal(f.calls.filter(call => call.url.endsWith("/events") && call.init.method === "POST").length, 1);
});
test("Google 409 duplicate response is reconciled with the deterministic event ID", async () => {
  const f = calendarFixture({ eventStatus: 409 }), { appointment, qualifiedLead } = appointmentFixture();
  assert.equal((await createGoogleCalendarService(f.options).book({ client, lead: qualifiedLead, appointment })).provider_id,
    googleEventId(appointment.id));
  assert.equal(f.calls.filter(call => call.url.includes("/events/")).length, 2);
});
test("booking rejects stale/busy/unoffered appointments and foreign existing events", async () => {
  const { appointment, qualifiedLead } = appointmentFixture();
  const busy = calendarFixture({ busy: [{ start: appointment.slot.start, end: appointment.slot.end }] });
  await assert.rejects(createGoogleCalendarService(busy.options).book({ client, lead: qualifiedLead, appointment }), errorCode("CALENDAR_CONFLICT"));
  assert.equal(busy.event(), null);
  const f = calendarFixture();
  await assert.rejects(createGoogleCalendarService(f.options).book({ client, lead,
    appointment: { ...appointment, slot: { ...appointment.slot, id: "unoffered" } } }), errorCode("INVALID_APPOINTMENT"));
  assert.equal(f.calls.length, 0);
  const foreign = calendarFixture({ existing: { id: googleEventId(appointment.id), start: { dateTime: appointment.slot.start },
    end: { dateTime: appointment.slot.end }, extendedProperties: { private: { calvren_lead_id: "another-lead" } } } });
  await assert.rejects(createGoogleCalendarService(foreign.options).book({ client, lead: qualifiedLead, appointment }),
    errorCode("CALENDAR_CONFLICT"));
});
test("notifications use server-only Resend and stable idempotency header, including handoff", async () => {
  const f = fixture(() => json({ id: "email-123" }));
  const result = await createResendNotificationService(f.options).send({
    client, lead: { ...lead, automation_active: false, status: "needs_human" },
    notification: { ...notification, event: "needs_human" },
  });
  assert.equal(result.provider_id, "email-123");
  const call = f.calls[0], payload = JSON.parse(call.init.body);
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.init.headers["Idempotency-Key"], "calvren-notification/" + notification.id);
  assert.deepEqual(payload.to, [client.notification_email]);
  assert.equal(payload.from, "notify@example.com");
  assert.match(payload.subject, /needs human/);
});
test("notification failure remains a safe error and cannot disclose provider details", async () => {
  const f = fixture(() => json({ message: "secret provider error" }, 403));
  await assert.rejects(createResendNotificationService(f.options).send({ client, lead, notification }), error => {
    assert.equal(error.code, "NOTIFICATION_UNAVAILABLE");
    assert.doesNotMatch(error.message, /secret|provider error/);
    return true;
  });
});

test("Twilio status signature binds the message ID query and rejects extra or duplicate query fields", async () => {
  const f = fixture(), path = "/api/conversion/twilio/status";
  const fields = { AccountSid: ACCOUNT, MessageSid: SID, From: client.phone_number, To: lead.phone, MessageStatus: "sent" };
  const originalUrl = "https://calvren.example" + path + "?message_id=" + message.id;
  const raw = Object.keys(fields).sort().reduce((result, key) => result + key + fields[key], originalUrl);
  const signature = createHmac("sha1", f.values.TWILIO_AUTH_TOKEN).update(raw).digest("base64");
  for (const [query, code] of [
    ["?message_id=another-message", "WEBHOOK_UNAUTHORISED"],
    ["?message_id=" + message.id + "&unexpected=yes", "INVALID_WEBHOOK"],
    ["?message_id=" + message.id + "&message_id=another-message", "INVALID_WEBHOOK"],
    ["?message_id=..%2Fother", "INVALID_WEBHOOK"],
    ["", "INVALID_WEBHOOK"],
  ]) {
    const req = new Request("https://calvren.example" + path + query, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
      body: new URLSearchParams(fields).toString() });
    await assert.rejects(validateTwilioWebhook({ request: req, env: f.options.env, path }), errorCode(code));
  }
});
