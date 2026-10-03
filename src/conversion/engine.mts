import { ConversionError } from "./contracts.mjs";
import type { AIResult, Appointment, ClientConfig, EngineDependencies, InboundInput, IntakeInput, LeadBundle, Message, Notification, Slot } from "./contracts.mjs";
import { validateInbound, validateIntake } from "./validation.mjs";
import { insideBusinessHours, scheduleFollowUp } from "./time.mjs";

export function safetyHandoff(message: string): { reason: string; optedOut: boolean } | null {
  const text = message.trim();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)[.!]?$/i.test(text) ||
    /\b(?:stop (?:texting|messaging|contacting|sending)|do not (?:text|contact|message)|don't (?:text|contact|message))\b/i.test(text)) return { reason: "Customer opted out. Automatic contact is disabled.", optedOut: true };
  if (/\b(?:human|real person|speak to someone|talk to someone|call me instead|speak to the owner)\b/i.test(text)) return { reason: "Customer requested a person.", optedOut: false };
  if (/\b(?:gas leak|smell (?:of )?gas|electrocution|suicid(?:e|al)|kill myself|immediate danger|house (?:is )?on fire)\b/i.test(text)) return { reason: "Potentially sensitive or dangerous situation requires a person.", optedOut: false };
  if (/\b(?:furious|very angry|lawsuit|scam|idiot)\b/i.test(text)) return { reason: "Customer frustration requires a person.", optedOut: false };
  return null;
}
function validateAIResult(result: AIResult): void {
  if (!result || typeof result.message !== "string" || !result.message.trim() || result.message.length > 1200 ||
    !["qualify", "offer_booking", "book", "handoff", "answer", "follow_up"].includes(result.intent) ||
    typeof result.needs_human !== "boolean" || typeof result.qualified !== "boolean" || typeof result.ready_to_book !== "boolean" ||
    !result.answers || typeof result.answers !== "object" || Array.isArray(result.answers) ||
    (result.selected_slot_id !== null && typeof result.selected_slot_id !== "string")) throw new ConversionError("invalid_ai_output", "AI output was not safe to process.", 502);
}
class StaleWork extends Error {}
type Work = { bundle: LeadBundle; token: string; client: ClientConfig };
export class ConversionEngine {
  private readonly deps: EngineDependencies;
  private readonly clock: () => Date;
  private readonly uuid: () => string;
  constructor(dependencies: EngineDependencies) {
    this.deps = dependencies; this.clock = dependencies.now ?? (() => new Date());
    this.uuid = dependencies.uuid ?? (() => globalThis.crypto.randomUUID());
  }
  private now(): string { return this.clock().toISOString(); }
  private async client(clientId: string): Promise<ClientConfig> {
    const client = await this.deps.repository.getClient(clientId);
    if (!client) throw new ConversionError("client_not_found", "Business not found.", 404);
    return client;
  }
  private message(bundle: LeadBundle, text: string, sender: Message["sender"], eventKey: string): Message {
    return {
      id: this.uuid(), lead_id: bundle.lead.id, client_id: bundle.lead.client_id, sender, message: text,
      channel: bundle.lead.channel, timestamp: this.now(), ai: sender === "assistant",
      status: sender === "lead" ? "received" : "pending", provider_id: null, idempotency_key: eventKey
    };
  }
  async intake(raw: IntakeInput): Promise<LeadBundle> {
    const input = validateIntake(raw); const client = await this.client(input.client_id);
    if (!client.active) throw new ConversionError("client_inactive", "This business's automation is not currently accepting leads.", 403);
    const now = this.now();
    const bundle: LeadBundle = {
      lead: {
        id: this.uuid(), client_id: client.id, name: input.name, phone: input.phone ?? "", email: input.email ?? "",
        original_message: input.message, source: input.source ?? "website", created_at: now, updated_at: now,
        status: "new", qualification_status: "pending", appointment_status: "none",
        last_contacted_at: null, last_inbound_at: now, next_follow_up_at: null, follow_up_attempts: 0,
        answers: {}, offered_slots: [], automation_active: true, consent_sms: input.consent_sms === true,
        opted_out: false, mode: client.mode, channel: input.channel ?? "website", version: 0, handoff_reason: null
      }, messages: [], appointments: [], notifications: []
    };
    bundle.messages.push(this.message(bundle, input.message, "lead", input.idempotency_key));
    const saved = await this.deps.repository.createLead(bundle, input.idempotency_key);
    if (!saved.created) {
      if (saved.bundle.messages.some(message => message.idempotency_key === input.idempotency_key)) return saved.bundle;
      // A second website/SMS intake from an existing phone is another inbound message,
      // not another independent conversation. Preserve the original consent and channel.
      return this.receive({ client_id: client.id, lead_id: saved.bundle.lead.id, message: input.message,
        channel: saved.bundle.lead.channel, event_key: input.idempotency_key });
    }
    await this.process(client.id, bundle.lead.id, "inbound");
    return (await this.deps.repository.getBundle(client.id, bundle.lead.id))!;
  }
  async receive(raw: InboundInput): Promise<LeadBundle> {
    const input = validateInbound(raw); await this.client(input.client_id);
    const existing = await this.deps.repository.getBundle(input.client_id, input.lead_id);
    if (!existing) throw new ConversionError("not_found", "Lead not found.", 404);
    if ((input.channel ?? "website") !== existing.lead.channel) throw new ConversionError("channel_mismatch", "Reply channel does not match this lead.", 409);
    const inbound = this.message(existing, input.message, "lead", input.event_key);
    const saved = await this.deps.repository.appendInbound(input.client_id, input.lead_id, inbound, input.event_key);
    const safety = safetyHandoff(input.message);
    // Replay safety commands even when the original handler stopped after persisting the webhook.
    if (safety && (saved.bundle.lead.automation_active || (safety.optedOut && !saved.bundle.lead.opted_out))) {
      await this.stopAndNotify(input.client_id, input.lead_id, safety.reason, safety.optedOut);
    } else if (!saved.created) {
      return saved.bundle;
    } else if (saved.bundle.lead.automation_active && !saved.bundle.lead.opted_out) {
      await this.process(input.client_id, input.lead_id, "inbound");
    }
    return (await this.deps.repository.getBundle(input.client_id, input.lead_id))!;
  }
  async handoff(clientId: string, leadId: string, reason = "Paused by the business owner."): Promise<LeadBundle | null> {
    await this.stopAndNotify(clientId, leadId, reason, false);
    return this.deps.repository.getBundle(clientId, leadId);
  }
  async resume(clientId: string, leadId: string): Promise<LeadBundle | null> {
    const client = await this.client(clientId);
    if (!client.active) throw new ConversionError("client_inactive", "Activate the business before resuming a lead.", 409);
    return this.deps.repository.resumeLead(clientId, leadId, this.now());
  }
  private async valid(work: Work, requireAutomation = true): Promise<void> {
    const valid = await this.deps.repository.leaseValid(work.client.id, work.bundle.lead.id, work.token, work.bundle.lead.version, this.now());
    const currentClient = await this.deps.repository.getClient(work.client.id);
    if (!valid || !currentClient || (requireAutomation && (!currentClient.active || !work.bundle.lead.automation_active || work.bundle.lead.opted_out))) throw new StaleWork();
    if (work.bundle.lead.mode !== currentClient.mode) throw new ConversionError("mode_mismatch", "Lead mode cannot change after intake.", 409);
  }
  private async save(work: Work): Promise<void> {
    const saved = await this.deps.repository.saveBundle(work.bundle, work.token, this.now());
    if (!saved) throw new StaleWork(); work.bundle = saved;
  }
  private async notify(work: Work, event: Notification["event"], text: string): Promise<void> {
    if (work.bundle.notifications.some(n => n.event === event && n.status !== "failed")) return;
    await this.valid(work, false);
    const notification: Notification = {
      id: this.uuid(), client_id: work.client.id, lead_id: work.bundle.lead.id, event,
      message: text.slice(0, 2000), created_at: this.now(), status: "pending", provider_id: null
    };
    work.bundle.notifications.push(notification); await this.save(work); await this.valid(work, false);
    try {
      const sent = await this.deps.notifications.send({ client: work.client, lead: work.bundle.lead, notification });
      await this.valid(work, false);
      const stored = work.bundle.notifications.find(n => n.id === notification.id)!;
      stored.status = "sent"; stored.provider_id = sent.provider_id; await this.save(work);
    } catch (error) {
      if (error instanceof StaleWork) throw error;
      const stored = work.bundle.notifications.find(n => n.id === notification.id)!;
      stored.status = "failed"; await this.save(work);
      // A failed notification must stay visible; never recursively notify about a notifier failure.
      work.bundle.lead.handoff_reason = (work.bundle.lead.handoff_reason ?? "") + " Business email notification failed; check the owner dashboard.";
      if (event !== "needs_human" && event !== "automation_failed") {
        work.bundle.lead.status = "needs_human"; work.bundle.lead.automation_active = false;
        work.bundle.lead.next_follow_up_at = null;
      }
      await this.save(work);
    }
  }
  private async pause(work: Work, reason: string, failed = false): Promise<void> {
    // Worker-derived handoff is a CAS under the processing lease. An intervening
    // inbound/owner action must make this write fail instead of pausing newer work.
    work.bundle.lead.status = "needs_human"; work.bundle.lead.automation_active = false;
    work.bundle.lead.handoff_reason = reason; work.bundle.lead.next_follow_up_at = null;
    await this.save(work);
    await this.notify(work, failed ? "automation_failed" : "needs_human", reason);
  }
  private async stopAndNotify(clientId: string, leadId: string, reason: string, optedOut: boolean, failed = false): Promise<void> {
    const stopped = await this.deps.repository.forceHandoff(clientId, leadId, reason, this.now(), optedOut);
    if (!stopped) return;
    const client = await this.client(clientId);
    const lease = await this.deps.repository.acquireLease(clientId, leadId, this.now(), 180);
    if (!lease) return;
    try {
      await this.notify({ bundle: lease.bundle, token: lease.token, client }, failed ? "automation_failed" : "needs_human", reason);
    } catch (error) { if (!(error instanceof StaleWork)) throw error; }
    finally { await this.deps.repository.releaseLease(clientId, leadId, lease.token); }
  }
  private async deliver(work: Work, text: string, responseKey: string): Promise<void> {
    await this.valid(work);
    if (work.bundle.lead.channel === "sms" && (!work.bundle.lead.consent_sms || !work.bundle.lead.phone)) throw new ConversionError("consent_required", "No SMS was sent without consent.", 409);
    if (work.bundle.messages.some(m => m.idempotency_key === responseKey)) return;
    const message = this.message(work.bundle, text, "assistant", responseKey);
    work.bundle.messages.push(message); await this.save(work); await this.valid(work);
    try {
      const sent = await this.deps.messaging.send({ client: work.client, lead: work.bundle.lead, message });
      await this.valid(work);
      const stored = work.bundle.messages.find(m => m.id === message.id)!;
      stored.status = sent.status; stored.provider_id = sent.provider_id; stored.timestamp = this.now();
      work.bundle.lead.last_contacted_at = this.now();
      if (["new", "responding"].includes(work.bundle.lead.status)) work.bundle.lead.status = work.bundle.messages.filter(m => m.sender === "lead").length === 1 ? "contacted" : "responding";
      work.bundle.lead.next_follow_up_at = this.canFollowUp(work.bundle, work.client) ? scheduleFollowUp(work.client, this.clock(), work.bundle.lead.follow_up_attempts) : null;
      await this.save(work);
    } catch (error) {
      if (error instanceof StaleWork) throw error;
      // A network failure may mean the provider accepted the SMS. Never automatically retry.
      const stored = work.bundle.messages.find(m => m.id === message.id)!;
      stored.status = "unknown"; await this.save(work);
      throw new ConversionError("message_delivery_uncertain", "Message delivery is uncertain and requires human review.", 502);
    }
  }
  private canFollowUp(bundle: LeadBundle, client: ClientConfig): boolean {
    return client.follow_up_enabled && ((bundle.lead.channel === "sms" && bundle.lead.consent_sms) || (client.mode === "demo" && bundle.lead.channel === "website")) &&
      bundle.lead.automation_active && !bundle.lead.opted_out && !["booked", "won", "lost", "needs_human"].includes(bundle.lead.status) &&
      bundle.lead.follow_up_attempts < client.max_follow_up_attempts;
  }
  private cleanSlots(slots: Slot[], client: ClientConfig): Slot[] {
    if (!Array.isArray(slots)) throw new ConversionError("invalid_calendar_output", "Calendar returned invalid availability.", 502);
    const ids = new Set<string>(); const now = this.clock().getTime();
    return slots.filter(slot => {
      if (!slot || typeof slot.id !== "string" || slot.id.length > 160 || ids.has(slot.id) || typeof slot.label !== "string" || slot.label.length > 200) return false;
      const start = new Date(slot.start); const end = new Date(slot.end);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() <= now ||
        end.getTime() - start.getTime() !== client.calendar.duration_minutes * 60000 ||
        start.getTime() > now + client.calendar.horizon_days * 86400000 ||
        !insideBusinessHours(client, start, client.calendar.duration_minutes + client.calendar.buffer_minutes)) return false;
      ids.add(slot.id); return true;
    }).slice(0, 3);
  }
  private chosenSlot(bundle: LeadBundle, result: AIResult): Slot | null {
    if (!result.selected_slot_id) return null;
    const slot = bundle.lead.offered_slots.find(s => s.id === result.selected_slot_id);
    if (!slot) return null;
    const latest = bundle.messages.filter(m => m.sender === "lead").at(-1)?.message.trim().toLowerCase() ?? "";
    const index = bundle.lead.offered_slots.indexOf(slot) + 1;
    // Calendar changes are side effects: require an explicit customer choice, never just the model's claim.
    const number = new RegExp("^(?:option|slot|appointment|time)?\\s*" + index + "(?:\\s*(?:please|works|works for me))?[.!]?$", "i");
    const ordinal = ["first", "second", "third"][index - 1];
    return latest === slot.id.toLowerCase() || number.test(latest) || new RegExp("^" + ordinal + "(?:\\s+(?:one|option))?(?:\\s+please)?[.!]?$", "i").test(latest) ? slot : null;
  }
  private async book(work: Work, slot: Slot): Promise<void> {
    await this.valid(work);
    if (new Date(slot.start).getTime() <= this.clock().getTime()) throw new ConversionError("slot_expired", "Selected appointment has expired.", 409);
    if (work.bundle.appointments.some(a => a.status === "booked" || a.status === "pending")) throw new ConversionError("appointment_exists", "An appointment is already booked or pending.", 409);
    // Re-check live provider availability immediately before reserving/creating.
    const fresh = this.cleanSlots(await this.deps.calendar.available({ client: work.client, lead: work.bundle.lead, now: this.now() }), work.client);
    await this.valid(work);
    if (!fresh.some(s => s.start === slot.start && s.end === slot.end)) {
      work.bundle.lead.offered_slots = fresh; work.bundle.lead.appointment_status = fresh.length ? "offered" : "none";
      await this.save(work);
      if (!fresh.length) throw new ConversionError("no_availability", "No appointment availability remains.", 409);
      await this.deliver(work, "That time is no longer available. Please choose a current option:\n" + fresh.map((s, i) => (i + 1) + ". " + s.label).join("\n"), "availability:" + work.bundle.messages.filter(m => m.sender === "lead").at(-1)!.id);
      return;
    }
    const appointment: Appointment = { id: this.uuid(), lead_id: work.bundle.lead.id, client_id: work.client.id, slot, status: "pending", provider_id: null, created_at: this.now() };
    const reserved = await this.deps.repository.reserveAppointment(work.bundle, appointment, work.token, this.now());
    if (!reserved) throw new ConversionError("slot_conflict", "The appointment was reserved by another lead. Human review is required.", 409);
    work.bundle = reserved; await this.valid(work);
    const created = await this.deps.calendar.book({ client: work.client, lead: work.bundle.lead, appointment });
    await this.valid(work);
    const saved = work.bundle.appointments.find(a => a.id === appointment.id)!;
    saved.status = "booked"; saved.provider_id = created.provider_id;
    work.bundle.lead.appointment_status = "booked"; work.bundle.lead.status = "booked"; work.bundle.lead.next_follow_up_at = null;
    await this.save(work);
    await this.deliver(work, (work.client.mode === "demo" ? "Simulated appointment confirmed: " : "Appointment confirmed: ") + slot.label + ". " + work.client.business_name + " has the appointment details.", "booking:" + appointment.id);
    await this.notify(work, "booked", "Appointment booked for " + work.bundle.lead.name + ": " + slot.label + ".");
  }
  private async process(clientId: string, leadId: string, reason: "inbound" | "follow_up"): Promise<"processed" | "skipped" | "failed"> {
    const client = await this.client(clientId);
    const lease = await this.deps.repository.acquireLease(clientId, leadId, this.now(), 180);
    if (!lease) return "skipped";
    const work: Work = { bundle: lease.bundle, token: lease.token, client };
    try {
      await this.valid(work);
      if (["won", "lost"].includes(work.bundle.lead.status)) return "skipped";
      if (work.bundle.messages.some(m => m.status === "pending" || m.status === "unknown") ||
        work.bundle.appointments.some(a => a.status === "pending")) throw new ConversionError("reconcile_required", "A previous provider operation is uncertain; human review is required.", 409);
      const latestInbound = work.bundle.messages.filter(m => m.sender === "lead").at(-1)!;
      const responseKey = reason === "inbound" ? "reply:" + latestInbound.id : "follow-up:" + latestInbound.id + ":" + work.bundle.lead.follow_up_attempts;
      if (work.bundle.messages.some(m => m.idempotency_key === responseKey)) return "skipped";
      if (reason === "inbound") {
        const safety = safetyHandoff(latestInbound.message);
        if (safety) {
          await this.deps.repository.releaseLease(clientId, leadId, work.token);
          await this.stopAndNotify(clientId, leadId, safety.reason, safety.optedOut); return "processed";
        }
      } else {
        if (!this.canFollowUp(work.bundle, client) || !work.bundle.lead.next_follow_up_at || work.bundle.lead.next_follow_up_at > this.now()) return "skipped";
        if (!insideBusinessHours(client, this.clock())) return "skipped";
        // A newer inbound invalidates both version and lease; guards repeat after each provider call.
      }
      const result = await this.deps.ai.analyze({ client, bundle: structuredClone(work.bundle), reason });
      await this.valid(work); validateAIResult(result);
      for (const question of client.qualifying_questions) {
        const answer = Object.hasOwn(result.answers, question.id) ? result.answers[question.id] : undefined;
        if (typeof answer === "string" && answer.trim() && answer.length <= 500) work.bundle.lead.answers[question.id] = answer.trim();
      }
      if (result.needs_human || result.intent === "handoff") {
        await this.pause(work, result.handoff_reason?.slice(0, 500) || "AI could not confidently assist.");
        return "processed";
      }
      const allRequired = client.qualifying_questions.every(q => !q.required || !!work.bundle.lead.answers[q.id]);
      const wasQualified = work.bundle.lead.qualification_status === "qualified";
      if (allRequired && !result.qualified) {
        work.bundle.lead.qualification_status = "unqualified";
        await this.pause(work, "Required answers are present, but AI could not confirm this is a suitable lead. A person must review.");
        return "processed";
      }
      if (allRequired && result.qualified) {
        work.bundle.lead.qualification_status = "qualified";
        if (work.bundle.lead.status !== "booked") work.bundle.lead.status = "qualified";
      }
      await this.save(work);
      if (allRequired && !wasQualified) {
        await this.notify(work, "qualified", "Qualified lead: " + work.bundle.lead.name + ". " + Object.entries(work.bundle.lead.answers).map(([id, answer]) => id + ": " + answer).join("; "));
        if (!work.bundle.lead.automation_active) return "processed";
      }
      if (reason === "follow_up") {
        work.bundle.lead.follow_up_attempts++;
        await this.save(work);
        await this.deliver(work, result.message, responseKey); return "processed";
      }
      if (work.bundle.lead.appointment_status === "booked") {
        work.bundle.lead.status = "booked"; work.bundle.lead.next_follow_up_at = null;
        await this.save(work);
        const existing = work.bundle.appointments.find(a => a.status === "booked");
        const text = result.intent === "book" || result.intent === "offer_booking" || result.ready_to_book
          ? "Your appointment is already recorded" + (existing ? " for " + existing.slot.label : "") + ". Ask for a person if you need to change it."
          : result.message;
        await this.deliver(work, text, responseKey); return "processed";
      }
      const slot = allRequired && client.booking_enabled ? this.chosenSlot(work.bundle, result) : null;
      if (result.intent === "book" && !slot) throw new ConversionError("invalid_slot_choice", "The customer must explicitly choose a stored appointment option.", 409);
      if (slot) { await this.book(work, slot); return "processed"; }
      if (allRequired && client.booking_enabled && (result.ready_to_book || result.intent === "offer_booking")) {
        if (!work.bundle.lead.offered_slots.length || work.bundle.lead.offered_slots.some(s => new Date(s.start).getTime() <= this.clock().getTime())) {
          const slots = this.cleanSlots(await this.deps.calendar.available({ client, lead: work.bundle.lead, now: this.now() }), client);
          await this.valid(work);
          if (!slots.length) throw new ConversionError("no_availability", "A person needs to arrange availability.", 409);
          work.bundle.lead.offered_slots = slots;
        }
        work.bundle.lead.status = "booking"; work.bundle.lead.appointment_status = "offered"; await this.save(work);
        await this.deliver(work, "Thanks, we have the details needed. " + (client.mode === "demo" ? "Here are simulated appointment options:\n" : "Here are available appointment options:\n") +
          work.bundle.lead.offered_slots.map((s, i) => (i + 1) + ". " + s.label).join("\n") + "\nReply 1, 2, or 3 to choose a time, or ask for a person.", responseKey);
      } else {
        if (!allRequired && result.ready_to_book) throw new ConversionError("qualification_incomplete", "Required qualification answers are missing.", 502);
        await this.deliver(work, result.message, responseKey);
      }
      return "processed";
    } catch (error) {
      if (error instanceof StaleWork) return "skipped";
      // A rejected provider request can resolve after another inbound worker took over.
      // CAS the failure while holding the old lease; never use unconditional forceHandoff.
      try {
        await this.pause(work, error instanceof ConversionError ? error.message : "Automation failed safely. A person must review this lead.", true);
        return "failed";
      } catch (pauseError) {
        if (pauseError instanceof StaleWork) return "skipped";
        throw pauseError;
      }
    } finally { await this.deps.repository.releaseLease(clientId, leadId, work.token); }
  }
  async followUps(limit = 25): Promise<{ processed: number; skipped: number; failed: number }> {
    const due = await this.deps.repository.dueFollowUps(this.now(), Math.min(100, Math.max(1, limit)));
    const totals = { processed: 0, skipped: 0, failed: 0 };
    for (const lead of due) {
      const outcome = await this.process(lead.client_id, lead.lead_id, "follow_up"); totals[outcome]++;
    }
    return totals;
  }
}
