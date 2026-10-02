import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the actual shared TypeScript implementation, without Netlify or provider network calls.
const source = await readFile(new URL("../netlify/lib/workflow-core.mts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), []);
const { handleWorkflow, handleSubmission, persistentStorage } =
  await import("data:text/javascript;base64," + Buffer.from(compiled.outputText).toString("base64"));
const token = "synthetic-test-token-" + "x".repeat(40);
const id = "c5335b6d-f33e-4d73-842e-b84c1f372e42";
const input = { name: "Jamie Smith", email: "jamie@example.com", businessType: "real-estate",
  enquiry: "Can we arrange a viewing of the property this weekend?" };
const automation = { summary: "Property viewing enquiry.", category: "booking", priority: "medium",
  nextAction: "Check availability with the agent.", replyDraft: "Hi Jamie, what times suit you?" };
function clone(value) { return structuredClone(value); }
function memory() {
  const data = new Map(); let revision = 0;
  return {
    data,
    async get(key) { return data.has(key) ? clone(data.get(key).data) : null; },
    async getWithMetadata(key) { return data.has(key) ? clone(data.get(key)) : null; },
    async setJSON(key, value, conditions = {}) {
      if (conditions.onlyIfNew && data.has(key)) return { modified: false };
      if (conditions.onlyIfMatch && data.get(key)?.etag !== conditions.onlyIfMatch) return { modified: false };
      const etag = String(++revision); data.set(key, { data: clone(value), etag });
      return { modified: true, etag };
    },
    async delete(key) { data.delete(key); },
    async *list({ prefix }) { yield { blobs: [...data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
function fixture(settings = {}) {
  const blobs = memory(), calls = [];
  const values = { CALVREN_ADMIN_TOKEN: token, OPENAI_API_KEY: "synthetic-provider-key",
    CALVREN_DATA_ENV: "production", ...settings.values };
  const deps = {
    env: name => values[name], environment: settings.environment ?? "production",
    storage: () => blobs, uuid: () => id, now: () => "2026-10-02T12:00:00.000Z",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop",
        message: { content: JSON.stringify(automation) } }] }), { status: 200 });
    },
    ...settings.deps,
  };
  return { blobs, calls, values, deps };
}
function request(path, method = "GET", body, options = {}) {
  return new Request("https://calvren.example" + path, {
    method, headers: { Authorization: "Bearer " + token,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers },
    ...(body !== undefined ? { body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) } : {}),
  });
}
async function call(f, path, method = "GET", body, options) {
  const response = await handleWorkflow(request(path, method, body, options), f.deps);
  return { response, body: await response.json() };
}
async function saved(f) { return f.blobs.get("leads/" + id); }
function event(payload = {}) {
  return request("/.netlify/functions/submission-created", "POST", {
    payload: { id: "submission-one", form_name: "project-enquiry",
      data: { name: input.name, email: input.email, message: input.enquiry, consent: "yes",
        website: "", industry: "Real estate", business: "Example Realty" }, ...payload },
  });
}
async function submission(f, payload) {
  const response = await handleSubmission(event(payload), f.deps);
  return { response, body: await response.json() };
}

test("unauthenticated, wrong-token and unconfigured requests cannot access records", async () => {
  const f = fixture();
  for (const supplied of ["", "Bearer wrong", "Basic wrong"]) {
    const result = await call(f, "/api/leads", "GET", undefined, { headers: { Authorization: supplied } });
    assert.equal(result.response.status, 401);
    assert.ok(!("leads" in result.body));
  }
  f.values.CALVREN_ADMIN_TOKEN = "";
  assert.equal((await call(f, "/api/leads")).response.status, 503);
  assert.equal(f.calls.length, 0);
});
test("readiness reports configuration only and production context controls persistent storage", async () => {
  const f = fixture();
  const result = await call(f, "/api/status");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { providerConfigured: true, persistentStorage: true,
    websiteIntake: true, environment: "production", model: "gpt-4o-mini" });
  assert.equal(JSON.stringify(result.body).includes(token), false);
  assert.equal(persistentStorage("deploy-preview", "production"), false);
  assert.equal(persistentStorage("production", undefined), false);
  assert.equal(persistentStorage("production", "production"), true);
  const preview = fixture({ environment: "deploy-preview" });
  assert.equal((await call(preview, "/api/status")).body.persistentStorage, false);
});
test("method validation and content-type validation do not invoke AI", async () => {
  const f = fixture();
  assert.equal((await call(f, "/api/workflow", "GET")).response.status, 405);
  assert.equal((await call(f, "/api/status", "POST", {})).response.status, 405);
  assert.equal((await call(f, "/api/workflow", "POST", input, { headers: { "Content-Type": "text/plain" } })).response.status, 415);
  assert.equal(f.calls.length, 0);
});
test("malformed UTF-8, JSON, oversize bodies and invalid fields are rejected before saving", async () => {
  const f = fixture();
  for (const [payload, status] of [
    ["{", 400], [new Uint8Array([0xc3, 0x28]), 400], ["x".repeat(10_001), 413],
    [{ ...input, email: "invalid" }, 400], [{ ...input, enquiry: "short" }, 400],
    [{ ...input, instruction: "extra" }, 400], [{ ...input, name: "n".repeat(121) }, 400],
  ]) assert.equal((await call(f, "/api/workflow", "POST", payload)).response.status, status);
  assert.equal(f.blobs.data.size, 0);
  assert.equal(f.calls.length, 0);
});
test("valid intake is persisted before provider processing, then saved as an actual draft", async () => {
  const f = fixture();
  const provider = f.deps.fetch;
  f.deps.fetch = async (...args) => {
    const lead = await saved(f);
    assert.equal(lead.status, "new");
    assert.equal(lead.automation, null);
    assert.equal(lead.processingError, null);
    return provider(...args);
  };
  const result = await call(f, "/api/workflow", "POST", input);
  assert.equal(result.response.status, 201);
  assert.equal(result.body.lead.status, "draft");
  assert.deepEqual(result.body.lead.automation, automation);
  assert.equal(result.body.lead.source, "manual");
  const payload = JSON.parse(f.calls[0].options.body);
  assert.equal(f.calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(JSON.parse(payload.messages[1].content).email, undefined);
  assert.match(payload.messages[0].content, /Never claim an email was sent/);
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
});
test("missing AI key retains the enquiry and returns a retryable new record", async () => {
  const f = fixture({ values: { OPENAI_API_KEY: undefined } });
  const result = await call(f, "/api/workflow", "POST", input);
  assert.equal(result.response.status, 201);
  assert.equal(result.body.lead.status, "new");
  assert.equal(result.body.lead.automation, null);
  assert.match(result.body.warning, /OPENAI_API_KEY/);
  assert.equal((await saved(f)).enquiry, input.enquiry);
  assert.equal(f.calls.length, 0);
});
test("provider outage, busy response and timeout preserve intake with an error", async () => {
  for (const mode of ["offline", "busy", "timeout"]) {
    const f = fixture();
    if (mode === "timeout") f.deps.timeoutSignal = () => AbortSignal.abort();
    f.deps.fetch = async () => {
      if (mode === "busy") return new Response("", { status: 429 });
      throw new Error("synthetic private provider error");
    };
    const result = await call(f, "/api/workflow", "POST", input);
    assert.equal(result.response.status, 201);
    assert.equal(result.body.lead.status, "new");
    assert.equal(result.body.lead.automation, null);
    assert.ok(result.body.warning);
    assert.equal(result.body.warning.includes("synthetic private"), false);
    if (mode === "timeout") assert.match(result.body.warning, /timed out/);
  }
});
test("refused, truncated, malformed and out-of-schema provider output never becomes a draft", async () => {
  for (const choice of [
    { finish_reason: "length", message: { content: JSON.stringify(automation) } },
    { finish_reason: "stop", message: { refusal: "No", content: null } },
    { finish_reason: "stop", message: { content: "{" } },
    { finish_reason: "stop", message: { content: JSON.stringify({ ...automation, priority: "critical" }) } },
    { finish_reason: "stop", message: { content: JSON.stringify({ ...automation, summary: "x".repeat(801) }) } },
  ]) {
    const f = fixture();
    f.deps.fetch = async () => new Response(JSON.stringify({ choices: [choice] }), { status: 200 });
    const result = await call(f, "/api/workflow", "POST", input);
    assert.equal(result.body.lead.status, "new");
    assert.equal(result.body.lead.automation, null);
    assert.ok(result.body.warning);
  }
});
test("invalid model retains intake without provider calls", async () => {
  const f = fixture({ values: { OPENAI_MODEL: "invalid model value" } });
  const result = await call(f, "/api/workflow", "POST", input);
  assert.equal(result.response.status, 201);
  assert.match(result.body.warning, /OPENAI_MODEL/);
  assert.equal(f.calls.length, 0);
});
test("retry processes the saved original record and generated drafts do not duplicate provider work", async () => {
  const f = fixture({ values: { OPENAI_API_KEY: undefined } });
  await call(f, "/api/workflow", "POST", input);
  f.values.OPENAI_API_KEY = "synthetic-provider-key";
  let result = await call(f, "/api/leads/" + id + "/draft", "POST");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.lead.status, "draft");
  result = await call(f, "/api/leads/" + id + "/draft", "POST");
  assert.equal(result.body.lead.status, "draft");
  assert.equal(f.calls.length, 1);
});
test("only records with drafts can be reviewed; archived records cannot regenerate", async () => {
  const f = fixture({ values: { OPENAI_API_KEY: undefined } });
  await call(f, "/api/workflow", "POST", input);
  assert.equal((await call(f, "/api/leads/" + id, "PATCH", { status: "approved" })).response.status, 409);
  f.values.OPENAI_API_KEY = "synthetic-provider-key";
  await call(f, "/api/leads/" + id + "/draft", "POST");
  assert.equal((await call(f, "/api/leads/" + id, "PATCH", { status: "approved" })).body.lead.status, "approved");
  assert.equal((await call(f, "/api/leads/" + id + "/draft", "POST")).response.status, 409);
  assert.equal((await call(f, "/api/leads/" + id, "PATCH", { status: "archived" })).body.lead.status, "archived");
  assert.equal((await call(f, "/api/leads/" + id + "/draft", "POST")).response.status, 409);
});
test("permanent deletion removes the record and missing IDs return404", async () => {
  const f = fixture();
  await call(f, "/api/workflow", "POST", input);
  const result = await call(f, "/api/leads/" + id, "DELETE");
  assert.deepEqual(result.body, { deleted: true, id });
  assert.equal(await saved(f), null);
  assert.equal((await call(f, "/api/leads/" + id, "DELETE")).response.status, 404);
  assert.equal((await call(f, "/api/leads/" + id + "/draft", "POST")).response.status, 404);
});
test("draft processing cannot resurrect a deleted record", async () => {
  const f = fixture();
  f.deps.fetch = async () => {
    await f.blobs.delete("leads/" + id);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(automation) } }] }));
  };
  assert.equal((await call(f, "/api/workflow", "POST", input)).response.status, 409);
  assert.equal(await saved(f), null);
});
test("conditional processing does not overwrite a concurrent archive", async () => {
  const f = fixture();
  f.deps.fetch = async () => {
    const original = await saved(f);
    await f.blobs.setJSON("leads/" + id, { ...original, status: "archived" });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(automation) } }] }));
  };
  assert.equal((await call(f, "/api/workflow", "POST", input)).response.status, 409);
  assert.equal((await saved(f)).status, "archived");
});
test("storage failure before intake persistence does not spend provider calls", async () => {
  const f = fixture();
  f.blobs.setJSON = async () => { throw new Error("synthetic storage failure"); };
  assert.equal((await call(f, "/api/workflow", "POST", input)).response.status, 500);
  assert.equal(f.calls.length, 0);
});
test("existing records are listed backward-compatibly without mutating their data", async () => {
  const f = fixture();
  const legacy = { ...input, id, status: "draft", createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z", automation };
  await f.blobs.setJSON("leads/" + id, legacy);
  const result = await call(f, "/api/leads");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.leads[0].source, "manual");
  assert.equal(result.body.leads[0].business, "");
  assert.equal(result.body.leads[0].processingError, null);
  assert.deepEqual(await saved(f), legacy);
});
test("corrupt stored records fail closed", async () => {
  const f = fixture();
  await f.blobs.setJSON("leads/" + id, { ...input, id, status: "approved", automation: null });
  assert.equal((await call(f, "/api/leads")).response.status, 500);
});
test("verified website intake uses authoritative form metadata and preserves business", async () => {
  const f = fixture();
  const result = await submission(f);
  assert.equal(result.response.status, 202);
  assert.equal(result.body.accepted, true);
  const records = (await call(f, "/api/leads")).body.leads;
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "website");
  assert.equal(records[0].business, "Example Realty");
  assert.equal(records[0].businessType, "real-estate");
});
test("repeat platform event IDs are atomic duplicates and cannot overwrite prior input", async () => {
  const f = fixture();
  const first = await submission(f);
  const second = await submission(f, { data: { name: "Changed", email: "changed@example.com",
    message: "Changed content that must not overwrite the original record.", consent: "yes" } });
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal(f.calls.length, 1);
  assert.equal((await call(f, "/api/leads")).body.leads[0].name, input.name);
});
test("reviews, absent consent and honeypots never invoke provider or store lead data", async () => {
  for (const payload of [
    { form_name: "client-insight" },
    { data: { name: input.name, email: input.email, message: input.enquiry, consent: "no" } },
    { data: { name: input.name, email: input.email, message: input.enquiry, consent: "yes", website: "spam" } },
  ]) {
    const f = fixture();
    assert.equal((await submission(f, payload)).body.accepted, false);
    assert.equal(f.blobs.data.size, 0);
    assert.equal(f.calls.length, 0);
  }
});
test("production marker on a preview never enables the form bridge", async () => {
  const f = fixture({ environment: "deploy-preview" });
  assert.equal((await submission(f)).body.accepted, false);
  assert.equal(f.blobs.data.size, 0);
});
test("website bounds and platform ID validation reject invalid events", async () => {
  for (const payload of [
    { id: "../../anything" },
    { data: { name: "n".repeat(121), email: input.email, message: input.enquiry, consent: "yes" } },
    { data: { name: input.name, email: input.email, message: "x".repeat(3001), consent: "yes" } },
    { data: { name: input.name, email: input.email, message: input.enquiry, consent: "yes", business: "b".repeat(161) } },
  ]) {
    const f = fixture();
    assert.equal((await submission(f, payload)).response.status, 400);
    assert.equal(f.blobs.data.size, 0);
  }
});
test("distinct submission IDs remain distinct even for identical enquiries", async () => {
  const f = fixture();
  await submission(f);
  await submission(f, { id: "submission-two" });
  assert.equal((await call(f, "/api/leads")).body.leads.length, 2);
});
test("an AI outage during website intake retains a retryable record", async () => {
  const f = fixture({ values: { OPENAI_API_KEY: undefined } });
  assert.equal((await submission(f)).body.accepted, true);
  const record = (await call(f, "/api/leads")).body.leads[0];
  assert.equal(record.status, "new");
  assert.ok(record.processingError);
  assert.equal(record.automation, null);
});
