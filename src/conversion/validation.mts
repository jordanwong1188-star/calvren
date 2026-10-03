import { ConversionError } from "./contracts.mjs";
import type { ClientConfig, InboundInput, IntakeInput } from "./contracts.mjs";
const own = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (message: string): never => { throw new ConversionError("invalid_input", message); };
const bounded = (value: unknown, name: string, max: number, required = true): string => {
  if (typeof value !== "string") { if (!required && (value === undefined || value === null)) return ""; return fail(name + " must be text."); }
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return fail(name + " is invalid.");
  return text;
};
const ident = (value: unknown, name: string): string => {
  const id = bounded(value, name, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) return fail(name + " is invalid.");
  return id;
};
export function normalizePhone(value: unknown): string {
  const phone = bounded(value, "phone", 32, false).replace(/[\s().-]/g, "");
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return fail("Use an international phone number, such as +12369888283.");
  return phone;
}
export function normalizeEmail(value: unknown): string {
  const email = bounded(value, "email", 254, false).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Email is invalid.");
  return email;
}
export function validateIntake(value: unknown): IntakeInput {
  if (!own(value)) return fail("Lead information must be an object.");
  const channel = value.channel ?? "website";
  if (!["sms", "website", "email"].includes(String(channel))) return fail("Channel is invalid.");
  if (channel === "email") return fail("Email conversations are not enabled in this SMS and website MVP.");
  const phone = normalizePhone(value.phone);
  if (value.consent_sms !== undefined && typeof value.consent_sms !== "boolean") return fail("SMS consent must be true or false.");
  if (channel === "sms" && (!phone || value.consent_sms !== true)) return fail("SMS requires an international phone number and explicit consent.");
  return {
    client_id: ident(value.client_id, "client_id"),
    name: bounded(value.name, "name", 120),
    phone, email: normalizeEmail(value.email), message: bounded(value.message, "message", 2000),
    source: bounded(value.source ?? "website", "source", 100),
    channel: channel as "sms" | "website",
    consent_sms: value.consent_sms === true,
    idempotency_key: bounded(value.idempotency_key, "idempotency_key", 160)
  };
}
export function validateInbound(value: unknown): InboundInput {
  if (!own(value)) return fail("Message information must be an object.");
  const channel = value.channel ?? "website";
  if (channel !== "sms" && channel !== "website") return fail("Channel is invalid.");
  return {
    client_id: ident(value.client_id, "client_id"), lead_id: ident(value.lead_id, "lead_id"),
    message: bounded(value.message, "message", 2000), channel,
    event_key: bounded(value.event_key, "event_key", 160)
  };
}
export function validateClient(value: unknown): ClientConfig {
  if (!own(value)) return fail("Client configuration must be an object.");
  const cfg = value as unknown as ClientConfig;
  if (cfg.mode !== "demo" && cfg.mode !== "live") return fail("Client mode must be demo or live.");
  if (typeof cfg.active !== "boolean" || typeof cfg.booking_enabled !== "boolean" || typeof cfg.follow_up_enabled !== "boolean") return fail("Client switches must be true or false.");
  if (!Array.isArray(cfg.services) || !cfg.services.length || cfg.services.length > 30) return fail("Provide 1 to 30 services.");
  if (!Array.isArray(cfg.qualifying_questions) || cfg.qualifying_questions.length > 12) return fail("Provide at most 12 qualifying questions.");
  const ids = new Set<string>();
  const questions = cfg.qualifying_questions.map(q => {
    if (!own(q) || typeof q.required !== "boolean") return fail("Each qualifying question needs id, prompt, and required.");
    const id = ident(q.id, "question id");
    if (ids.has(id)) return fail("Qualifying question IDs must be unique.");
    ids.add(id);
    return { id, prompt: bounded(q.prompt, "question", 300), required: q.required };
  });
  const timezone = bounded(cfg.timezone, "timezone", 100);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return fail("Use a valid IANA timezone."); }
  if (!own(cfg.business_hours)) return fail("Business hours must be an object keyed 0 (Sunday) to 6.");
  const business_hours: ClientConfig["business_hours"] = {};
  for (let day = 0; day < 7; day++) {
    const hours = cfg.business_hours[String(day)];
    if (hours === null || hours === undefined) { business_hours[String(day)] = null; continue; }
    if (!own(hours) || typeof hours.open !== "string" || typeof hours.close !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.close) || hours.close <= hours.open) return fail("Business hours need valid open and close times on the same day.");
    business_hours[String(day)] = { open: hours.open, close: hours.close };
  }
  if (!Object.values(business_hours).some(Boolean)) return fail("Provide at least one business opening day.");
  if (!Array.isArray(cfg.follow_up_delay) || !cfg.follow_up_delay.length || cfg.follow_up_delay.length > 3 ||
    cfg.follow_up_delay.some(v => !Number.isInteger(v) || v < 60 || v > 43200)) return fail("Follow-up delays must contain 1 to 3 values in minutes, each at least 60.");
  if (!Number.isInteger(cfg.max_follow_up_attempts) || cfg.max_follow_up_attempts < 0 || cfg.max_follow_up_attempts > 3 ||
    cfg.max_follow_up_attempts > cfg.follow_up_delay.length) return fail("Use 0 to 3 follow-up attempts with a delay for every attempt.");
  if (!own(cfg.calendar) || !["demo", "google"].includes(cfg.calendar.provider)) return fail("Calendar provider is invalid.");
  const calendar = cfg.calendar;
  if (!Number.isInteger(calendar.duration_minutes) || calendar.duration_minutes < 15 || calendar.duration_minutes > 240 ||
    !Number.isInteger(calendar.buffer_minutes) || calendar.buffer_minutes < 0 || calendar.buffer_minutes > 120 ||
    !Number.isInteger(calendar.horizon_days) || calendar.horizon_days < 1 || calendar.horizon_days > 60) return fail("Calendar duration, buffer or horizon is invalid.");
  if (cfg.mode === "demo" && calendar.provider !== "demo") return fail("Demo clients must use the demo calendar.");
  if (cfg.mode === "live" && calendar.provider !== "google" && cfg.booking_enabled) return fail("Live booking requires a connected Google calendar.");
  const notification_email = normalizeEmail(cfg.notification_email);
  if (cfg.mode === "live" && !notification_email) return fail("A live client needs a notification email.");
  if (!Array.isArray(cfg.service_areas) || cfg.service_areas.length > 100) return fail("Service areas must be a list.");
  return {
    id: ident(cfg.id, "client id"), business_name: bounded(cfg.business_name, "business_name", 160),
    industry: bounded(cfg.industry, "industry", 100), description: bounded(cfg.description, "description", 2000),
    services: cfg.services.map(s => bounded(s, "service", 160)),
    phone_number: normalizePhone(cfg.phone_number), email: normalizeEmail(cfg.email), timezone,
    business_hours, ai_tone: bounded(cfg.ai_tone, "ai_tone", 300),
    system_prompt: bounded(cfg.system_prompt, "system_prompt", 5000, false),
    qualifying_questions: questions, booking_enabled: cfg.booking_enabled, follow_up_enabled: cfg.follow_up_enabled,
    follow_up_delay: [...cfg.follow_up_delay], max_follow_up_attempts: cfg.max_follow_up_attempts,
    notification_email, calendar: { provider: calendar.provider, calendar_id: bounded(calendar.calendar_id, "calendar_id", 300, !(!cfg.booking_enabled)), duration_minutes: calendar.duration_minutes, buffer_minutes: calendar.buffer_minutes, horizon_days: calendar.horizon_days },
    booking_rules: bounded(cfg.booking_rules, "booking_rules", 2000, false), service_areas: cfg.service_areas.map(s => bounded(s, "service area", 160)),
    active: cfg.active, mode: cfg.mode
  };
}
