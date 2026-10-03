import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const SITE_ID = "9357eb4a-405e-417e-af9a-f5998d88f2ba";
export const PUBLIC_URL = "https://calvren.netlify.app";
export const NETLIFY_API = "https://api.netlify.com/api/v1";
export const SECRET_KEYS = new Set([
  "CALVREN_ADMIN_TOKEN", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "TWILIO_AUTH_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "RESEND_API_KEY"
]);
export const ENV_KEYS = [
  "CALVREN_AUTOMATION_MODE", "CALVREN_PUBLIC_URL", "CALVREN_ADMIN_TOKEN",
  "SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "OPENAI_MODEL",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL", "CALVREN_DATA_ENV"
];

export class SetupError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = "SetupError"; this.code = code; this.status = status; }
}
export function setupDefaults(existing = {}) {
  return { CALVREN_AUTOMATION_MODE: "demo", CALVREN_PUBLIC_URL: PUBLIC_URL, OPENAI_MODEL: "gpt-4o-mini",
    CALVREN_DATA_ENV: "production", ...existing };
}
export function generateAdminToken() { return randomBytes(32).toString("base64url"); }
export function validateAdminToken(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 1024 || /\s/.test(token)) {
    throw new SetupError("ADMIN_TOKEN", "The existing operator token must contain 32–1024 characters without whitespace.");
  }
  return token;
}
export function missingLiveKeys(env) {
  return ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL"]
    .filter(key => !env[key]?.trim());
}
export function serializeEnv(env) {
  const serialized = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z_a-z][A-Z_a-z0-9]*$/.test(key) || typeof value !== "string" || value.includes("\0")) {
      throw new SetupError("INVALID_ENV", "A local environment entry cannot be saved safely.");
    }
    // Single quotes preserve literal backslashes, dollars, hashes and quotation marks.
    // PEM newlines are supported by Node parseEnv and dotenv in quoted values.
    const quote = !value.includes("'") ? "'" : !value.includes('"') ? '"' : null;
    if (!quote) throw new SetupError("INVALID_ENV", "An environment value contains unsupported quotation marks.");
    return key + "=" + quote + value + quote;
  }).join("\n") + "\n";
  const parsed = parseEnv(serialized);
  if (Object.keys(parsed).length !== Object.keys(env).length || Object.entries(env).some(([key, value]) => parsed[key] !== value)) {
    throw new SetupError("ENV_ROUNDTRIP", "A local environment value could not be preserved safely. The existing .env was not replaced.");
  }
  return serialized;
}
async function rejectSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new SetupError("UNSAFE_PATH", "A private setup path is a symbolic link; use a normal project directory.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export async function writePrivateEnv(root, env) {
  const target = resolve(root, ".env");
  const privateDir = resolve(root, ".netlify");
  await rejectSymlink(target); await rejectSymlink(privateDir);
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await chmod(privateDir, 0o700);
  const temporary = resolve(privateDir, ".calvren-env-" + randomBytes(12).toString("hex") + ".tmp");
  try {
    await writeFile(temporary, serializeEnv(env), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rejectSymlink(target);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally { await rm(temporary, { force: true }); }
}
export async function googleAccountFromFile(path, root) {
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(resolve(path));
  const rel = relative(canonicalRoot, canonicalPath);
  if (rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))) {
    throw new SetupError("GOOGLE_FILE_IN_PROJECT", "Move the Google key JSON outside the project directory before importing it.");
  }
  if ((await lstat(canonicalPath)).size > 64 * 1024) throw new SetupError("INVALID_GOOGLE_FILE", "The Google key file is too large.");
  let data;
  try { data = JSON.parse(await readFile(canonicalPath, "utf8")); } catch {
    throw new SetupError("INVALID_GOOGLE_FILE", "The Google service account JSON could not be read.");
  }
  if (data.type !== "service_account" || typeof data.client_email !== "string" ||
      !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(data.client_email) ||
      typeof data.private_key !== "string" ||
      !data.private_key.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
      !data.private_key.trimEnd().endsWith("-----END PRIVATE KEY-----")) {
    throw new SetupError("INVALID_GOOGLE_FILE", "Use a downloaded Google service account JSON key.");
  }
  return { GOOGLE_SERVICE_ACCOUNT_EMAIL: data.client_email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: data.private_key };
}
export function netlifyURL(path) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://") || path.includes("\\")) {
    throw new SetupError("INVALID_API_PATH", "The Netlify API path is invalid.");
  }
  const url = new URL(NETLIFY_API + path);
  if (url.origin !== "https://api.netlify.com" || !url.pathname.startsWith("/api/v1/")) throw new SetupError("INVALID_API_PATH", "Invalid Netlify API origin.");
  return url.href;
}
function scopePlanError(status, data) {
  if (![400, 403, 422].includes(status)) return false;
  const message = typeof data?.message === "string" ? data.message : typeof data?.msg === "string" ? data.msg : "";
  return /(?:granular|environment variable|env.*scope|scope)/i.test(message) &&
    /(?:pro plan|paid plan|plan.*(?:support|allow|upgrade)|upgrade.*plan|not available.*plan)/i.test(message);
}
export function createNetlifyRequest(token, fetchImpl = fetch) {
  if (typeof token !== "string" || !token || /[\r\n]/.test(token)) throw new SetupError("NETLIFY_LOGIN", "Log in to Netlify using this computer before continuing.");
  return async (path, method = "GET", body) => {
    let response;
    try {
      response = await fetchImpl(netlifyURL(path), {
        method, redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Authorization: "Bearer " + token, Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new SetupError("NETLIFY_NETWORK", "The Netlify request failed; credentials were not logged."); }
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const error = new SetupError(scopePlanError(response.status, data) ? "SCOPES_PLAN" : "NETLIFY_API",
        "Netlify could not complete the request (HTTP " + response.status + ").", response.status);
      throw error;
    }
    return data;
  };
}
function readableValue(value) {
  return typeof value === "string" && !/^(?:\*{3,}|\[redacted\]|<redacted>|\(redacted\))$/i.test(value);
}
export function ownedPublicURL(value, site) {
  let candidate;
  try { candidate = new URL(value); } catch { return false; }
  if (candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.port ||
      (candidate.pathname !== "/" && candidate.pathname !== "") || candidate.search || candidate.hash) return false;
  const allowed = new Set([new URL(PUBLIC_URL).hostname]);
  for (const url of [site.ssl_url, site.url]) {
    try { if (url) allowed.add(new URL(url).hostname); } catch { /* Skip invalid provider metadata. */ }
  }
  for (const domain of [site.custom_domain, ...(Array.isArray(site.domain_aliases) ? site.domain_aliases : [])]) {
    if (typeof domain === "string" && /^[A-Za-z0-9.-]+$/.test(domain)) allowed.add(domain.toLowerCase());
  }
  return allowed.has(candidate.hostname);
}
export function envMutation(existing, key, value) {
  const secret = SECRET_KEYS.has(key);
  const production = { context: "production", value };
  const desired = { key, scopes: ["functions"], is_secret: secret, values: [production] };
  if (!existing) return { method: "POST", body: [desired], repaired: false };
  const correctSecret = !!existing.is_secret === secret;
  const correctScope = Array.isArray(existing.scopes) && existing.scopes.length === 1 && existing.scopes[0] === "functions";
  if (correctSecret && correctScope) return { method: "PATCH", body: production, repaired: false };
  const others = (existing.values ?? []).filter(v => v.context !== "production");
  if ((existing.is_secret && others.length) || (secret && others.some(v => v.context === "all"))) {
    // Secret values in other contexts are masked. A PUT would corrupt them.
    return { method: "PATCH", body: production, metadataPreserved: true, repaired: false };
  }
  if (others.some(v => !readableValue(v.value))) {
    return { method: "PATCH", body: production, metadataPreserved: true, repaired: false };
  }
  return { method: "PUT", repaired: true, body: {
    ...desired, values: [...others.map(v => ({
      context: v.context, ...(v.context_parameter ? { context_parameter: v.context_parameter } : {}), value: v.value
    })), production]
  } };
}
export async function syncNetlifyEnvironment(env, token, fetchImpl = fetch) {
  const request = createNetlifyRequest(token, fetchImpl);
  const site = await request("/sites/" + SITE_ID);
  if (site?.id !== SITE_ID || typeof site.account_slug !== "string" || !site.account_slug ||
      !/^[A-Za-z0-9_-]+$/.test(site.account_slug)) throw new SetupError("WRONG_SITE", "The Netlify account did not return the Calvren project.");
  const base = "/accounts/" + encodeURIComponent(site.account_slug) + "/env";
  const query = "?site_id=" + SITE_ID;
  const existing = await request(base + query);
  if (!Array.isArray(existing)) throw new SetupError("NETLIFY_RESPONSE", "Netlify returned an unexpected environment response.");
  const current = new Map(existing.map(v => [v.key, v]));
  const mode = current.get("CALVREN_AUTOMATION_MODE");
  const currentMode = mode?.values?.find(v => v.context === "production")?.value ??
    mode?.values?.find(v => v.context === "all")?.value;
  const result = { uploaded: [], skipped: [], metadataPreserved: [], defaultScopes: [], preservedLiveMode: currentMode === "live", preservedPublicURL: false };
  for (const key of ENV_KEYS) {
    let value = env[key];
    if (key === "CALVREN_AUTOMATION_MODE") {
      // Setup never activates live delivery and does not disable an existing live service.
      if (currentMode === "live") { result.skipped.push(key); continue; }
      if (typeof value !== "string" || !value.trim()) continue;
      value = "demo";
    }
    if (key === "CALVREN_PUBLIC_URL") {
      const previous = current.get(key)?.values?.find(v => v.context === "production")?.value ?? current.get(key)?.values?.find(v => v.context === "all")?.value;
      if (previous && ownedPublicURL(previous, site)) { result.skipped.push(key); result.preservedPublicURL = true; continue; }
    }
    if (typeof value !== "string" || !value.trim()) continue;
    const old = current.get(key);
    const mutation = envMutation(old, key, value);
    const path = base + (mutation.method === "POST" ? "" : "/" + encodeURIComponent(key)) + query;
    try { await request(path, mutation.method, mutation.body); }
    catch (error) {
      if (error.code !== "SCOPES_PLAN" || mutation.method === "PATCH") throw error;
      // Only a documented scope/plan refusal allows the provider's default scope.
      const fallback = structuredClone(mutation.body);
      for (const item of Array.isArray(fallback) ? fallback : [fallback]) delete item.scopes;
      await request(path, mutation.method, fallback);
      result.defaultScopes.push(key);
    }
    result.uploaded.push(key);
    if (mutation.metadataPreserved) result.metadataPreserved.push(key);
  }
  return result;
}
export function supabaseProjectURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new SetupError("SUPABASE_URL", "Use the HTTPS project URL from Supabase settings."); }
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) ||
      url.port || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new SetupError("SUPABASE_URL", "Use your dedicated Calvren project's https://PROJECT.supabase.co URL.");
  }
  return url.origin;
}
export async function checkSupabaseSchema(env, fetchImpl = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return { ready: false, reason: "missing_credentials" };
  const origin = supabaseProjectURL(env.SUPABASE_URL);
  const key = env.SUPABASE_SECRET_KEY;
  let response;
  try {
    response = await fetchImpl(origin + "/rest/v1/calvren_clients?select=id&limit=1", {
      redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }), Accept: "application/json" }
    });
  } catch { return { ready: false, reason: "connection_failed" }; }
  if (!response.ok) return { ready: false, reason: response.status === 404 ? "migration_needed" : "credentials_or_schema", status: response.status };
  let data;
  try { data = await response.json(); } catch { return { ready: false, reason: "unexpected_response" }; }
  return { ready: Array.isArray(data), reason: Array.isArray(data) ? "schema_present" : "unexpected_response" };
}
