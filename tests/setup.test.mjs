import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, lstat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  SITE_ID, PUBLIC_URL, SetupError, validateAdminToken, ownedPublicURL, serializeEnv, writePrivateEnv, googleAccountFromFile,
  netlifyURL, createNetlifyRequest, envMutation, syncNetlifyEnvironment,
  checkSupabaseSchema, supabaseProjectURL, setupDefaults, generateAdminToken
} from "../scripts/setup-helpers.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
test("private env serialization preserves PEM, literal backslashes/dollars/hashes and unknown values", () => {
  const env = { NORMAL: "one", HASH: "a#b$token", PEM: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
    ESCAPED: "a\\b\\c", QUOTED: "customer's value", UNKNOWN_EXISTING: "keep me" };
  assert.deepEqual(parseEnv(serializeEnv(env)), env);
  assert.throws(() => serializeEnv({ BAD: "\0" }), SetupError);
  assert.throws(() => serializeEnv({ "BAD\nEVIL": "x" }), SetupError);
});
test("generated operator tokens contain sufficient random bytes and are unique", () => {
  const a = generateAdminToken(); const b = generateAdminToken();
  assert.equal(Buffer.from(a, "base64url").length, 32); assert.notEqual(a, b);
  assert.equal(setupDefaults().CALVREN_AUTOMATION_MODE, "demo");
  assert.equal(setupDefaults().CALVREN_PUBLIC_URL, PUBLIC_URL);
});
test("private env write sets mode600 and rejects env/netlify symlink paths", async t => {
  const base = await mkdtemp(resolve(tmpdir(), "calvren-setup-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = resolve(base, "project"); await mkdir(project);
  await writePrivateEnv(project, { SAFE: "private" });
  assert.equal((await lstat(resolve(project, ".env"))).mode & 0o777, 0o600);
  assert.equal((await lstat(resolve(project, ".netlify"))).mode & 0o777, 0o700);
  assert.equal(await readFile(resolve(project, ".env"), "utf8"), "SAFE='private'\n");
  await rm(resolve(project, ".env")); await symlink(resolve(base, "outside"), resolve(project, ".env"));
  await assert.rejects(writePrivateEnv(project, { SAFE: "new" }), /symbolic link/);
  await rm(resolve(project, ".env")); await rm(resolve(project, ".netlify"), { recursive: true });
  await mkdir(resolve(base, "outside-dir")); await symlink(resolve(base, "outside-dir"), resolve(project, ".netlify"));
  await assert.rejects(writePrivateEnv(project, { SAFE: "new" }), /symbolic link/);
});
test("Google account JSON must resolve outside deploy source, including symlink aliases", async t => {
  const base = await mkdtemp(resolve(tmpdir(), "calvren-google-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = resolve(base, "project"); await mkdir(project);
  const account = { type: "service_account", client_email: "service@demo.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n" };
  const outside = resolve(base, "account.json"); await writeFile(outside, JSON.stringify(account));
  const imported = await googleAccountFromFile(outside, project);
  assert.equal(imported.GOOGLE_SERVICE_ACCOUNT_EMAIL, account.client_email);
  const inside = resolve(project, "account.json"); await writeFile(inside, JSON.stringify(account));
  await assert.rejects(googleAccountFromFile(inside, project), /outside the project/);
  const alias = resolve(base, "alias.json"); await symlink(inside, alias);
  await assert.rejects(googleAccountFromFile(alias, project), /outside the project/);
});
test("Netlify requests cannot send owner authorization to another origin and raw provider errors are redacted", async () => {
  for (const path of ["https://evil.example/", "//evil.example/x", "/../../../outside", "/\\evil.example"]) {
    assert.throws(() => netlifyURL(path), SetupError);
  }
  let calls = 0;
  const request = createNetlifyRequest("OWNER_PRIVATE", async (url, options) => {
    calls++; assert.equal(new URL(url).origin, "https://api.netlify.com");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer OWNER_PRIVATE");
    return json({ message: "Echo SECRET_SUBMITTED_VALUE" }, 403);
  });
  await assert.rejects(request("/sites/" + SITE_ID), error => !error.message.includes("SECRET_SUBMITTED_VALUE") && error.status === 403);
  assert.equal(calls, 1);
});
test("masked cross-context secrets use PATCH without copying or changing other values", () => {
  const old = { key: "OPENAI_API_KEY", is_secret: true, scopes: ["builds","functions"],
    values: [{ context: "production", value: "********" }, { context: "deploy-preview", value: "********" }] };
  const mutation = envMutation(old, "OPENAI_API_KEY", "NEW_PRIVATE");
  assert.equal(mutation.method, "PATCH"); assert.deepEqual(mutation.body, { context: "production", value: "NEW_PRIVATE" });
  assert.equal(mutation.metadataPreserved, true); assert.ok(!JSON.stringify(mutation.body).includes("********"));
});
test("production-only metadata repair uses known replacement, preserving readable unrelated contexts", () => {
  const secret = envMutation({ is_secret: true, scopes: ["builds","functions"],
    values: [{ context: "production", value: "********" }] }, "OPENAI_API_KEY", "NEW");
  assert.equal(secret.method, "PUT"); assert.deepEqual(secret.body.values, [{ context: "production", value: "NEW" }]);
  const readable = envMutation({ is_secret: false, scopes: ["builds","functions"],
    values: [{ context: "production", value: "OLD" }, { context: "branch", context_parameter: "staging", value: "KEEP" }] }, "OPENAI_API_KEY", "NEW");
  assert.equal(readable.method, "PUT"); assert.deepEqual(readable.body.values[0], { context: "branch", context_parameter: "staging", value: "KEEP" });
  assert.equal(readable.body.is_secret, true);
});
test("Netlify sync touches only known site keys and preserves an existing live mode", async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/sites/" + SITE_ID)) return json({ id: SITE_ID, account_slug: "owner" });
    if (options.method === "GET") return json([
      { key: "CALVREN_AUTOMATION_MODE", is_secret: false, scopes: ["functions"], values: [{ context: "production", value: "live" }] },
      { key: "UNRELATED", scopes: ["builds"], values: [{ context: "all", value: "KEEP" }] }
    ]);
    return json([]);
  };
  const result = await syncNetlifyEnvironment({ CALVREN_AUTOMATION_MODE: "demo", OPENAI_API_KEY: "PRIVATE" }, "OWNER", fetchMock);
  assert.equal(result.preservedLiveMode, true);
  const writes = calls.filter(c => c.options.method !== "GET");
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].options.body);
  assert.equal(body[0].key, "OPENAI_API_KEY"); assert.equal(body[0].is_secret, true);
  assert.deepEqual(body[0].scopes, ["functions"]); assert.equal(body[0].values[0].context, "production");
});
test("only a documented scope-plan refusal permits default scopes, not arbitrary authorization failures", async () => {
  let writes = 0;
  const fetchMock = async (url, options) => {
    if (url.endsWith("/sites/" + SITE_ID)) return json({ id: SITE_ID, account_slug: "owner" });
    if (options.method === "GET") return json([]);
    writes++;
    return writes === 1 ? json({ message: "Granular scopes are not available on your plan; upgrade to Pro plan" }, 422) : json([]);
  };
  const result = await syncNetlifyEnvironment({ OPENAI_API_KEY: "PRIVATE" }, "OWNER", fetchMock);
  assert.deepEqual(result.defaultScopes, ["OPENAI_API_KEY"]); assert.equal(writes, 2);
  writes = 0;
  const denied = async (url, options) => {
    if (url.endsWith("/sites/" + SITE_ID)) return json({ id: SITE_ID, account_slug: "owner" });
    if (options.method === "GET") return json([]);
    writes++; return json({ message: "Permission denied SECRET" }, 403);
  };
  await assert.rejects(syncNetlifyEnvironment({ OPENAI_API_KEY: "PRIVATE" }, "OWNER", denied), /HTTP 403/);
  assert.equal(writes, 1);
});
test("Supabase keys are restricted to the canonical project host and schema checks are read-only", async () => {
  for (const url of ["http://example.supabase.co","https://evil.example","https://user:pass@example.supabase.co",
    "https://example.supabase.co/path","https://example.supabase.co?next=evil"]) assert.throws(() => supabaseProjectURL(url), SetupError);
  let calls = 0;
  const result = await checkSupabaseSchema({ SUPABASE_URL: "https://abc123.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_PRIVATE" }, async (url, options) => {
    calls++; assert.equal(new URL(url).origin, "https://abc123.supabase.co");
    assert.equal(options.method, undefined); assert.equal(options.redirect, "error");
    assert.equal(options.headers.apikey, "sb_secret_PRIVATE"); assert.equal(options.headers.Authorization, undefined);
    return json([]);
  });
  assert.equal(result.ready, true); assert.equal(calls, 1);
});

test("existing owned public URL is preserved and arbitrary origins are rejected", () => {
  const site = { custom_domain: "calvren.example", domain_aliases: ["www.calvren.example"] };
  assert.equal(ownedPublicURL("https://calvren.example", site), true);
  assert.equal(ownedPublicURL(PUBLIC_URL, site), true);
  assert.equal(ownedPublicURL("https://attacker.example", site), false);
  assert.equal(ownedPublicURL("https://calvren.example/path", site), false);
  assert.equal(ownedPublicURL("https://owner:secret@calvren.example", site), false);
});
test("secret conversion never corrupts a readable inherited all-context value", () => {
  const old = { is_secret: false, scopes: ["functions","builds"], values: [{ context: "all", value: "KEEP_DEFAULT" }] };
  const mutation = envMutation(old, "OPENAI_API_KEY", "NEW_PRIVATE");
  assert.equal(mutation.method, "PATCH"); assert.equal(mutation.metadataPreserved, true);
  assert.deepEqual(mutation.body, { context: "production", value: "NEW_PRIVATE" });
});

test("operator token validation matches protected API boundaries without exposing malformed values", () => {
  assert.equal(validateAdminToken("x".repeat(32)), "x".repeat(32));
  for (const value of ["short", "x".repeat(1025), "x".repeat(32) + "\nPRIVATE", "x".repeat(32) + " SPACE"]) {
    assert.throws(() => validateAdminToken(value), error => error instanceof SetupError && !error.message.includes(value));
  }
});
test("apostrophe plus literal backslash-n is preserved or rejected before the original env changes", () => {
  const env = { COMPLEX: "owner's literal\\nvalue" };
  try { assert.deepEqual(parseEnv(serializeEnv(env)), env); }
  catch (error) { assert.ok(error instanceof SetupError); assert.equal(error.code, "ENV_ROUNDTRIP"); }
});
