import type { ClientConfig } from "./contracts.mjs";
/** Illustrative client; no real customer/company results are claimed. */
export const demoClient: ClientConfig = {
  id: "abc-plumbing-demo",
  business_name: "ABC Plumbing",
  industry: "Local services",
  description: "An illustrative plumbing business for Calvren demonstrations. Routine enquiries become an appointment request; emergencies go to a person.",
  services: ["Emergency plumbing", "Drain cleaning", "Leak repair", "Water heater repair"],
  phone_number: "+15555550100",
  email: "owner@example.com",
  timezone: "America/Vancouver",
  business_hours: {
    "0": null,
    "1": { open: "08:00", close: "17:00" },
    "2": { open: "08:00", close: "17:00" },
    "3": { open: "08:00", close: "17:00" },
    "4": { open: "08:00", close: "17:00" },
    "5": { open: "08:00", close: "17:00" },
    "6": { open: "09:00", close: "13:00" }
  },
  ai_tone: "Friendly, professional, concise",
  system_prompt: "Collect the required information one question at a time. Never promise pricing, emergency response, or availability that has not been verified. Escalate dangerous leaks, emergencies, unusual requests, and requests for a person.",
  qualifying_questions: [
    { id: "service", prompt: "What service do you need?", required: true },
    { id: "emergency", prompt: "Is this an emergency, or can it wait for a routine appointment?", required: true },
    { id: "area", prompt: "What area are you located in?", required: true },
    { id: "timing", prompt: "When would you like service?", required: true }
  ],
  booking_enabled: true,
  follow_up_enabled: true,
  follow_up_delay: [120, 1440, 2880],
  max_follow_up_attempts: 3,
  notification_email: "owner@example.com",
  calendar: { provider: "demo", calendar_id: "demo-abc-plumbing", duration_minutes: 60, horizon_days: 14, buffer_minutes: 15 },
  booking_rules: "Routine appointments only. Show verified times and require the customer to choose one. Emergencies need human review.",
  service_areas: [],
  active: true,
  mode: "demo"
};
export function newDemoClient(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return structuredClone({ ...demoClient, ...overrides });
}
