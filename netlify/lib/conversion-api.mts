import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ConversionError, type ClientConfig, type IntakeInput, type LeadBundle, type Repository } from "../../src/conversion/contracts.mjs";
import { validateClient } from "../../src/conversion/validation.mjs";

export interface OperatorRepository extends Repository {
  consumeRateLimit(key: string, limit: number, windowSeconds: number, now: string): Promise<boolean>;
  verifyClientKey(clientId: string, keyHash: string): Promise<boolean>;
  rotateClientKey(clientId: string, keyHash: string | null): Promise<void>;
  updateMessageStatus(clientId: string, leadId: string, providerId: string, status: "sent" | "failed" | "unknown", eventKey: string, messageId?: string): Promise<boolean>;
}
export interface ConversionEngineAPI {
  intake(input: IntakeInput): Promise<LeadBundle>;
  receive(input: { client_id: string; lead_id: string; message: string; event_key: string; channel?: "sms" | "website" | "email" }): Promise<LeadBundle>;
  handoff(clientId: string, leadId: string, reason: string): Promise<LeadBundle | null>;
  resume(clientId: string, leadId: string): Promise<LeadBundle | null>;
  followUps(limit?: number): Promise<{ processed: number; skipped: number; failed: number }>;
}
export interface Readiness {
  database: boolean; admin: boolean; mode: "demo" | "live"; production: boolean;
  providers: { openai: boolean; twilio: boolean; google: boolean; notifications: boolean };
  server_demo: boolean; browser_demo: true; issues: string[];
}
export interface ConversionAPIDependencies {
  env(name: string): string | undefined;
  repository: OperatorRepository | null;
  engine(): ConversionEngineAPI;
  readiness(): Readiness;
  verifyWebhook(request: Request, path: "/api/conversion/twilio/inbound" | "/api/conversion/twilio/status"): Promise<Record<string, string>>;
  ip?: string; now?: () => Date;
  log?: (event: string, details: { code: string; request_id: string }) => void;
}
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers }); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function bearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return /^Bearer [^\s]{16,1024}$/.test(header) ? header.slice(7) : "";
}
export function adminAuthorized(request: Request, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || expected.length > 1024 || /\s/.test(expected)) return false;
  const supplied = bearer(request);
  return !!supplied && timingSafeEqual(Buffer.from(hash(supplied), "hex"), Buffer.from(hash(expected), "hex"));
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConversionError("INVALID_INPUT", "Use a JSON object.");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) throw new ConversionError("INVALID_INPUT", "A valid client or lead ID is required.");
  return value;
}
function text(value: unknown, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ConversionError("INVALID_INPUT", "Check the submitted fields.");
  return value.trim();
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new ConversionError("CONTENT_TYPE", "Send application/json.", 415);
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > 32768) throw new ConversionError("BODY_TOO_LARGE", "The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ConversionError("INVALID_INPUT", "A JSON body is required.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 32768) { await reader.cancel(); throw new ConversionError("BODY_TOO_LARGE", "The request is too large.", 413); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all))); }
  catch (error) { if (error instanceof ConversionError) throw error; throw new ConversionError("INVALID_JSON", "Use valid JSON."); }
}
function repository(deps: ConversionAPIDependencies): OperatorRepository {
  if (!deps.repository) throw new ConversionError("DATABASE_NOT_CONFIGURED", "Connect a dedicated Calvren Supabase project and apply the migration. The browser demo works without it.", 503);
  return deps.repository;
}
async function limit(deps: ConversionAPIDependencies, key: string, maximum = 120): Promise<void> {
  const allowed = await repository(deps).consumeRateLimit(hash(key), maximum, 60, (deps.now?.() || new Date()).toISOString());
  if (!allowed) throw new ConversionError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
}
function requireAdmin(request: Request, deps: ConversionAPIDependencies): void {
  if (!deps.env("CALVREN_ADMIN_TOKEN")) throw new ConversionError("ADMIN_NOT_CONFIGURED", "Set a strong CALVREN_ADMIN_TOKEN in the server environment.", 503);
  if (!adminAuthorized(request, deps.env("CALVREN_ADMIN_TOKEN"))) throw new ConversionError("UNAUTHORIZED", "A valid operator token is required.", 401);
}
async function bundle(repo: OperatorRepository, clientId: string, leadId: string): Promise<LeadBundle> {
  const value = await repo.getBundle(clientId, leadId);
  if (!value) throw new ConversionError("NOT_FOUND", "Lead not found.", 404);
  return value;
}
function twiml(): Response { return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", { status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } }); }
async function twilio(request: Request, deps: ConversionAPIDependencies, path: "/api/conversion/twilio/inbound" | "/api/conversion/twilio/status"): Promise<Response> {
  if (request.method !== "POST") throw new ConversionError("METHOD_NOT_ALLOWED", "Use POST.", 405);
  // The provider verifies the fixed public URL, every form field, AccountSid and signature before any tenant lookup.
  const form = await deps.verifyWebhook(request, path);
  const repo = repository(deps);
  const inbound = path.endsWith("/inbound");
  const businessPhone = inbound ? form.To : form.From;
  const customerPhone = inbound ? form.From : form.To;
  if (!/^\+[1-9]\d{7,14}$/.test(businessPhone || "") || !/^\+[1-9]\d{7,14}$/.test(customerPhone || "") || !/^SM[0-9a-fA-F]{32}$/.test(form.MessageSid || "")) throw new ConversionError("INVALID_WEBHOOK", "Invalid messaging event.");
  const clients = (await repo.listClients()).filter(c => c.mode === "live" && c.phone_number === businessPhone);
  // Unknown/ambiguous destinations or unknown senders never create an unconsented lead.
  if (clients.length !== 1) return twiml();
  const client = clients[0]; const lead = await repo.findLeadByPhone(client.id, customerPhone);
  if (!lead || lead.lead.mode !== "live") return twiml();
  if (inbound) {
    const message = text(form.Body, 2000);
    if (!/^(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?$/i.test(message)) await limit(deps, "sms:" + client.id, 120);
    await deps.engine().receive({ client_id: client.id, lead_id: lead.lead.id, message, channel: "sms", event_key: "twilio:" + form.MessageSid });
  } else {
    const providerStatus = form.MessageStatus || form.SmsStatus || "";
    const status = ["delivered", "sent", "read"].includes(providerStatus) ? "sent" : ["failed", "undelivered", "canceled"].includes(providerStatus) ? "failed" : null;
    if (status) {
      const changed = await repo.updateMessageStatus(client.id, lead.lead.id, form.MessageSid, status, "twilio-status:" + form.MessageSid + ":" + providerStatus, id(new URL(request.url).searchParams.get("message_id")));
      if (changed && status === "failed") await deps.engine().handoff(client.id, lead.lead.id, "SMS delivery failed; contact this lead manually.");
    }
  }
  return twiml();
}
export async function handleConversion(request: Request, deps: ConversionAPIDependencies): Promise<Response> {
  const requestId = randomBytes(8).toString("hex");
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/$/, "");
    if (path === "/api/conversion/twilio/inbound" || path === "/api/conversion/twilio/status") return await twilio(request, deps, path);
    const intake = (path === "/api/leads" || path === "/api/conversion/leads") && request.method === "POST";
    if (intake) {
      const input = await body(request); const clientId = id(input.client_id);
      if (input.website !== undefined && input.website !== "") throw new ConversionError("INVALID_INPUT", "The submission could not be accepted.");
      const admin = adminAuthorized(request, deps.env("CALVREN_ADMIN_TOKEN"));
      if (!admin) {
        const token = bearer(request);
        if (!token) throw new ConversionError("UNAUTHORIZED", "A valid client intake key is required.", 401);
        if (!await repository(deps).verifyClientKey(clientId, hash(token))) throw new ConversionError("UNAUTHORIZED", "A valid client intake key is required.", 401);
      }
      await limit(deps, "intake:" + clientId + ":" + (deps.ip || "unknown"), 30);
      const client = await repository(deps).getClient(clientId);
      if (!client || !client.active) throw new ConversionError("CLIENT_INACTIVE", "This client is not accepting leads.", 404);
      if (!admin && client.mode !== "live") throw new ConversionError("DEMO_REQUIRES_OPERATOR", "Use the browser demo or an operator token for simulated leads.", 403);
      if (input.channel !== undefined && input.channel !== "website" && input.channel !== "sms") throw new ConversionError("INVALID_INPUT", "Use website or sms.");
      if (client.mode === "live" && input.channel !== undefined && input.channel !== "sms") throw new ConversionError("LIVE_SMS_REQUIRED", "Live website submissions must continue by SMS with a phone number and explicit consent.");
      if (input.consent_sms !== undefined && typeof input.consent_sms !== "boolean") throw new ConversionError("INVALID_INPUT", "SMS consent must be true or false.");
      const result = await deps.engine().intake({
        client_id: clientId, name: text(input.name, 120), phone: text(input.phone, 24, false), email: text(input.email, 254, false),
        message: text(input.message, 2000), source: text(input.source, 80, false) || "website",
        channel: input.channel === "sms" || client.mode === "live" ? "sms" : "website", consent_sms: input.consent_sms === true,
        idempotency_key: text(input.idempotency_key, 120),
      });
      return json({ ok: true, bundle: result }, 201);
    }
    requireAdmin(request, deps);
    if (path === "/api/conversion/status" && request.method === "GET") return json({ ok: true, readiness: deps.readiness() });
    const repo = repository(deps);
    await limit(deps, "operator:" + (deps.ip || "unknown"), 120);
    if (path === "/api/conversion/clients" && request.method === "GET") return json({ ok: true, clients: await repo.listClients() });
    if (path === "/api/conversion/clients" && request.method === "POST") {
      const client = validateClient(await body(request));
      if (await repo.getClient(client.id)) throw new ConversionError("CLIENT_EXISTS", "Use a different client ID or edit the existing client.", 409);
      return json({ ok: true, client: await repo.saveClient(client) }, 201);
    }
    const clientPath = /^\/api\/conversion\/clients\/([A-Za-z0-9_-]+)(\/key)?$/.exec(path);
    if (clientPath) {
      const clientId = id(clientPath[1]); const existing = await repo.getClient(clientId);
      if (!existing) throw new ConversionError("NOT_FOUND", "Client not found.", 404);
      if (clientPath[2] && request.method === "POST") {
        const key = "cv_" + randomBytes(32).toString("base64url");
        await repo.rotateClientKey(clientId, hash(key));
        return json({ ok: true, client_id: clientId, key });
      }
      if (!clientPath[2] && request.method === "PUT") {
        const client = validateClient(await body(request));
        if (client.id !== clientId || client.mode !== existing.mode) throw new ConversionError("IMMUTABLE_CLIENT", "Keep the client ID and mode. Create a separate client to change mode.");
        return json({ ok: true, client: await repo.saveClient(client) });
      }
      throw new ConversionError("METHOD_NOT_ALLOWED", "Use the supported client method.", 405);
    }
    if (path === "/api/conversion/leads" && request.method === "GET") {
      const clientId = url.searchParams.get("client_id");
      return json({ ok: true, leads: await repo.listLeads(clientId ? id(clientId) : undefined) });
    }
    const leadPath = /^\/api\/conversion\/leads\/([A-Za-z0-9_-]+)(\/(reply|handoff|resume))?$/.exec(path);
    if (leadPath) {
      const leadId = id(leadPath[1]);
      if (!leadPath[2] && request.method === "GET") return json({ ok: true, bundle: await bundle(repo, id(url.searchParams.get("client_id")), leadId) });
      if (leadPath[2] && request.method === "POST") {
        const input = await body(request); const clientId = id(input.client_id);
        const current = await bundle(repo, clientId, leadId);
        let result: LeadBundle | null;
        if (leadPath[3] === "reply") {
          if (current.lead.mode !== "demo") throw new ConversionError("LIVE_REPLY_FORBIDDEN", "Live replies must arrive through the verified SMS webhook.", 403);
          result = await deps.engine().receive({ client_id: clientId, lead_id: leadId, message: text(input.message, 2000), event_key: text(input.event_key, 120), channel: "website" });
        } else if (leadPath[3] === "handoff") result = await deps.engine().handoff(clientId, leadId, text(input.reason, 500, false) || "Paused by the operator.");
        else {
          if (current.lead.opted_out) throw new ConversionError("OPTED_OUT", "SMS consent was withdrawn. Do not resume this lead.", 409);
          result = await deps.engine().resume(clientId, leadId);
        }
        if (!result) throw new ConversionError("NOT_FOUND", "Lead not found.", 404);
        return json({ ok: true, bundle: result });
      }
      throw new ConversionError("METHOD_NOT_ALLOWED", "Use the supported lead method.", 405);
    }
    throw new ConversionError("NOT_FOUND", "API route not found.", 404);
  } catch (error) {
    const known = error instanceof ConversionError;
    const status = known ? error.status : 500;
    const code = known ? error.code : "AUTOMATION_ERROR";
    // Never log tokens, request bodies, phone numbers, messages or upstream response payloads.
    deps.log?.("conversion_api_error", { code, request_id: requestId });
    return json({ ok: false, code, error: known ? error.message : "The request could not be completed. The lead record is retained when it was already saved.", request_id: requestId }, status);
  }
}
