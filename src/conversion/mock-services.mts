import { ConversionError } from "./contracts.mjs";
import type { AIResult, AIService, CalendarService, ClientConfig, LeadBundle, MessagingService, NotificationService, Question } from "./contracts.mjs";
import { demoSlots } from "./time.mjs";
function demoOnly(client: ClientConfig): void {
  if (client.mode !== "demo") throw new ConversionError("demo_only", "Demo adapters never serve live clients.", 503);
}
const stem = (word: string) => word.toLowerCase().replace(/(?:ing|s)$/, "");
const words = (text: string) => (text.toLowerCase().match(/[a-z]+/g) ?? []).map(stem);
const filler = new Set(["emergency", "repair", "service", "clean", "cleaning", "the", "and", "a", "for"]);
function serviceMatch(client: ClientConfig, text: string): string | null {
  const tokens = new Set(words(text));
  return client.services.find(service => words(service).filter(word => !filler.has(word)).some(word => tokens.has(word))) ?? null;
}
function questionKind(question: Question): "service" | "emergency" | "area" | "timing" | "other" {
  const prompt = question.prompt.toLowerCase();
  if (/emergency|urgent/.test(prompt)) return "emergency";
  if (/area|location|located|postcode|zip code|city/.test(prompt)) return "area";
  if (/when|timing|date|time.*service/.test(prompt)) return "timing";
  if (/service|what.*need|what.*help/.test(prompt)) return "service";
  return "other";
}
export function demoSelectedSlot(bundle: LeadBundle, text: string): string | null {
  const normalized = text.trim().toLowerCase();
  const direct = bundle.lead.offered_slots.find(s => s.id.toLowerCase() === normalized);
  if (direct) return direct.id;
  const ordinal = /^(?:option|slot|appointment|time)?\s*([1-3])(?:\s*(?:please|works|works for me))?[.!]?$/.exec(normalized)?.[1] ??
    ({ first: "1", second: "2", third: "3" } as Record<string, string>)[normalized.replace(/\s+(one|option|please).*$/, "")];
  return ordinal ? bundle.lead.offered_slots[Number(ordinal) - 1]?.id ?? null : null;
}
/** Deterministic simulation: configured questions drive the flow; this is not an LLM and makes no network calls. */
export class DemoAIService implements AIService {
  async analyze({ client, bundle, reason }: Parameters<AIService["analyze"]>[0]): Promise<AIResult> {
    demoOnly(client);
    const answers: Record<string, string> = { ...bundle.lead.answers };
    const inbound = bundle.messages.filter(m => m.sender === "lead");
    const latest = inbound.at(-1)?.message ?? bundle.lead.original_message;
    const previousAssistant = bundle.messages.filter(m => m.sender === "assistant" && m.status === "sent").at(-1)?.message ?? "";
    const result = (message: string, overrides: Partial<AIResult> = {}): AIResult => ({
      message, intent: "qualify", lead_status: "responding", qualified: false, ready_to_book: false,
      needs_human: false, answers, selected_slot_id: null, handoff_reason: null, ...overrides
    });
    if (reason === "follow_up") {
      return result("Hi " + bundle.lead.name.split(" ")[0] + ", would you like to continue your enquiry with " + client.business_name + "? " +
        (bundle.lead.offered_slots.length ? "Reply with one of the offered appointment options, or ask for a person." : (client.qualifying_questions.find(q => q.required && !answers[q.id])?.prompt ?? "Let us know how we can help.")), {
        intent: "follow_up", lead_status: bundle.lead.status, qualified: bundle.lead.qualification_status === "qualified"
      });
    }
    const awaiting = client.qualifying_questions.find(q => !answers[q.id] && previousAssistant.includes(q.prompt));
    if (awaiting) {
      if (/^(?:i\s+)?(?:don't know|do not know|not sure|unsure)/i.test(latest)) {
        return result("A person can help you work through that.", { intent: "handoff", needs_human: true, handoff_reason: "The customer needs help answering a qualifying question." });
      }
      if (questionKind(awaiting) === "emergency" && /^(yes|yeah|yep|urgent|emergency)\b/i.test(latest)) {
        return result("This needs a person to review it promptly.", { intent: "handoff", needs_human: true, handoff_reason: "Emergency request." });
      }
      if (questionKind(awaiting) === "service" && !serviceMatch(client, latest)) {
        return result("A person will check whether we can help with that request.", { intent: "handoff", needs_human: true, handoff_reason: "Requested service is outside or uncertain against the configured services." });
      }
      answers[awaiting.id] = latest.slice(0, 500);
    }
    // Only infer obvious service and non-emergency details; other answers are collected by the configured questions.
    for (const question of client.qualifying_questions) {
      if (answers[question.id]) continue;
      if (questionKind(question) === "service") {
        const match = serviceMatch(client, latest); if (match) answers[question.id] = match;
      } else if (questionKind(question) === "emergency" && /\b(?:not an? emergency|not urgent|no emergency|can wait|routine)\b/i.test(latest)) answers[question.id] = "Routine / not an emergency";
    }
    const missing = client.qualifying_questions.find(q => q.required && !answers[q.id]);
    if (missing) return result((inbound.length === 1 ? "Thanks for contacting " + client.business_name + ". " : "Thanks. ") + missing.prompt);
    if (bundle.lead.appointment_status === "booked") {
      if (/\b(?:cancel|change|reschedul\w*|different|another appointment|move.*appointment)\b/i.test(latest)) {
        return result("A person can help change your existing appointment.", {
          intent: "handoff", needs_human: true, qualified: true, handoff_reason: "The customer requested a booking change."
        });
      }
      const appointment = bundle.appointments.find(a => a.status === "booked");
      return result("You're welcome. Your simulated appointment is recorded" + (appointment ? " for " + appointment.slot.label : "") + ". Ask for a person if you need to change it.", {
        intent: "answer", lead_status: "booked", qualified: true, ready_to_book: false
      });
    }
    const selected = demoSelectedSlot(bundle, latest);
    if (selected) return result("I'll request the appointment you selected.", {
      intent: "book", lead_status: "booking", qualified: true, ready_to_book: true, selected_slot_id: selected
    });
    return result(bundle.lead.offered_slots.length ? "Which appointment would you prefer? Reply 1, 2, or 3, or ask for a person." : "Thanks, I have the details needed. Let's check appointment availability.", {
      intent: client.booking_enabled ? "offer_booking" : "handoff", lead_status: "qualified", qualified: true,
      ready_to_book: client.booking_enabled, needs_human: !client.booking_enabled,
      handoff_reason: client.booking_enabled ? null : "Qualified lead is ready for the business to arrange next steps."
    });
  }
}
export class DemoMessagingService implements MessagingService {
  async send({ client, message }: Parameters<MessagingService["send"]>[0]): Promise<{ provider_id: string; status: "sent" }> {
    demoOnly(client); return { provider_id: "demo-message-" + message.id, status: "sent" };
  }
}
export class DemoCalendarService implements CalendarService {
  async available({ client, now }: Parameters<CalendarService["available"]>[0]) { demoOnly(client); return demoSlots(client, now); }
  async book({ client, appointment }: Parameters<CalendarService["book"]>[0]) {
    demoOnly(client); return { provider_id: "demo-appointment-" + appointment.id };
  }
}
export class DemoNotificationService implements NotificationService {
  async send({ client, notification }: Parameters<NotificationService["send"]>[0]) {
    demoOnly(client); return { provider_id: "demo-notification-" + notification.id };
  }
}
export function createDemoServices(): { ai: AIService; messaging: MessagingService; calendar: CalendarService; notifications: NotificationService } {
  return { ai: new DemoAIService(), messaging: new DemoMessagingService(), calendar: new DemoCalendarService(), notifications: new DemoNotificationService() };
}
