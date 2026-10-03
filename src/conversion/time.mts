import type { ClientConfig, Slot } from "./contracts.mjs";
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();
export function localClock(date: Date, timezone: string): { day: string; time: string } {
  let formatter = formatters.get(timezone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(timezone, formatter); }
  const parts = formatter.formatToParts(date);
  const read = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { day: String(dayNames.indexOf(read("weekday"))), time: read("hour") + ":" + read("minute") };
}
export function insideBusinessHours(client: ClientConfig, date: Date, durationMinutes = 0): boolean {
  const start = localClock(date, client.timezone);
  const hours = client.business_hours[start.day];
  if (!hours || start.time < hours.open || start.time >= hours.close) return false;
  if (!durationMinutes) return true;
  const end = localClock(new Date(date.getTime() + durationMinutes * 60000), client.timezone);
  return end.day === start.day && end.time <= hours.close;
}
export function nextBusinessTime(client: ClientConfig, after: Date): string {
  if (insideBusinessHours(client, after)) return after.toISOString();
  const start = Math.ceil(after.getTime() / 60000) * 60000;
  // Minute steps preserve non-quarter-hour opening times and DST changes.
  for (let offset = 0; offset < 15 * 24 * 60; offset++) {
    const date = new Date(start + offset * 60000);
    if (insideBusinessHours(client, date)) return date.toISOString();
  }
  throw new Error("No business opening time within 15 days.");
}
export function scheduleFollowUp(client: ClientConfig, from: Date, attempt: number): string | null {
  if (!client.follow_up_enabled || attempt >= client.max_follow_up_attempts) return null;
  const delay = client.follow_up_delay[attempt];
  if (!delay) return null;
  return nextBusinessTime(client, new Date(from.getTime() + delay * 60000));
}
export function slotLabel(start: string, client: ClientConfig): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(start));
}
export function demoSlots(client: ClientConfig, now: string): Slot[] {
  const slots: Slot[] = [];
  const first = Math.ceil((new Date(now).getTime() + 60 * 60000) / (15 * 60000)) * 15 * 60000;
  const end = first + client.calendar.horizon_days * 24 * 60 * 60000;
  const duration = client.calendar.duration_minutes;
  let candidate = first;
  while (candidate < end && slots.length < 3) {
    const start = new Date(candidate);
    if (insideBusinessHours(client, start, duration + client.calendar.buffer_minutes)) {
      slots.push({ id: "demo_" + candidate, start: start.toISOString(), end: new Date(candidate + duration * 60000).toISOString(), label: slotLabel(start.toISOString(), client) });
      candidate += (duration + client.calendar.buffer_minutes) * 60000;
    } else candidate += 15 * 60000;
  }
  return slots;
}
