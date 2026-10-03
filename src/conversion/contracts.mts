/** Browser-safe contract shared by the live adapters and the credential-free demo. */
export type Mode = "demo" | "live";
export type LeadStatus = "new" | "contacted" | "responding" | "qualified" | "booking" | "booked" | "won" | "lost" | "needs_human";
export type Channel = "sms" | "website" | "email";
export type MessageStatus = "received" | "pending" | "sent" | "failed" | "unknown";
export interface Question { id: string; prompt: string; required: boolean; }
export interface Hours { open: string; close: string; }
export interface ClientConfig {
  id: string;
  business_name: string;
  industry: string;
  description: string;
  services: string[];
  phone_number: string;
  email: string;
  timezone: string;
  business_hours: Record<string, Hours | null>;
  ai_tone: string;
  system_prompt: string;
  qualifying_questions: Question[];
  booking_enabled: boolean;
  follow_up_enabled: boolean;
  follow_up_delay: number[];
  max_follow_up_attempts: number;
  notification_email: string;
  calendar: { provider: "demo" | "google"; calendar_id: string; duration_minutes: number; horizon_days: number; buffer_minutes: number; };
  booking_rules: string;
  service_areas: string[];
  active: boolean;
  mode: Mode;
}
export interface Slot { id: string; start: string; end: string; label: string; }
export interface Lead {
  id: string; client_id: string; name: string; phone: string; email: string;
  original_message: string; source: string; created_at: string; updated_at: string;
  status: LeadStatus; qualification_status: "pending" | "qualified" | "unqualified";
  appointment_status: "none" | "offered" | "pending" | "booked" | "failed";
  last_contacted_at: string | null; last_inbound_at: string;
  next_follow_up_at: string | null; follow_up_attempts: number;
  answers: Record<string, string>; offered_slots: Slot[];
  automation_active: boolean; consent_sms: boolean; opted_out: boolean;
  mode: Mode; channel: Channel; version: number; handoff_reason: string | null;
}
export interface Message {
  id: string; lead_id: string; client_id: string; sender: "lead" | "assistant" | "human" | "system";
  message: string; channel: Channel; timestamp: string; ai: boolean;
  status: MessageStatus; provider_id: string | null; idempotency_key: string;
}
export interface Appointment {
  id: string; lead_id: string; client_id: string; slot: Slot;
  status: "pending" | "booked" | "failed"; provider_id: string | null; created_at: string;
}
export interface Notification {
  id: string; lead_id: string; client_id: string; event: "qualified" | "booked" | "needs_human" | "automation_failed";
  message: string; created_at: string; status: "pending" | "sent" | "failed"; provider_id: string | null;
}
export interface LeadBundle { lead: Lead; messages: Message[]; appointments: Appointment[]; notifications: Notification[]; }
export interface Lease { token: string; expires_at: string; bundle: LeadBundle; }
export interface Repository {
  getClient(clientId: string): Promise<ClientConfig | null>;
  listClients(): Promise<ClientConfig[]>;
  saveClient(client: ClientConfig): Promise<ClientConfig>;
  /** Unique (client, key), and unique active (client, phone). Implement in one transaction. */
  createLead(bundle: LeadBundle, idempotencyKey: string): Promise<{ created: boolean; bundle: LeadBundle }>;
  getBundle(clientId: string, leadId: string): Promise<LeadBundle | null>;
  listLeads(clientId?: string): Promise<LeadBundle[]>;
  findLeadByPhone(clientId: string, phone: string): Promise<LeadBundle | null>;
  /** Unique (client, eventKey). A new inbound message invalidates any existing processing lease. */
  appendInbound(clientId: string, leadId: string, message: Message, eventKey: string): Promise<{ created: boolean; bundle: LeadBundle }>;
  acquireLease(clientId: string, leadId: string, now: string, ttlSeconds: number): Promise<Lease | null>;
  leaseValid(clientId: string, leadId: string, token: string, version: number, now: string): Promise<boolean>;
  /** Compare-and-swap version under an unexpired lease; return the saved, incremented version. */
  saveBundle(bundle: LeadBundle, token: string, now: string): Promise<LeadBundle | null>;
  releaseLease(clientId: string, leadId: string, token: string): Promise<void>;
  /** Atomic non-overlapping reservation per client; returns a new bundle/version or null if unavailable. */
  reserveAppointment(bundle: LeadBundle, appointment: Appointment, token: string, now: string): Promise<LeadBundle | null>;
  dueFollowUps(now: string, limit: number): Promise<Array<{ client_id: string; lead_id: string }>>;
  /** Independent of a worker lease; invalidates workers before changing automation state. */
  forceHandoff(clientId: string, leadId: string, reason: string, now: string, optedOut?: boolean): Promise<LeadBundle | null>;
  resumeLead(clientId: string, leadId: string, now: string): Promise<LeadBundle | null>;
}
export interface AIResult {
  message: string; intent: "qualify" | "offer_booking" | "book" | "handoff" | "answer" | "follow_up";
  lead_status: LeadStatus; qualified: boolean; ready_to_book: boolean; needs_human: boolean;
  answers: Record<string, string>; selected_slot_id: string | null; handoff_reason: string | null;
}
export interface AIService { analyze(input: { client: ClientConfig; bundle: LeadBundle; reason: "inbound" | "follow_up" }): Promise<AIResult>; }
export interface MessagingService {
  /** The application has already recorded the pending message. Use message.id as the provider idempotency key where supported. */
  send(input: { client: ClientConfig; lead: Lead; message: Message }): Promise<{ provider_id: string; status: "sent" }>;
}
export interface CalendarService {
  available(input: { client: ClientConfig; lead: Lead; now: string }): Promise<Slot[]>;
  /** appointment.id is stable across retries; provider must reconcile an already-existing event. */
  book(input: { client: ClientConfig; lead: Lead; appointment: Appointment }): Promise<{ provider_id: string }>;
}
export interface NotificationService {
  send(input: { client: ClientConfig; lead: Lead; notification: Notification }): Promise<{ provider_id: string }>;
}
export interface EngineDependencies {
  repository: Repository; ai: AIService; messaging: MessagingService;
  calendar: CalendarService; notifications: NotificationService;
  now?: () => Date; uuid?: () => string;
}
export interface IntakeInput {
  client_id: string; name: string; phone?: string; email?: string; message: string;
  source?: string; channel?: Channel; consent_sms?: boolean; idempotency_key: string;
}
export interface InboundInput {
  client_id: string; lead_id: string; message: string; channel?: Channel; event_key: string;
}
export class ConversionError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = "ConversionError"; }
}
