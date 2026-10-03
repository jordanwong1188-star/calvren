import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";

const temporary = await mkdtemp(join(tmpdir(), "calvren-api-"));
async function compile(path) {
  const target = join(temporary, path.replace(/\.mts$/, ".mjs"));
  await mkdir(resolve(target, ".."), { recursive: true });
  const source = await readFile(path, "utf8");
  await writeFile(target, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
for (const name of await readdir("src/conversion")) if (name.endsWith(".mts")) await compile("src/conversion/" + name);
await compile("netlify/lib/conversion-api.mts");
const { handleConversion, adminAuthorized } = await import(pathToFileURL(join(temporary, "netlify/lib/conversion-api.mjs")));
const { ConversionError } = await import(pathToFileURL(join(temporary, "src/conversion/contracts.mjs")));
const { newDemoClient } = await import(pathToFileURL(join(temporary, "src/conversion/demo-config.mjs")));
test.after(async () => rm(temporary, { recursive: true, force: true }));

const TOKEN = "operator-test-token-with-at-least-thirty-two-chars";
const CLIENT_KEY = "cv_client-intake-key-with-thirty-two-characters";
const hash = value => createHash("sha256").update(value).digest("hex");
const leadId = "lead-test-001";
function fixture({ database = true, mode = "demo", authorizedClient = "abc-plumbing-demo", signatureError = false } = {}) {
  const client = newDemoClient({ mode, calendar: { provider: mode === "live" ? "google" : "demo", calendar_id: "calendar@example.com", duration_minutes: 60, horizon_days: 14, buffer_minutes: 15 } });
  const current = { lead: { id: leadId, client_id: client.id, mode, opted_out: false, phone: "+16045550111", status: "responding" }, messages: [], appointments: [], notifications: [] };
  const events = []; const keys = new Map([[authorizedClient, hash(CLIENT_KEY)]]);
  const repo = {
    async consumeRateLimit() { events.push("limit"); return true; },
    async verifyClientKey(id, value) { events.push("key:" + id); return keys.get(id) === value; },
    async rotateClientKey(id, value) { keys.set(id, value); },
    async getClient(id) { events.push("client:" + id); return id === client.id ? client : null; },
    async listClients() { events.push("clients"); return [client]; },
    async saveClient(value) { return value; },
    async listLeads(id) { return !id || id === client.id ? [current] : []; },
    async getBundle(clientId, id) { events.push("bundle"); return clientId === client.id && id === leadId ? current : null; },
    async findLeadByPhone(clientId, phone) { events.push("phone:" + clientId + ":" + phone); return clientId === client.id && phone === current.lead.phone ? current : null; },
    async updateMessageStatus(...args) { events.push(["status", ...args]); return true; },
  };
  const engine = {
    async intake(input) { events.push(["intake", input]); return current; },
    async receive(input) { events.push(["receive", input]); return current; },
    async handoff(...args) { events.push(["handoff", ...args]); return current; },
    async resume(...args) { events.push(["resume", ...args]); return current; },
  };
  const deps = {
    env: name => name === "CALVREN_ADMIN_TOKEN" ? TOKEN : undefined,
    repository: database ? repo : null, engine: () => engine, ip: "127.0.0.1",
    readiness: () => ({ database, admin: true, mode: "demo", production: false, providers: { openai: false, twilio: false, google: false, notifications: false }, server_demo: database, browser_demo: true, issues: [] }),
    async verifyWebhook(request) { events.push("signature"); if (signatureError) throw new ConversionError("INVALID_SIGNATURE", "Invalid signature.", 401); return Object.fromEntries(new URLSearchParams(await request.text())); },
  };
  return { client, current, repo, deps, events, keys };
}
function request(path, { method = "GET", token = TOKEN, data } = {}) {
  return new Request("https://calvren.netlify.app" + path, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(data !== undefined ? { "content-type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
function intake(clientId = "abc-plumbing-demo") { return { client_id: clientId, name: "Fake lead", phone: "+16045550111", message: "My kitchen sink is leaking.", channel: "sms", consent_sms: true, idempotency_key: "demo-intake-001" }; }

test("operator authorization is required before any tenant reads", async () => {
  const f = fixture();
  const response = await handleConversion(request("/api/conversion/leads", { token: "invalid-operator-token-for-test" }), f.deps);
  assert.equal(response.status, 401); assert.deepEqual(f.events, []);
  assert.equal(adminAuthorized(request("/"), TOKEN), true);
  assert.equal(adminAuthorized(request("/", { token: TOKEN + "x" }), TOKEN), false);
});
test("setup status is available without pretending server records are durable", async () => {
  const f = fixture({ database: false });
  const response = await handleConversion(request("/api/conversion/status"), f.deps);
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.readiness.database, false); assert.equal(result.readiness.browser_demo, true);
  assert.equal((await handleConversion(request("/api/conversion/clients"), f.deps)).status, 503);
});
test("tenant intake key cannot submit a lead for another client", async () => {
  const f = fixture({ mode: "live" });
  const response = await handleConversion(request("/api/leads", { method: "POST", token: CLIENT_KEY, data: intake("another-business") }), f.deps);
  assert.equal(response.status, 401);
  assert.ok(!f.events.some(value => Array.isArray(value) && value[0] === "intake"));
  assert.ok(!f.events.some(value => String(value).startsWith("client:")));
});
test("authorized live intake carries SMS consent and idempotency to the core", async () => {
  const f = fixture({ mode: "live" });
  const response = await handleConversion(request("/api/leads", { method: "POST", token: CLIENT_KEY, data: intake() }), f.deps);
  assert.equal(response.status, 201);
  const sent = f.events.find(value => Array.isArray(value) && value[0] === "intake")[1];
  assert.equal(sent.client_id, f.client.id); assert.equal(sent.consent_sms, true); assert.equal(sent.idempotency_key, "demo-intake-001");
});
test("oversized input and fake honeypot do not run an automation", async () => {
  const f = fixture();
  const oversized = new Request("https://calvren.netlify.app/api/leads", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({ ...intake(), message: "x".repeat(40000) }) });
  assert.equal((await handleConversion(oversized, f.deps)).status, 413);
  assert.equal((await handleConversion(request("/api/leads", { method: "POST", data: { ...intake(), website: "spam" } }), f.deps)).status, 400);
  assert.ok(!f.events.some(value => Array.isArray(value) && value[0] === "intake"));
});
test("client key rotation returns a secret once and stores only its hash", async () => {
  const f = fixture();
  const response = await handleConversion(request("/api/conversion/clients/" + f.client.id + "/key", { method: "POST" }), f.deps);
  const result = await response.json(); assert.equal(response.status, 200); assert.match(result.key, /^cv_/);
  assert.equal(f.keys.get(f.client.id), hash(result.key)); assert.notEqual(f.keys.get(f.client.id), result.key);
});
test("operators cannot convert demo client identity into live mode", async () => {
  const f = fixture();
  const response = await handleConversion(request("/api/conversion/clients/" + f.client.id, { method: "PUT", data: { ...f.client, mode: "live", calendar: { ...f.client.calendar, provider: "google" } } }), f.deps);
  assert.equal(response.status, 400);
});
test("live lead reply simulation is forbidden and opted-out leads cannot resume", async () => {
  const f = fixture({ mode: "live" });
  const path = "/api/conversion/leads/" + leadId;
  assert.equal((await handleConversion(request(path + "/reply", { method: "POST", data: { client_id: f.client.id, message: "fake reply", event_key: "reply-001" } }), f.deps)).status, 403);
  f.current.lead.opted_out = true;
  assert.equal((await handleConversion(request(path + "/resume", { method: "POST", data: { client_id: f.client.id } }), f.deps)).status, 409);
  assert.ok(!f.events.some(value => Array.isArray(value) && value[0] === "resume"));
});
test("Twilio verification occurs before tenant resolution", async () => {
  const f = fixture({ mode: "live", signatureError: true });
  const response = await handleConversion(new Request("https://calvren.netlify.app/api/conversion/twilio/inbound", { method: "POST", body: "To=%2B15555550100" }), f.deps);
  assert.equal(response.status, 401); assert.deepEqual(f.events, ["signature"]);
});
test("unknown SMS senders are acknowledged without creating a lead", async () => {
  const f = fixture({ mode: "live" });
  const data = new URLSearchParams({ To: f.client.phone_number, From: "+16045550999", MessageSid: "SM" + "a".repeat(32), Body: "hello" });
  const response = await handleConversion(new Request("https://calvren.netlify.app/api/conversion/twilio/inbound", { method: "POST", body: data }), f.deps);
  assert.equal(response.status, 200); assert.match(await response.text(), /<Response\/>/);
  assert.ok(!f.events.some(value => Array.isArray(value) && value[0] === "receive"));
});
test("verified STOP reaches the core even if a normal SMS rate budget is exhausted", async () => {
  const f = fixture({ mode: "live" }); f.repo.consumeRateLimit = async () => { throw new Error("STOP must bypass normal SMS throttle"); };
  const data = new URLSearchParams({ To: f.client.phone_number, From: f.current.lead.phone, MessageSid: "SM" + "b".repeat(32), Body: "STOP" });
  const response = await handleConversion(new Request("https://calvren.netlify.app/api/conversion/twilio/inbound", { method: "POST", body: data }), f.deps);
  assert.equal(response.status, 200);
  const received = f.events.find(value => Array.isArray(value) && value[0] === "receive")[1]; assert.equal(received.event_key, "twilio:SM" + "b".repeat(32));
});
test("SMS status callback scopes updates to verified tenant, customer and provider SID", async () => {
  const f = fixture({ mode: "live" });
  const data = new URLSearchParams({ From: f.client.phone_number, To: f.current.lead.phone, MessageSid: "SM" + "c".repeat(32), MessageStatus: "undelivered" });
  const response = await handleConversion(new Request("https://calvren.netlify.app/api/conversion/twilio/status?message_id=message-test-001", { method: "POST", body: data }), f.deps);
  assert.equal(response.status, 200);
  const update = f.events.find(value => Array.isArray(value) && value[0] === "status");
  assert.deepEqual(update.slice(1, 5), [f.client.id, leadId, "SM" + "c".repeat(32), "failed"]);
  assert.ok(f.events.some(value => Array.isArray(value) && value[0] === "handoff"));
});

test("live website submissions use SMS rather than starting an unreachable website conversation", async () => {
  const f = fixture({ mode: "live" });
  const input = intake(); delete input.channel;
  const response = await handleConversion(request("/api/leads", { method: "POST", token: CLIENT_KEY, data: input }), f.deps);
  assert.equal(response.status, 201);
  assert.equal(f.events.find(value => Array.isArray(value) && value[0] === "intake")[1].channel, "sms");
  assert.equal((await handleConversion(request("/api/leads", { method: "POST", token: CLIENT_KEY, data: { ...input, channel: "website" } }), f.deps)).status, 400);
});
test("a signed callback passes stable message identity for timeout reconciliation", async () => {
  const f = fixture({ mode: "live" });
  const data = new URLSearchParams({ From: f.client.phone_number, To: f.current.lead.phone, MessageSid: "SM" + "d".repeat(32), MessageStatus: "delivered" });
  const response = await handleConversion(new Request("https://calvren.netlify.app/api/conversion/twilio/status?message_id=message-test-001", { method: "POST", body: data }), f.deps);
  assert.equal(response.status, 200);
  const update = f.events.find(value => Array.isArray(value) && value[0] === "status");
  assert.equal(update.at(-1), "message-test-001");
  assert.ok(!f.events.some(value => Array.isArray(value) && value[0] === "resume"));
});
