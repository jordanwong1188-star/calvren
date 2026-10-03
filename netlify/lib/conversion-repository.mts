import { ConversionError, type Repository, type ClientConfig, type LeadBundle, type Message, type Lease, type Appointment, type MessageStatus } from "../../src/conversion/contracts.mjs";

export interface SupabaseRepositoryOptions { url: string; key: string; fetch?: typeof fetch; }
/** Server-only repository. The browser calls protected Netlify APIs, never this adapter. */
export class SupabaseRepository implements Repository {
  private readonly base: string;
  private readonly headers: Record<string,string>;
  private readonly fetcher: typeof fetch;
  constructor(options: SupabaseRepositoryOptions) {
    let url: URL;
    try { url = new URL(options.url); } catch { throw unavailable(); }
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || !["","/"].includes(url.pathname)) throw unavailable();
    this.base = url.origin + "/rest/v1/";
    this.headers = { apikey: options.key, "Content-Type":"application/json", Accept:"application/json" };
    if (/^sb_secret_[a-zA-Z0-9_-]+$/.test(options.key)) {
      // New Supabase keys are not JWTs: apikey only.
    } else if (legacyServiceKey(options.key)) {
      this.headers.Authorization = "Bearer " + options.key;
    } else throw unavailable();
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  private async call<T>(path: string, data?: unknown, method = data === undefined ? "GET" : "POST"): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, {
        method, headers:this.headers, signal:AbortSignal.timeout(15_000), cache:"no-store",
        ...(data === undefined ? {} : { body:JSON.stringify(data) })
      });
    } catch { throw new ConversionError("database_unavailable","The database could not be reached. The operation may have completed; retry with the same request key.",503); }
    if (!response.ok) {
      let code = "";
      try { const error: unknown = await response.json(); if (object(error) && typeof error.code === "string") code=error.code; } catch { /* Do not expose provider body/credentials. */ }
      if (code === "23505" || code === "40001") throw new ConversionError("conflict","An existing client, lead or appointment conflicts with this operation.",409);
      if (code === "22023") throw new ConversionError("invalid_state","This conversation or configuration could not be updated safely.",409);
      if (code === "23503") throw new ConversionError("not_found","The client or related lead does not exist.",404);
      throw new ConversionError("database_unavailable","The database integration could not complete this operation.",503);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new ConversionError("database_response","The database returned an invalid response.",502); }
  }
  private rpc<T>(name: string, data: Record<string,unknown>): Promise<T> { return this.call<T>("rpc/calvren_" + name,data); }
  async getClient(clientId: string): Promise<ClientConfig|null> {
    clientId=clientIdValue(clientId);
    const query = new URLSearchParams({ select:"config", id:"eq."+clientId, limit:"1" });
    const rows = await this.call<unknown>("calvren_clients?"+query);
    if (!Array.isArray(rows)) throw badResponse();
    if (rows.length===0) return null;
    if (!object(rows[0]) || !object(rows[0].config) || rows[0].config.id!==clientId) throw badResponse();
    return rows[0].config as unknown as ClientConfig;
  }
  /** Owner-only listing; protected API authorization occurs before repository access. */
  async listClients(): Promise<ClientConfig[]> {
    const rows = await this.call<unknown>("calvren_clients?select=config&order=id&limit=200");
    if (!Array.isArray(rows) || rows.some(row=>!object(row)||!object(row.config))) throw badResponse();
    return rows.map(row=>(row as {config:ClientConfig}).config);
  }
  async saveClient(client: ClientConfig): Promise<ClientConfig> {
    clientIdValue(client.id);
    const result=await this.rpc<unknown>("save_client",{p_client:client});
    if (!object(result) || result.id!==client.id) throw badResponse();
    return result as unknown as ClientConfig;
  }
  async createLead(bundle: LeadBundle,idempotencyKey: string): Promise<{created:boolean;bundle:LeadBundle}> {
    bundleIdentity(bundle); eventKey(idempotencyKey);
    const result=await this.rpc<unknown>("create_lead",{p_bundle:bundle,p_idempotency_key:idempotencyKey});
    if (!object(result)||typeof result.created!=="boolean") throw badResponse();
    return {created:result.created,bundle:readBundle(result.bundle,bundle.lead.client_id)};
  }
  async getBundle(clientId: string,leadId: string): Promise<LeadBundle|null> {
    const result=await this.rpc<unknown>("get_bundle",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId)});
    return result===null?null:readBundle(result,clientId,leadId);
  }
  /** No client filter is deliberately restricted to the Calvren operator API. */
  async listLeads(clientId?: string): Promise<LeadBundle[]> {
    const result=await this.rpc<unknown>("list_leads",{p_client_id:clientId===undefined?null:clientIdValue(clientId),p_limit:100});
    if (!Array.isArray(result)) throw badResponse();
    return result.map(item=>readBundle(item,clientId));
  }
  async findLeadByPhone(clientId: string,phone: string): Promise<LeadBundle|null> {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw invalid("Use an E.164 phone number.");
    const result=await this.rpc<unknown>("find_lead_by_phone",{p_client_id:clientIdValue(clientId),p_phone:phone});
    return result===null?null:readBundle(result,clientId);
  }
  async appendInbound(clientId: string,leadId: string,message: Message,event: string): Promise<{created:boolean;bundle:LeadBundle}> {
    clientIdValue(clientId); uuidValue(leadId); eventKey(event);
    if (message.client_id!==clientId||message.lead_id!==leadId) throw invalid("Message and lead identity do not match.");
    const result=await this.rpc<unknown>("append_inbound",{p_client_id:clientId,p_lead_id:leadId,p_message:message,p_event_key:event});
    if (!object(result)||typeof result.created!=="boolean") throw badResponse();
    return {created:result.created,bundle:readBundle(result.bundle,clientId,leadId)};
  }
  async acquireLease(clientId: string,leadId: string,now: string,ttlSeconds: number): Promise<Lease|null> {
    const result=await this.rpc<unknown>("acquire_lease",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_now:dateValue(now),p_ttl_seconds:integer(ttlSeconds,5,180)});
    if (result===null) return null;
    if (!object(result)||typeof result.token!=="string"||typeof result.expires_at!=="string") throw badResponse();
    return {token:uuidValue(result.token),expires_at:dateValue(result.expires_at),bundle:readBundle(result.bundle,clientId,leadId)};
  }
  async leaseValid(clientId: string,leadId: string,token: string,version: number,now: string): Promise<boolean> {
    return boolean(await this.rpc("lease_valid",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_token:uuidValue(token),p_version:integer(version,0,2_147_483_647),p_now:dateValue(now)}));
  }
  async saveBundle(bundle: LeadBundle,token: string,now: string): Promise<LeadBundle|null> {
    bundleIdentity(bundle);
    const result=await this.rpc<unknown>("save_bundle",{p_bundle:bundle,p_token:uuidValue(token),p_now:dateValue(now)});
    return result===null?null:readBundle(result,bundle.lead.client_id,bundle.lead.id);
  }
  async releaseLease(clientId: string,leadId: string,token: string): Promise<void> {
    await this.rpc("release_lease",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_token:uuidValue(token)});
  }
  async reserveAppointment(bundle: LeadBundle,appointment: Appointment,token: string,now: string): Promise<LeadBundle|null> {
    bundleIdentity(bundle); uuidValue(appointment.id);
    if (appointment.client_id!==bundle.lead.client_id||appointment.lead_id!==bundle.lead.id) throw invalid("Appointment and lead identity do not match.");
    const result=await this.rpc<unknown>("reserve_appointment",{p_bundle:bundle,p_appointment:appointment,p_token:uuidValue(token),p_now:dateValue(now)});
    return result===null?null:readBundle(result,bundle.lead.client_id,bundle.lead.id);
  }
  async dueFollowUps(now: string,limit: number): Promise<Array<{client_id:string;lead_id:string}>> {
    const result=await this.rpc<unknown>("due_follow_ups",{p_now:dateValue(now),p_limit:integer(limit,1,100)});
    if (!Array.isArray(result)) throw badResponse();
    return result.map(item=>{
      if (!object(item)||typeof item.client_id!=="string"||typeof item.lead_id!=="string") throw badResponse();
      return {client_id:clientIdValue(item.client_id),lead_id:uuidValue(item.lead_id)};
    });
  }
  async forceHandoff(clientId: string,leadId: string,reason: string,now: string,optedOut=false): Promise<LeadBundle|null> {
    if (typeof reason!=="string"||reason.length<1||reason.length>500) throw invalid("Provide a handoff reason.");
    const result=await this.rpc<unknown>("force_handoff",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_reason:reason,p_now:dateValue(now),p_opted_out:optedOut});
    return result===null?null:readBundle(result,clientId,leadId);
  }
  async resumeLead(clientId: string,leadId: string,now: string): Promise<LeadBundle|null> {
    const result=await this.rpc<unknown>("resume_lead",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_now:dateValue(now)});
    return result===null?null:readBundle(result,clientId,leadId);
  }
  /** key must already be a SHA-256 digest; never store raw intake credentials or IPs. */
  async consumeRateLimit(key: string,limit: number,windowSeconds: number,now: string): Promise<boolean> {
    return boolean(await this.rpc("consume_rate_limit",{p_key_hash:hashValue(key),p_limit:integer(limit,1,10_000),p_window_seconds:integer(windowSeconds,1,86_400),p_now:dateValue(now)}));
  }
  async verifyClientKey(clientId: string,keyHash: string): Promise<boolean> {
    return boolean(await this.rpc("verify_client_key",{p_client_id:clientIdValue(clientId),p_key_hash:hashValue(keyHash)}));
  }
  async rotateClientKey(clientId: string,keyHash: string|null): Promise<void> {
    await this.rpc("rotate_client_key",{p_client_id:clientIdValue(clientId),p_key_hash:keyHash===null?null:hashValue(keyHash)});
  }
  async updateMessageStatus(clientId: string,leadId: string,providerId: string,status: MessageStatus,event: string,messageId?: string): Promise<boolean> {
    if (!["sent","failed","unknown"].includes(status)||typeof providerId!=="string"||providerId.length<1||providerId.length>200) throw invalid("Invalid delivery callback.");
    return boolean(await this.rpc("update_message_status",{p_client_id:clientIdValue(clientId),p_lead_id:uuidValue(leadId),p_provider_id:providerId,p_status:status,p_event_key:eventKey(event),p_message_id:messageId===undefined?null:uuidValue(messageId)}));
  }
}
function legacyServiceKey(key: string): boolean {
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(key)) return false;
  try {
    const header: unknown=JSON.parse(Buffer.from(key.split(".")[0],"base64url").toString("utf8"));
    const value: unknown=JSON.parse(Buffer.from(key.split(".")[1],"base64url").toString("utf8"));
    return object(header)&&header.alg==="HS256"&&object(value)&&value.role==="service_role";
  } catch { return false; }
}
function object(value: unknown): value is Record<string,unknown> { return value!==null&&typeof value==="object"&&!Array.isArray(value); }
function invalid(message: string): ConversionError { return new ConversionError("invalid_input",message,400); }
function unavailable(): ConversionError { return new ConversionError("database_not_configured","Configure the server-only Supabase URL and secret key.",503); }
function badResponse(): ConversionError { return new ConversionError("database_response","The database returned an invalid or mismatched response.",502); }
function clientIdValue(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) throw invalid("Invalid client ID."); return value; }
function uuidValue(value: string): string { if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw invalid("Invalid record ID."); return value; }
function eventKey(value: string): string { if (typeof value!=="string"||value.length<1||value.length>200||/[\u0000-\u001F]/.test(value)) throw invalid("Invalid request key."); return value; }
function dateValue(value: string): string { if (typeof value!=="string"||!Number.isFinite(Date.parse(value))) throw invalid("Invalid timestamp."); return value; }
function integer(value: number,min: number,max: number): number { if (!Number.isInteger(value)||value<min||value>max) throw invalid("Invalid numeric limit."); return value; }
function hashValue(value: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw invalid("Provide a SHA-256 key digest."); return value; }
function boolean(value: unknown): boolean { if (typeof value!=="boolean") throw badResponse(); return value; }
function bundleIdentity(bundle: LeadBundle): void {
  clientIdValue(bundle.lead.client_id); uuidValue(bundle.lead.id);
  for (const group of [bundle.messages,bundle.appointments,bundle.notifications]) {
    if (!Array.isArray(group)) throw invalid("Invalid conversation bundle.");
    for (const item of group) if (item.client_id!==bundle.lead.client_id||item.lead_id!==bundle.lead.id) throw invalid("Conversation tenant identity does not match.");
  }
}
function readBundle(value: unknown,clientId?: string,leadId?: string): LeadBundle {
  if (!object(value)||!object(value.lead)||typeof value.lead.client_id!=="string"||typeof value.lead.id!=="string"||
    !Array.isArray(value.messages)||!Array.isArray(value.appointments)||!Array.isArray(value.notifications)||
    (clientId!==undefined&&value.lead.client_id!==clientId)||(leadId!==undefined&&value.lead.id!==leadId)) throw badResponse();
  const bundle=value as unknown as LeadBundle;
  try { bundleIdentity(bundle); } catch { throw badResponse(); }
  return bundle;
}
