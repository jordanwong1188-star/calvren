#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import {
  SITE_ID, PUBLIC_URL, SetupError, setupDefaults, generateAdminToken, missingLiveKeys,
  validateAdminToken, writePrivateEnv, googleAccountFromFile, syncNetlifyEnvironment, checkSupabaseSchema
} from "./setup-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const help = [
  "Calvren owner setup",
  "  npm run setup              Securely collect missing keys, publish, and test the server demo.",
  "  npm run setup -- --check   Offline installation check; no login, secrets, network, or changes.",
  "  npm run setup -- --help    Show this help.",
  "",
  "Run on your own computer inside this repository with Node 22.13+.",
  "Blank credentials are allowed: the public browser demo can publish without providers.",
  "The wizard never activates live SMS/email/calendar delivery. Account creation and billing",
  "are completed by you in each provider dashboard. Do not paste private keys into chat.",
  "Full instructions: docs/setup-now.md"
].join("\n");
function log(message) { process.stdout.write(message + "\n"); }
async function installedCLI() {
  const packagePath = require.resolve("netlify-cli/package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  if (pkg.version !== "27.10.2") throw new SetupError("CLI_VERSION", "Run npm install to install the pinned Netlify CLI 27.10.2.");
  const cliRequire = createRequire(packagePath);
  const utils = await import(pathToFileURL(cliRequire.resolve("@netlify/dev-utils")).href);
  if (typeof utils.getAPIToken !== "function") throw new SetupError("CLI_AUTH_EXPORT", "The installed CLI authentication utility is unavailable; run npm install.");
  return { bin: resolve(dirname(packagePath), "bin/run.js"), getAPIToken: utils.getAPIToken };
}
async function checkProject() {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (typeof pkg.name !== "string" || !pkg.name.toLowerCase().includes("calvren")) throw new SetupError("PROJECT", "Run this wizard from the Calvren repository.");
  const config = await readFile(resolve(root, "netlify.toml"), "utf8");
  if (!/publish\s*=\s*"public"/.test(config) || !/directory\s*=\s*"netlify\/functions"/.test(config)) {
    throw new SetupError("PROJECT", "The expected Calvren deployment configuration is missing.");
  }
  const ignore = await readFile(resolve(root, ".gitignore"), "utf8");
  if (!/^\.env\s*$/m.test(ignore) || !/^\.netlify\/\s*$/m.test(ignore)) throw new SetupError("PROJECT", "Private environment files must be ignored before setup.");
}
async function privateLocalEnvironment() {
  const path = resolve(root, ".env");
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 128 * 1024) throw new SetupError("UNSAFE_ENV", "Use a normal, private .env file in the project root.");
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}
function runCLI(bin, args, { capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    // Only the CLI's own local login is used. Provider values are not passed to child arguments/environment.
    const childEnv = { ...process.env };
    for (const name of ["CALVREN_ADMIN_TOKEN","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY","OPENAI_API_KEY",
      "TWILIO_AUTH_TOKEN","GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY","RESEND_API_KEY","NETLIFY_AUTH_TOKEN"]) delete childEnv[name];
    for (const name of ["DEBUG", "NETLIFY_LOG_LEVEL", "NETLIFY_DEBUG", "NETLIFY_CLI_DEBUG"]) delete childEnv[name];
    childEnv.NETLIFY_TELEMETRY_DISABLED = "1";
    const child = spawn(process.execPath, [bin, ...args], { cwd: root, env: childEnv,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", shell: false });
    let output = "";
    if (capture) { child.stdout.on("data", chunk => { if (output.length < 1024 * 1024) output += chunk; }); child.stderr.resume(); }
    child.on("error", () => reject(new SetupError("CLI_START", "The Netlify CLI could not start.")));
    child.on("exit", code => code === 0 ? resolvePromise(output) : reject(new SetupError("CLI_FAILED", "The Netlify command failed. Run it again after completing its browser login or account setup.")));
  });
}
function hiddenInput(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError("TTY_REQUIRED", "Run setup in your own interactive terminal so private keys are hidden.");
  return new Promise((resolvePromise, reject) => {
    process.stdout.write(label + " (hidden; Enter skips): ");
    let value = "";
    const previous = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.resume();
    function cleanup() { process.stdin.off("data", receive); process.stdin.setRawMode(previous); process.stdin.pause(); process.stdout.write("\n"); }
    function receive(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\x03" || character === "\x04") { cleanup(); reject(new SetupError("CANCELLED", "Setup stopped; completed local steps remain saved.")); return; }
        if (character === "\r" || character === "\n") { cleanup(); resolvePromise(value.trim()); return; }
        if (character === "\x7f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && character !== "\x7f") value += character;
        if (value.length > 20000) { cleanup(); reject(new SetupError("INPUT_TOO_LONG", "The credential is too long.")); return; }
      }
    }
    process.stdin.on("data", receive);
  });
}
async function plainInput(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(label + " (Enter skips): ")).trim(); } finally { rl.close(); }
}
async function collect(env) {
  const groups = [
    ["Supabase", "https://supabase.com/dashboard", [
      ["SUPABASE_URL", "Dedicated Calvren project URL", false],
      ["SUPABASE_SECRET_KEY", "Project secret key (sb_secret_... or legacy service_role)", true]
    ]],
    ["OpenAI", "https://platform.openai.com/api-keys", [["OPENAI_API_KEY", "OpenAI API key", true]]],
    ["Twilio", "https://console.twilio.com/", [
      ["TWILIO_ACCOUNT_SID", "Twilio account SID", true],
      ["TWILIO_AUTH_TOKEN", "Twilio auth token", true],
      ["TWILIO_PHONE_NUMBER", "Optional fallback SMS number, including +country code", false]
    ]],
    ["Resend", "https://resend.com/api-keys", [
      ["RESEND_API_KEY", "Resend API key", true],
      ["NOTIFICATION_FROM_EMAIL", "Verified sender email", false]
    ]]
  ];
  for (const [title, url, fields] of groups) {
    if (fields.every(([key]) => env[key])) continue;
    log("\n" + title + ": " + url);
    for (const [key, label, secret] of fields) {
      if (env[key]) continue;
      const value = secret ? await hiddenInput(label) : await plainInput(label);
      if (value) {
        if (/[\r\n\0]/.test(value)) throw new SetupError("INVALID_INPUT", "Use a single-line value for " + key + ".");
        env[key] = value;
      }
    }
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    log("\nGoogle Calendar: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com");
    log("Enable Calendar API, create a service account and download its JSON key outside this project.");
    log("Share each business calendar with that account with permission to make changes to events.");
    const path = await plainInput("Path to the downloaded service account JSON");
    if (path) Object.assign(env, await googleAccountFromFile(path, root));
  }
  return env;
}
async function ensureLinked(bin) {
  try {
    const statePath = resolve(root, ".netlify/state.json");
    if ((await lstat(resolve(root, ".netlify"))).isSymbolicLink() || (await lstat(statePath)).isSymbolicLink()) {
      throw new SetupError("UNSAFE_PATH", "The Netlify state directory/file must not be a symbolic link.");
    }
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.siteId && state.siteId !== SITE_ID) throw new SetupError("WRONG_LINK", "This folder is linked to a different Netlify project. Use a fresh Calvren checkout.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await runCLI(bin, ["link", "--id", SITE_ID]);
}
async function calvrenRequest(token, path, method = "GET", body) {
  if (!/^\/api\/conversion\/[A-Za-z0-9_/?=&%-]+$/.test(path)) throw new SetupError("APP_PATH", "Invalid Calvren API path.");
  let response;
  try {
    response = await fetch(PUBLIC_URL + path, { method, redirect: "error", signal: AbortSignal.timeout(25000),
      headers: { Authorization: "Bearer " + token, Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new SetupError("APP_NETWORK", "The published Calvren API could not be reached."); }
  let data;
  try { data = await response.json(); } catch { throw new SetupError("APP_NOT_PUBLISHED", "The new Calvren API is not published yet."); }
  if (!response.ok || data.ok !== true) throw new SetupError("APP_API", "Calvren API verification failed (HTTP " + response.status + "). Check deployment and database setup.", response.status);
  return data;
}
async function serverDemo(env) {
  const request = (path, method, body) => calvrenRequest(env.CALVREN_ADMIN_TOKEN, path, method, body);
  const { readiness } = await request("/api/conversion/status");
  log("Published operator authentication and API: verified.");
  log("Runtime mode: " + readiness.mode + ". Provider readiness reports configuration presence only.");
  if (!readiness.database) { log("Server records need Supabase. The public browser demo is ready."); return; }
  const { newDemoClient } = await import(pathToFileURL(resolve(root, "public/conversion/demo-config.mjs")).href);
  const config = newDemoClient({ id: "calvren-setup-demo-v1" });
  const { clients } = await request("/api/conversion/clients");
  let client = clients.find(item => item.id === config.id);
  if (!client) client = (await request("/api/conversion/clients", "POST", config)).client;
  if (client.mode !== "demo" || !client.active || client.business_name !== config.business_name ||
      JSON.stringify(client.qualifying_questions) !== JSON.stringify(config.qualifying_questions) ||
      client.calendar.provider !== "demo") {
    throw new SetupError("DEMO_CONFIG_CHANGED", "The reserved setup demo was modified. Use the operator dashboard to test that configuration.");
  }
  const { leads } = await request("/api/conversion/leads?client_id=" + config.id);
  let bundle = leads.find(item => item.lead.source === "calvren-owner-setup");
  if (!bundle) {
    bundle = (await request("/api/conversion/leads", "POST", {
      client_id: config.id, name: "Calvren setup example", message: "Hi, my kitchen sink is leaking and I need someone to look at it.",
      source: "calvren-owner-setup", channel: "website", consent_sms: false,
      idempotency_key: "calvren-owner-setup-demo-v1"
    })).bundle;
  }
  if (bundle.lead.mode !== "demo") throw new SetupError("DEMO_MODE", "The setup verification must remain in demo mode.");
  const replies = { service: "Leak repair", emergency: "Not an emergency; it can wait for a routine appointment.", area: "Vancouver", timing: "Tomorrow" };
  for (let attempt = 0; attempt < 8 && bundle.lead.appointment_status !== "booked"; attempt++) {
    if (!bundle.lead.automation_active) throw new SetupError("DEMO_PAUSED", "The setup demo lead was paused. Its conversation is saved in the operator dashboard.");
    let message; let event;
    if (bundle.lead.offered_slots?.length) { message = "1"; event = "calvren-owner-setup-book-v1"; }
    else {
      const missing = config.qualifying_questions.find(q => q.required && !bundle.lead.answers[q.id]);
      if (!missing) throw new SetupError("DEMO_FLOW", "The demo did not offer an appointment after qualification.");
      message = replies[missing.id]; event = "calvren-owner-setup-answer-v1-" + missing.id;
    }
    bundle = (await request("/api/conversion/leads/" + bundle.lead.id + "/reply", "POST", {
      client_id: config.id, message, event_key: event
    })).bundle;
  }
  const saved = (await request("/api/conversion/leads/" + bundle.lead.id + "?client_id=" + config.id)).bundle;
  if (saved.lead.status !== "booked" || saved.lead.qualification_status !== "qualified" ||
      !saved.appointments.some(a => a.status === "booked") ||
      !saved.notifications.some(n => n.event === "booked" && n.status === "sent") ||
      saved.messages.length < 4) throw new SetupError("DEMO_FLOW", "The saved demo did not complete all workflow checks.");
  log("Server demo verified: lead saved, questions answered, qualified, simulated booking, notification and conversation saved.");
  log("No real OpenAI, SMS, email or calendar requests were made by this demo.");
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { log(help); return; }
  if (args.some(arg => arg !== "--check")) throw new SetupError("OPTION", "Use --help to see supported options.");
  await checkProject(); const cli = await installedCLI();
  if (args.includes("--check")) { log("CALVREN_SETUP_CHECK_PASSED: pinned CLI, public owner-login utility, project configuration and private-file ignores verified offline."); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError("TTY_REQUIRED", "Run npm run setup in your own interactive terminal.");
  log("Calvren setup will securely save credentials, publish this existing website and verify a simulated lead.");
  let env = setupDefaults(await privateLocalEnvironment());
  // Live mode is never selected by this wizard. Netlify synchronization preserves an existing deployed live service.
  env.CALVREN_AUTOMATION_MODE = "demo"; env.CALVREN_PUBLIC_URL = PUBLIC_URL;
  if (!env.CALVREN_ADMIN_TOKEN) env.CALVREN_ADMIN_TOKEN = generateAdminToken();
  validateAdminToken(env.CALVREN_ADMIN_TOKEN);
  env = await collect(env);
  await writePrivateEnv(root, env);
  log("\nCredentials saved privately in .env. The operator token is there; it is not printed.");
  const schema = await checkSupabaseSchema(env);
  if (!schema.ready) {
    log("Server database is not ready (" + schema.reason + ").");
    log("In your dedicated Supabase project's SQL Editor, run supabase/migrations/202610030001_calvren_conversion.sql.");
    log("Publishing the public demonstration can continue.");
  }
  let token = await cli.getAPIToken();
  if (!token) { await runCLI(cli.bin, ["login"]); token = await cli.getAPIToken(); }
  if (!token) throw new SetupError("NETLIFY_LOGIN", "Netlify browser login must finish before deployment.");
  await ensureLinked(cli.bin);
  const sync = await syncNetlifyEnvironment(env, token);
  if (sync.preservedPublicURL) log("The existing owned Calvren public URL was preserved for webhook signatures.");
  if (sync.preservedLiveMode) log("An existing deployed live mode was preserved. The verification still uses a demo client.");
  if (sync.defaultScopes.length) log("Netlify plan uses its default scopes for: " + sync.defaultScopes.join(", ") + ". Values remain server environment variables in Production.");
  if (sync.metadataPreserved.length) log("Existing masked context values and their metadata were preserved for: " + sync.metadataPreserved.join(", ") + ".");
  log("Uploaded " + sync.uploaded.length + " configuration entries without printing their values.");
  await runCLI(cli.bin, ["deploy", "--prod", "--context", "production", "--site", SITE_ID]);
  log("\nPublished: " + PUBLIC_URL + "/lead-demo.html");
  try { await serverDemo(env); } catch (error) {
    log("Publication completed; server workflow verification still needs setup: " + (error instanceof SetupError ? error.message : "Check database and deployment configuration."));
  }
  const missing = missingLiveKeys(env);
  log(missing.length ? "Live provider setup still needs: " + missing.join(", ") + "." :
    "All required live credential fields are present. Provider permissions and a consenting end-to-end client test still need verification.");
  log("Open " + PUBLIC_URL + "/operator.html and use CALVREN_ADMIN_TOKEN from your private .env.");
  log("Live activation and first-client instructions: docs/lead-conversion-mvp.md.");
}
main().catch(error => {
  process.stderr.write("Setup stopped: " + (error instanceof SetupError ? error.message : "A local setup step failed. Check the setup guide and run again.") + "\n");
  process.exitCode = 1;
});
