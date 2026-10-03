import { ConversionError } from "./contracts.mjs";
import type { Appointment, ClientConfig, LeadBundle, Lease, Message, Repository } from "./contracts.mjs";
import { validateClient } from "./validation.mjs";
const copy = <T,>(value: T): T => structuredClone(value);
const key = (client: string, lead: string) => client + ":" + lead;
/** In-memory transactional equivalent for the public demo and focused tests. Not a live durable database. */
export class MemoryRepository implements Repository {
  private clients = new Map<string, ClientConfig>();
  private bundles = new Map<string, LeadBundle>();
  private intakeKeys = new Map<string, string>();
  private eventKeys = new Set<string>();
  private leases = new Map<string, { token: string; expires_at: string }>();
  private serial = 0;
  constructor(clients: ClientConfig[] = []) { for (const client of clients) this.clients.set(client.id, copy(validateClient(client))); }
  async getClient(id: string): Promise<ClientConfig | null> { return copy(this.clients.get(id) ?? null); }
  async listClients(): Promise<ClientConfig[]> { return copy([...this.clients.values()]); }
  async saveClient(client: ClientConfig): Promise<ClientConfig> {
    const valid = validateClient(client);
    const existing = this.clients.get(valid.id);
    if (existing && existing.mode !== valid.mode) throw new ConversionError("immutable_mode", "Create a separate client ID to change demo/live mode.");
    this.clients.set(valid.id, copy(valid)); return copy(valid);
  }
  async createLead(bundle: LeadBundle, idempotencyKey: string): Promise<{ created: boolean; bundle: LeadBundle }> {
    const intakeKey = key(bundle.lead.client_id, idempotencyKey);
    const existing = this.intakeKeys.get(intakeKey);
    if (existing) return { created: false, bundle: copy(this.bundles.get(existing)!) };
    const leadKey = key(bundle.lead.client_id, bundle.lead.id);
    if (this.bundles.has(leadKey)) throw new ConversionError("duplicate_lead", "Lead already exists.", 409);
    if (bundle.lead.phone && bundle.lead.channel === "sms") {
      const duplicate = [...this.bundles.values()].find(b => b.lead.client_id === bundle.lead.client_id && b.lead.phone === bundle.lead.phone && !["won", "lost"].includes(b.lead.status));
      if (duplicate) throw new ConversionError("active_phone", "This phone number already has an active conversation for this business.", 409);
    }
    this.bundles.set(leadKey, copy(bundle)); this.intakeKeys.set(intakeKey, leadKey);
    return { created: true, bundle: copy(bundle) };
  }
  async getBundle(clientId: string, leadId: string): Promise<LeadBundle | null> { return copy(this.bundles.get(key(clientId, leadId)) ?? null); }
  async listLeads(clientId?: string): Promise<LeadBundle[]> { return copy([...this.bundles.values()].filter(b => !clientId || b.lead.client_id === clientId).sort((a, b) => b.lead.created_at.localeCompare(a.lead.created_at))); }
  async findLeadByPhone(clientId: string, phone: string): Promise<LeadBundle | null> {
    const bundles = [...this.bundles.values()].filter(b => b.lead.client_id === clientId && b.lead.phone === phone).sort((a, b) => b.lead.created_at.localeCompare(a.lead.created_at));
    return copy(bundles[0] ?? null);
  }
  async appendInbound(clientId: string, leadId: string, message: Message, eventKey: string): Promise<{ created: boolean; bundle: LeadBundle }> {
    const leadKey = key(clientId, leadId); const bundle = this.bundles.get(leadKey);
    if (!bundle) throw new ConversionError("not_found", "Lead not found.", 404);
    const event = key(clientId, eventKey);
    if (this.eventKeys.has(event)) return { created: false, bundle: copy(bundle) };
    if (message.client_id !== clientId || message.lead_id !== leadId || message.sender !== "lead") throw new ConversionError("invalid_message", "Inbound message ownership is invalid.");
    this.eventKeys.add(event); this.leases.delete(leadKey);
    bundle.messages.push(copy(message)); bundle.lead.version++;
    bundle.lead.last_inbound_at = message.timestamp; bundle.lead.updated_at = message.timestamp;
    bundle.lead.next_follow_up_at = null; bundle.lead.follow_up_attempts = 0;
    if (bundle.lead.automation_active && bundle.lead.status !== "booked") bundle.lead.status = "responding";
    return { created: true, bundle: copy(bundle) };
  }
  async acquireLease(clientId: string, leadId: string, now: string, ttlSeconds: number): Promise<Lease | null> {
    const leadKey = key(clientId, leadId); const bundle = this.bundles.get(leadKey); const existing = this.leases.get(leadKey);
    if (!bundle || (existing && existing.expires_at > now)) return null;
    const lease = { token: "memory-lease-" + (++this.serial), expires_at: new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString() };
    this.leases.set(leadKey, lease); return { ...lease, bundle: copy(bundle) };
  }
  async leaseValid(clientId: string, leadId: string, token: string, version: number, now: string): Promise<boolean> {
    const leadKey = key(clientId, leadId); const lease = this.leases.get(leadKey); const bundle = this.bundles.get(leadKey);
    return !!lease && lease.token === token && lease.expires_at > now && bundle?.lead.version === version;
  }
  async saveBundle(bundle: LeadBundle, token: string, now: string): Promise<LeadBundle | null> {
    if (!await this.leaseValid(bundle.lead.client_id, bundle.lead.id, token, bundle.lead.version, now)) return null;
    // Recheck synchronously after the await, so a racing inbound cannot be overwritten.
    const leadKey = key(bundle.lead.client_id, bundle.lead.id); const stored = this.bundles.get(leadKey)!; const lease = this.leases.get(leadKey);
    if (!lease || lease.token !== token || lease.expires_at <= now || stored.lead.version !== bundle.lead.version) return null;
    const saved = copy(bundle); saved.lead.version++; saved.lead.updated_at = now;
    this.bundles.set(leadKey, saved); return copy(saved);
  }
  async releaseLease(clientId: string, leadId: string, token: string): Promise<void> {
    const leadKey = key(clientId, leadId); if (this.leases.get(leadKey)?.token === token) this.leases.delete(leadKey);
  }
  async reserveAppointment(bundle: LeadBundle, appointment: Appointment, token: string, now: string): Promise<LeadBundle | null> {
    if (!await this.leaseValid(bundle.lead.client_id, bundle.lead.id, token, bundle.lead.version, now)) return null;
    const leadKey = key(bundle.lead.client_id, bundle.lead.id);
    const stored = this.bundles.get(leadKey)!; const lease = this.leases.get(leadKey);
    if (!lease || lease.token !== token || lease.expires_at <= now || stored.lead.version !== bundle.lead.version ||
      appointment.client_id !== bundle.lead.client_id || appointment.lead_id !== bundle.lead.id) return null;
    const existing = [...this.bundles.values()].flatMap(b => b.appointments).some(a => a.client_id === appointment.client_id && a.status !== "failed" && a.slot.start < appointment.slot.end && a.slot.end > appointment.slot.start);
    if (existing) return null;
    // No await between the shared-calendar overlap check and commit.
    const pending = copy(bundle); pending.appointments.push(copy(appointment)); pending.lead.appointment_status = "pending";
    pending.lead.version++; pending.lead.updated_at = now;
    this.bundles.set(leadKey, pending); return copy(pending);
  }
  async dueFollowUps(now: string, limit: number): Promise<Array<{ client_id: string; lead_id: string }>> {
    return [...this.bundles.values()].filter(b => b.lead.automation_active && !b.lead.opted_out && b.lead.next_follow_up_at && b.lead.next_follow_up_at <= now).sort((a, b) => a.lead.next_follow_up_at!.localeCompare(b.lead.next_follow_up_at!)).slice(0, Math.min(100, Math.max(1, limit))).map(b => ({ client_id: b.lead.client_id, lead_id: b.lead.id }));
  }
  async forceHandoff(clientId: string, leadId: string, reason: string, now: string, optedOut = false): Promise<LeadBundle | null> {
    const leadKey = key(clientId, leadId); const bundle = this.bundles.get(leadKey); if (!bundle) return null;
    this.leases.delete(leadKey); bundle.lead.version++; bundle.lead.updated_at = now;
    bundle.lead.status = "needs_human"; bundle.lead.automation_active = false; bundle.lead.handoff_reason = reason;
    bundle.lead.next_follow_up_at = null;
    if (optedOut) { bundle.lead.opted_out = true; bundle.lead.consent_sms = false; }
    return copy(bundle);
  }
  async resumeLead(clientId: string, leadId: string, now: string): Promise<LeadBundle | null> {
    const leadKey = key(clientId, leadId); const bundle = this.bundles.get(leadKey); if (!bundle) return null;
    if (bundle.lead.opted_out || (bundle.lead.channel === "sms" && !bundle.lead.consent_sms)) throw new ConversionError("consent_required", "An opted-out lead cannot be resumed. Obtain fresh consent in a new intake.", 409);
    if (bundle.messages.some(m => m.status === "pending" || m.status === "unknown") || bundle.appointments.some(a => a.status === "pending")) throw new ConversionError("reconcile_required", "Reconcile uncertain messages and appointments before resuming.", 409);
    this.leases.delete(leadKey); bundle.lead.version++; bundle.lead.updated_at = now;
    bundle.lead.status = bundle.lead.appointment_status === "booked" ? "booked" : bundle.lead.qualification_status === "qualified" ? "qualified" : "responding";
    bundle.lead.automation_active = true; bundle.lead.handoff_reason = null; bundle.lead.next_follow_up_at = null;
    return copy(bundle);
  }
}
