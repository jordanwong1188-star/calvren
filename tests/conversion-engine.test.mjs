import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Execute the actual shared engine, not a mirrored implementation or generated browser bundle.
const directory = await mkdtemp(join(tmpdir(), "calvren-conversion-"));
after(() => rm(directory, { recursive: true, force: true }));
for (const name of ["contracts", "demo-config", "validation", "time", "memory-repository", "mock-services", "engine"]) {
  const source = await readFile(new URL("../src/conversion/" + name + ".mts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true
  });
  assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  await writeFile(join(directory, name + ".mjs"), compiled.outputText);
}
const from = name => import(pathToFileURL(join(directory, name + ".mjs")).href);
const { ConversionEngine } = await from("engine");
const { MemoryRepository } = await from("memory-repository");
const { newDemoClient } = await from("demo-config");
const { createDemoServices } = await from("mock-services");
const { validateClient, validateIntake } = await from("validation");
const { insideBusinessHours, nextBusinessTime } = await from("time");

function fixture(options = {}) {
  const client = newDemoClient(options.client ?? {});
  const repository = new MemoryRepository([client]);
  let instant = new Date("2026-10-05T16:00:00.000Z");
  let sequence = 0;
  const calls = { ai: 0, sms: [], bookings: [], notifications: [] };
  const mock = createDemoServices();
  const services = {
    ai: { async analyze(input) { calls.ai++; return mock.ai.analyze(input); } },
    messaging: { async send(input) {
      const saved = await repository.getBundle(input.client.id, input.lead.id);
      assert.equal(saved.messages.find(m => m.id === input.message.id).status, "pending");
      calls.sms.push(structuredClone(input));
      return mock.messaging.send(input);
    } },
    calendar: {
      available: input => mock.calendar.available(input),
      async book(input) {
        const saved = await repository.getBundle(input.client.id, input.lead.id);
        assert.equal(saved.appointments.find(a => a.id === input.appointment.id).status, "pending");
        calls.bookings.push(structuredClone(input)); return mock.calendar.book(input);
      }
    },
    notifications: { async send(input) {
      const saved = await repository.getBundle(input.client.id, input.lead.id);
      assert.equal(saved.notifications.find(n => n.id === input.notification.id).status, "pending");
      calls.notifications.push(structuredClone(input)); return mock.notifications.send(input);
    } },
    ...options.services
  };
  const engine = new ConversionEngine({
    repository, ...services, now: () => new Date(instant), uuid: () => "id-" + (++sequence)
  });
  return {
    engine, repository, client, calls, services, mock,
    advance: iso => { instant = new Date(iso); },
    now: () => instant.toISOString(),
    input: extra => ({
      client_id: client.id, name: "Jamie Demo", message: "Hi, my kitchen sink is leaking and I need someone to look at it.",
      channel: "website", source: "test", idempotency_key: "intake-1", ...extra
    }),
    reply: (bundle, message, event_key = "event-" + (++sequence)) => engine.receive({
      client_id: client.id, lead_id: bundle.lead.id, message, channel: bundle.lead.channel, event_key
    })
  };
}
async function qualify(f, input = {}) {
  let bundle = await f.engine.intake(f.input(input));
  bundle = await f.reply(bundle, "No, it can wait for a routine appointment.");
  bundle = await f.reply(bundle, "Vancouver");
  return f.reply(bundle, "Tomorrow");
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test("first MVP fake leak workflow qualifies, offers stored times, books, notifies, and retains the conversation", async () => {
  const f = fixture();
  let bundle = await f.engine.intake(f.input());
  assert.equal(bundle.lead.status, "contacted");
  assert.equal(bundle.lead.answers.service, "Leak repair");
  assert.match(bundle.messages.at(-1).message, /emergency/i);
  bundle = await f.reply(bundle, "No, it can wait.");
  assert.match(bundle.messages.at(-1).message, /area/i);
  bundle = await f.reply(bundle, "Vancouver");
  assert.match(bundle.messages.at(-1).message, /when/i);
  bundle = await f.reply(bundle, "Tomorrow");
  assert.equal(bundle.lead.qualification_status, "qualified");
  assert.equal(bundle.lead.status, "booking");
  assert.equal(bundle.lead.offered_slots.length, 3);
  assert.match(bundle.messages.at(-1).message, /simulated appointment/i);
  bundle = await f.reply(bundle, bundle.lead.offered_slots[1].id);
  assert.equal(bundle.lead.status, "booked");
  assert.equal(bundle.lead.appointment_status, "booked");
  assert.equal(bundle.lead.next_follow_up_at, null);
  assert.equal(bundle.appointments.length, 1);
  assert.equal(bundle.appointments[0].slot.id, bundle.lead.offered_slots[1].id);
  assert.equal(f.calls.bookings.length, 1);
  assert.deepEqual(bundle.notifications.map(n => n.event), ["qualified", "booked"]);
  assert.ok(bundle.notifications.every(n => n.status === "sent"));
  assert.equal(bundle.messages.filter(m => m.sender === "lead").length, 5);
  assert.equal(bundle.messages.filter(m => m.sender === "assistant").length, 5);
  assert.ok(bundle.messages.every(m => m.status === "received" || m.status === "sent"));
});
test("one reusable engine serves a different configured business and custom questions", async () => {
  const f = fixture({ client: {
    id: "office-demo", business_name: "Office Studio", industry: "Professional services",
    services: ["Bookkeeping"], qualifying_questions: [
      { id: "service_needed", prompt: "What service do you need?", required: true },
      { id: "team_size", prompt: "How many people are on your team?", required: true }
    ]
  } });
  let bundle = await f.engine.intake(f.input({ message: "I need bookkeeping." }));
  assert.match(bundle.messages.at(-1).message, /Office Studio/);
  assert.match(bundle.messages.at(-1).message, /How many people/);
  bundle = await f.reply(bundle, "Eight");
  assert.equal(bundle.lead.answers.team_size, "Eight");
  assert.equal(bundle.lead.status, "booking");
  assert.ok(!Object.hasOwn(bundle.lead.answers, "emergency"));
});
test("idempotent intake and duplicate webhook replies spend no duplicate AI/provider work", async () => {
  const f = fixture();
  const first = await f.engine.intake(f.input());
  const duplicate = await f.engine.intake(f.input({ message: "Changed input must not overwrite the original." }));
  assert.equal(duplicate.lead.id, first.lead.id);
  assert.equal(f.calls.ai, 1);
  assert.equal(f.calls.sms.length, 1);
  await f.reply(first, "No, it can wait", "sms-event-1");
  const duplicateReply = await f.reply(first, "Changed inbound text", "sms-event-1");
  assert.equal(f.calls.ai, 2);
  assert.equal(f.calls.sms.length, 2);
  assert.equal(duplicateReply.messages.filter(m => m.sender === "lead").length, 2);
});
test("invalid input and SMS without positive consent are rejected before persisting or processing", async () => {
  const f = fixture();
  for (const extra of [
    { name: "" }, { message: "x".repeat(2001) }, { email: "invalid" },
    { phone: "6041234567" }, { client_id: "../escape" },
    { channel: "sms", phone: "+16045550100", consent_sms: false },
    { channel: "sms", phone: "", consent_sms: true }, { consent_sms: "true" },
    { channel: "email" }
  ]) await assert.rejects(f.engine.intake(f.input(extra)));
  assert.equal((await f.repository.listLeads()).length, 0);
  assert.equal(f.calls.ai, 0);
});
test("live mode cannot be changed in place and demo adapters reject live businesses", async () => {
  const f = fixture();
  await assert.rejects(f.repository.saveClient({ ...f.client, mode: "live", calendar: { ...f.client.calendar, provider: "google" } }), /separate client/);
  const live = { ...f.client, mode: "live", calendar: { ...f.client.calendar, provider: "google" } };
  await assert.rejects(f.mock.messaging.send({ client: live, lead: {}, message: { id: "fake" } }), /never serve live/);
  await assert.rejects(f.mock.calendar.available({ client: live, lead: {}, now: f.now() }), /never serve live/);
  await assert.rejects(f.mock.notifications.send({ client: live, lead: {}, notification: {} }), /never serve live/);
});
test("malformed client questions, excessive follow-ups, invalid timezone and overnight hours are rejected", () => {
  for (const override of [
    { qualifying_questions: [{ id: "x", prompt: "One?", required: true }, { id: "x", prompt: "Two?", required: true }] },
    { qualifying_questions: [{ id: "__proto__", prompt: "One?", required: true }] },
    { max_follow_up_attempts: 4 }, { follow_up_delay: [1] },
    { timezone: "not/a/timezone" }, { services: [] },
    { business_hours: { "1": { open: "21:00", close: "08:00" } } }
  ]) assert.throws(() => validateClient({ ...newDemoClient(), ...override }));
  assert.equal(validateIntake({ client_id: "client-1", name: "Jamie", message: "Help", idempotency_key: "k" }).channel, "website");
});
test("repository tenant scope prevents cross-client reads and inbound writes", async () => {
  const f = fixture();
  const bundle = await f.engine.intake(f.input());
  assert.equal(await f.repository.getBundle("other-client", bundle.lead.id), null);
  assert.equal(await f.repository.findLeadByPhone("other-client", "+16045550100"), null);
  assert.deepEqual(await f.repository.listLeads("other-client"), []);
  await assert.rejects(f.repository.appendInbound("other-client", bundle.lead.id, bundle.messages[0], "different-event"), /not found/);
});
test("required configuration answers cannot be bypassed by an AI qualified or booking flag", async () => {
  const maliciousAI = { async analyze() { return {
    message: "You're qualified, let's book.", intent: "offer_booking", lead_status: "qualified",
    qualified: true, ready_to_book: true, needs_human: false, answers: {}, selected_slot_id: null, handoff_reason: null
  }; } };
  const f = fixture({ services: { ai: maliciousAI } });
  const bundle = await f.engine.intake(f.input());
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.lead.qualification_status, "pending");
  assert.equal(bundle.lead.offered_slots.length, 0);
  assert.equal(bundle.appointments.length, 0);
  assert.equal(f.calls.sms.length, 0);
});
test("unknown answer IDs and prototype-like keys are not stored as qualification", async () => {
  const f = fixture({ services: { ai: { async analyze() { return {
    message: "What do you need?", intent: "qualify", lead_status: "responding",
    qualified: false, ready_to_book: false, needs_human: false,
    answers: JSON.parse('{"intruder":"yes","__proto__":"yes"}'), selected_slot_id: null, handoff_reason: null
  }; } } } });
  const bundle = await f.engine.intake(f.input());
  assert.deepEqual(bundle.lead.answers, {});
});
test("newer inbound during awaited AI invalidates the old worker and preserves all messages", async () => {
  const gate = deferred(); const started = deferred();
  const f = fixture();
  let invocation = 0;
  f.services.ai.analyze = async input => {
    if (++invocation === 1) { started.resolve(); await gate.promise; }
    return f.mock.ai.analyze(input);
  };
  const pending = f.engine.intake(f.input());
  await started.promise;
  let current = (await f.repository.listLeads())[0];
  current = await f.reply(current, "It is not an emergency.");
  gate.resolve();
  const result = await pending;
  assert.equal(f.calls.sms.length, 1);
  assert.equal(result.messages.filter(m => m.sender === "lead").length, 2);
  assert.equal(result.messages.filter(m => m.sender === "assistant").length, 1);
  assert.equal(result.lead.answers.emergency, "Routine / not an emergency");
});
test("STOP received during AI work suppresses the stale reply and no START automatically resumes", async () => {
  const gate = deferred(); const started = deferred();
  const f = fixture();
  f.services.ai.analyze = async input => { started.resolve(); await gate.promise; return f.mock.ai.analyze(input); };
  const pending = f.engine.intake(f.input({ channel: "sms", phone: "+16045550100", consent_sms: true }));
  await started.promise;
  const current = (await f.repository.listLeads())[0];
  const stopped = await f.reply(current, "STOP");
  gate.resolve(); await pending;
  assert.equal(stopped.lead.opted_out, true);
  assert.equal(stopped.lead.automation_active, false);
  assert.equal(stopped.lead.next_follow_up_at, null);
  assert.equal(f.calls.sms.length, 0);
  const afterStart = await f.reply(stopped, "START");
  assert.equal(afterStart.lead.automation_active, false);
  await assert.rejects(f.engine.resume(f.client.id, stopped.lead.id), /fresh consent/);
});
test("human, dangerous and frustrated requests stop automation and log an owner notification", async () => {
  for (const message of ["I want to speak to a human.", "I smell gas.", "I am very angry."]) {
    const f = fixture();
    const bundle = await f.engine.intake(f.input({ message }));
    assert.equal(bundle.lead.status, "needs_human");
    assert.equal(bundle.lead.automation_active, false);
    assert.equal(f.calls.sms.length, 0);
    assert.equal(bundle.notifications[0].event, "needs_human");
    assert.equal(bundle.notifications[0].status, "sent");
  }
});
test("a manual human pause ignores replies until explicitly resumed", async () => {
  const f = fixture();
  let bundle = await f.engine.intake(f.input());
  bundle = await f.engine.handoff(f.client.id, bundle.lead.id, "Owner is taking over.");
  const sends = f.calls.sms.length;
  bundle = await f.reply(bundle, "No, not an emergency");
  assert.equal(f.calls.sms.length, sends);
  assert.equal(bundle.lead.status, "needs_human");
  await f.engine.resume(f.client.id, bundle.lead.id);
  bundle = await f.reply(bundle, "No, it can wait.");
  assert.equal(bundle.lead.automation_active, true);
  assert.equal(f.calls.sms.length, sends + 1);
});
test("provider failure retains the pending outbound as unknown and disables autonomous retries", async () => {
  const f = fixture({ services: { messaging: { async send() { throw new Error("Private provider failure"); } } } });
  let bundle = await f.engine.intake(f.input());
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.lead.automation_active, false);
  assert.equal(bundle.messages.at(-1).status, "unknown");
  assert.ok(!bundle.lead.handoff_reason.includes("Private provider"));
  await assert.rejects(f.engine.resume(f.client.id, bundle.lead.id), /Reconcile/);
  bundle = await f.reply(bundle, "Can you try again?");
  assert.equal(bundle.messages.filter(m => m.sender === "assistant").length, 1);
});
test("AI provider outage and malformed output retain intake and safely hand off", async () => {
  for (const ai of [
    { async analyze() { throw new Error("Private API detail"); } },
    { async analyze() { return { message: "", answers: {} }; } }
  ]) {
    const f = fixture({ services: { ai } });
    const bundle = await f.engine.intake(f.input());
    assert.equal(bundle.lead.status, "needs_human");
    assert.equal(bundle.messages[0].message, f.input().message);
    assert.equal(f.calls.sms.length, 0);
    assert.ok(!bundle.lead.handoff_reason.includes("Private API"));
  }
});
test("failed owner notification is visible and prevents further autonomous processing", async () => {
  const f = fixture({ services: { notifications: { async send() { throw new Error("Email offline"); } } } });
  const bundle = await qualify(f);
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.lead.automation_active, false);
  assert.equal(bundle.notifications[0].status, "failed");
  assert.match(bundle.lead.handoff_reason, /notification failed/);
  assert.equal(bundle.appointments.length, 0);
});
test("unverified model dates and slot selection cannot create a calendar event", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  f.services.ai.analyze = async () => ({
    message: "Booked.", intent: "book", lead_status: "booked", qualified: true,
    ready_to_book: true, needs_human: false, answers: bundle.lead.answers,
    selected_slot_id: "invented-slot", handoff_reason: null
  });
  bundle = await f.reply(bundle, "Whenever is fine");
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.appointments.length, 0);
  assert.equal(f.calls.bookings.length, 0);
});
test("model selecting a real slot without an explicit customer choice is rejected", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  f.services.ai.analyze = async () => ({
    message: "Booked.", intent: "book", lead_status: "booked", qualified: true,
    ready_to_book: true, needs_human: false, answers: bundle.lead.answers,
    selected_slot_id: bundle.lead.offered_slots[0].id, handoff_reason: null
  });
  bundle = await f.reply(bundle, "Maybe, can I ask something?");
  assert.equal(bundle.appointments.length, 0);
  assert.equal(bundle.lead.status, "needs_human");
});
test("calendar provider uncertainty retains reservation for owner reconciliation instead of double booking", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  f.services.calendar.book = async () => { throw new Error("Provider may have accepted event"); };
  bundle = await f.reply(bundle, "1");
  assert.equal(bundle.appointments.length, 1);
  assert.equal(bundle.appointments[0].status, "pending");
  assert.equal(bundle.lead.status, "needs_human");
  await assert.rejects(f.engine.resume(f.client.id, bundle.lead.id), /Reconcile/);
});
test("two leads cannot reserve overlapping appointments even with independent processing leases", async () => {
  const f = fixture();
  const one = await qualify(f);
  const two = await qualify(f, { name: "Second Demo", idempotency_key: "second-intake" });
  const firstLease = await f.repository.acquireLease(f.client.id, one.lead.id, f.now(), 180);
  const secondLease = await f.repository.acquireLease(f.client.id, two.lead.id, f.now(), 180);
  const appointment = (bundle, id) => ({ id, lead_id: bundle.lead.id, client_id: f.client.id, slot: one.lead.offered_slots[0], status: "pending", provider_id: null, created_at: f.now() });
  const outcomes = await Promise.all([
    f.repository.reserveAppointment(firstLease.bundle, appointment(one, "reserve-1"), firstLease.token, f.now()),
    f.repository.reserveAppointment(secondLease.bundle, appointment(two, "reserve-2"), secondLease.token, f.now())
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
});
test("a provider booking notification happens once despite duplicate booking reply delivery", async () => {
  const f = fixture();
  const qualified = await qualify(f);
  const booked = await f.reply(qualified, "1", "booking-event");
  const duplicate = await f.reply(booked, "1", "booking-event");
  assert.equal(duplicate.lead.status, "booked");
  assert.equal(f.calls.bookings.length, 1);
  assert.equal(f.calls.notifications.filter(n => n.notification.event === "booked").length, 1);
});
test("follow-ups respect configured hours, capped attempts, consent and fresh inbound cancellation", async () => {
  const f = fixture();
  let bundle = await f.engine.intake(f.input({ channel: "sms", phone: "+16045550100", consent_sms: true }));
  assert.equal(bundle.lead.next_follow_up_at, "2026-10-05T18:00:00.000Z");
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.advance(bundle.lead.next_follow_up_at);
    const result = await f.engine.followUps();
    assert.equal(result.processed, 1);
    bundle = await f.repository.getBundle(f.client.id, bundle.lead.id);
    assert.equal(bundle.lead.follow_up_attempts, attempt);
  }
  assert.equal(bundle.lead.next_follow_up_at, null);
  assert.equal((await f.engine.followUps()).processed, 0);
  assert.equal(f.calls.sms.length, 4);
  const f2 = fixture();
  let second = await f2.engine.intake(f2.input({ channel: "sms", phone: "+16045550101", consent_sms: true }));
  const due = second.lead.next_follow_up_at;
  second = await f2.reply(second, "No, routine service please");
  assert.equal(second.lead.follow_up_attempts, 0);
  f2.advance(due);
  // The clock has advanced to a valid due time; current inbound must be incorporated, not overwritten.
  await f2.engine.followUps();
  second = await f2.repository.getBundle(f2.client.id, second.lead.id);
  assert.ok(second.messages.some(m => m.sender === "lead" && m.message === "No, routine service please"));
});
test("new inbound during follow-up AI suppresses the stale follow-up", async () => {
  const f = fixture();
  let bundle = await f.engine.intake(f.input({ channel: "sms", phone: "+16045550100", consent_sms: true }));
  const gate = deferred(); const started = deferred();
  f.services.ai.analyze = async input => {
    if (input.reason === "follow_up") { started.resolve(); await gate.promise; }
    return f.mock.ai.analyze(input);
  };
  f.advance(bundle.lead.next_follow_up_at);
  const running = f.engine.followUps();
  await started.promise;
  bundle = await f.reply(bundle, "No, not an emergency.");
  gate.resolve();
  const result = await running;
  assert.equal(result.skipped, 1);
  assert.equal(f.calls.sms.length, 2);
  assert.equal(bundle.lead.follow_up_attempts, 0);
});
test("business-hour scheduling accounts for weekends and client timezone", () => {
  const client = newDemoClient();
  assert.equal(insideBusinessHours(client, new Date("2026-10-05T15:00:00Z")), true);
  assert.equal(insideBusinessHours(client, new Date("2026-10-05T14:59:00Z")), false);
  assert.equal(nextBusinessTime(client, new Date("2026-10-04T12:00:00Z")), "2026-10-05T15:00:00.000Z");
});
test("inactive clients reject intake and an expired lease cannot save or reserve", async () => {
  const f = fixture({ client: { active: false } });
  await assert.rejects(f.engine.intake(f.input()), /not currently accepting/);
  const active = fixture();
  const bundle = await active.engine.intake(active.input());
  const lease = await active.repository.acquireLease(active.client.id, bundle.lead.id, active.now(), 1);
  active.advance("2026-10-05T16:00:02.000Z");
  assert.equal(await active.repository.saveBundle(lease.bundle, lease.token, active.now()), null);
  assert.equal(await active.repository.leaseValid(active.client.id, bundle.lead.id, lease.token, bundle.lead.version, active.now()), false);
});
test("all credential-free demo providers make zero network calls even when a network implementation exists", async () => {
  const original = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Network forbidden in demo"); };
  try {
    const f = fixture();
    let bundle = await qualify(f);
    bundle = await f.reply(bundle, "1");
    assert.equal(bundle.lead.status, "booked");
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = original; }
});


test("complete answers plus an AI unsuitable verdict cannot qualify or offer booking", async () => {
  const f = fixture({ services: { ai: { async analyze() { return {
    message: "I cannot confirm we can help.", intent: "answer", lead_status: "responding",
    qualified: false, ready_to_book: false, needs_human: false,
    answers: { service: "Roof replacement", emergency: "No", area: "Outside service area", timing: "Tomorrow" },
    selected_slot_id: null, handoff_reason: null
  }; } } } });
  const bundle = await f.engine.intake(f.input());
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.lead.qualification_status, "unqualified");
  assert.equal(bundle.appointments.length, 0);
  assert.ok(!bundle.notifications.some(n => n.event === "qualified"));
  assert.equal(f.calls.sms.length, 0);
});
test("an older AI failure after newer inbound succeeds cannot hand off the healthy lead", async () => {
  const gate = deferred(); const started = deferred();
  const f = fixture();
  let invocation = 0;
  f.services.ai.analyze = async input => {
    if (++invocation === 1) { started.resolve(); await gate.promise; throw new Error("Old provider failure"); }
    return f.mock.ai.analyze(input);
  };
  const pending = f.engine.intake(f.input());
  await started.promise;
  let current = (await f.repository.listLeads())[0];
  current = await f.reply(current, "It is not an emergency.");
  assert.equal(current.lead.automation_active, true);
  gate.resolve();
  const result = await pending;
  assert.equal(result.lead.automation_active, true);
  assert.notEqual(result.lead.status, "needs_human");
  assert.equal(result.notifications.length, 0);
  assert.equal(f.calls.sms.length, 1);
});
test("an older provider rejection after STOP preserves opt-out and does not duplicate notification", async () => {
  const gate = deferred(); const started = deferred();
  const f = fixture();
  f.services.ai.analyze = async () => { started.resolve(); await gate.promise; throw new Error("Old provider failure"); };
  const pending = f.engine.intake(f.input());
  await started.promise;
  const current = (await f.repository.listLeads())[0];
  await f.reply(current, "STOP");
  gate.resolve();
  const result = await pending;
  assert.equal(result.lead.opted_out, true);
  assert.equal(result.lead.automation_active, false);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].event, "needs_human");
});
test("duplicate STOP delivery applies opt-out when the first handler stopped after inbound persistence", async () => {
  const f = fixture();
  const bundle = await f.engine.intake(f.input({ channel: "sms", phone: "+16045550100", consent_sms: true }));
  const message = { ...bundle.messages[0], id: "stored-stop", message: "STOP", idempotency_key: "stop-event", timestamp: f.now() };
  await f.repository.appendInbound(f.client.id, bundle.lead.id, message, "stop-event");
  const result = await f.reply(bundle, "STOP", "stop-event");
  assert.equal(result.lead.opted_out, true);
  assert.equal(result.lead.automation_active, false);
  assert.equal(result.lead.consent_sms, false);
  assert.equal(result.messages.filter(m => m.sender === "lead" && m.message === "STOP").length, 1);
});
test("live configuration requires a dedicated SMS number and a notification email", () => {
  const live = { ...newDemoClient(), mode: "live", calendar: { ...newDemoClient().calendar, provider: "google" } };
  assert.throws(() => validateClient({ ...live, phone_number: "" }), /dedicated international/);
  assert.throws(() => validateClient({ ...live, notification_email: "" }), /notification email/);
});


test("booked lead replying thanks remains booked with one appointment and no new offers", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  bundle = await f.reply(bundle, "1");
  bundle = await f.reply(bundle, "Thank you!");
  assert.equal(bundle.lead.status, "booked");
  assert.equal(bundle.lead.appointment_status, "booked");
  assert.equal(bundle.appointments.length, 1);
  assert.equal(f.calls.bookings.length, 1);
  assert.equal(bundle.lead.next_follow_up_at, null);
  assert.match(bundle.messages.at(-1).message, /already|recorded/);
});
test("an AI attempt to reoffer booking after booking cannot create another appointment", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  bundle = await f.reply(bundle, "1");
  f.services.ai.analyze = async () => ({
    message: "Choose a new time", intent: "offer_booking", lead_status: "booking", qualified: true,
    ready_to_book: true, needs_human: false, answers: bundle.lead.answers, selected_slot_id: null, handoff_reason: null
  });
  bundle = await f.reply(bundle, "Thanks");
  assert.equal(bundle.lead.status, "booked");
  assert.equal(bundle.appointments.length, 1);
  assert.equal(f.calls.bookings.length, 1);
  assert.match(bundle.messages.at(-1).message, /already recorded/);
});
test("rescheduling a booked appointment hands off without creating or changing events", async () => {
  const f = fixture();
  let bundle = await qualify(f);
  bundle = await f.reply(bundle, "1");
  const original = bundle.appointments[0];
  bundle = await f.reply(bundle, "Can I reschedule?");
  assert.equal(bundle.lead.status, "needs_human");
  assert.equal(bundle.lead.appointment_status, "booked");
  assert.deepEqual(bundle.appointments[0], original);
  assert.equal(f.calls.bookings.length, 1);
});
test("won or lost leads retain terminal state and cannot be automatically resumed", async () => {
  for (const status of ["won", "lost"]) {
    const f = fixture();
    const bundle = await f.engine.intake(f.input());
    const lease = await f.repository.acquireLease(f.client.id, bundle.lead.id, f.now(), 180);
    lease.bundle.lead.status = status; lease.bundle.lead.automation_active = false;
    await f.repository.saveBundle(lease.bundle, lease.token, f.now());
    await f.repository.releaseLease(f.client.id, bundle.lead.id, lease.token);
    const sent = f.calls.sms.length;
    const result = await f.reply(bundle, "Hello again");
    assert.equal(result.lead.status, status);
    assert.equal(f.calls.sms.length, sent);
    await assert.rejects(f.engine.resume(f.client.id, bundle.lead.id), /Closed leads/);
  }
});


test("new intake key for an existing SMS phone adds a message without a duplicate lead or renewed consent", async () => {
  const f = fixture();
  const input = f.input({ channel: "sms", phone: "+16045550100", consent_sms: true });
  const first = await f.engine.intake(input);
  const next = await f.engine.intake({ ...input, message: "No, it can wait.", idempotency_key: "intake-2" });
  assert.equal(next.lead.id, first.lead.id);
  assert.equal((await f.repository.listLeads()).length, 1);
  assert.equal(next.messages.filter(m => m.sender === "lead").length, 2);
  assert.equal(next.lead.answers.emergency, "No, it can wait.");
  const sent = f.calls.sms.length;
  const replay = await f.engine.intake({ ...input, message: "Modified duplicate text", idempotency_key: "intake-2" });
  assert.equal(replay.messages.filter(m => m.sender === "lead").length, 2);
  assert.equal(f.calls.sms.length, sent);
  const paused = await f.reply(next, "STOP");
  const afterNewIntake = await f.engine.intake({ ...input, message: "Another form enquiry", idempotency_key: "intake-3" });
  assert.equal(afterNewIntake.lead.id, paused.lead.id);
  assert.equal(afterNewIntake.lead.opted_out, true);
  assert.equal(afterNewIntake.lead.consent_sms, false);
  assert.equal(afterNewIntake.lead.automation_active, false);
  assert.equal(f.calls.sms.length, sent);
});
test("inbound arriving during failure CAS cannot be overwritten by the old failure handoff", async () => {
  const f = fixture();
  const save = f.repository.saveBundle.bind(f.repository);
  const originalAI = f.mock.ai.analyze.bind(f.mock.ai);
  let first = true; let injected = false;
  f.services.ai.analyze = async input => {
    if (first) { first = false; throw new Error("Initial provider failure"); }
    return originalAI(input);
  };
  f.repository.saveBundle = async (bundle, token, now) => {
    if (bundle.lead.status === "needs_human" && !injected) {
      injected = true;
      await f.reply(bundle, "It is not an emergency.", "racing-inbound");
    }
    return save(bundle, token, now);
  };
  const result = await f.engine.intake(f.input());
  assert.equal(result.lead.automation_active, true);
  assert.notEqual(result.lead.status, "needs_human");
  assert.equal(result.notifications.length, 0);
  assert.equal(f.calls.sms.length, 1);
  assert.equal(result.messages.filter(m => m.sender === "lead").length, 2);
});
