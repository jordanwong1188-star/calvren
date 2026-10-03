import type { Context } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { ConversionError, type ClientConfig, type Lead, type EngineDependencies } from "../../src/conversion/contracts.mjs";
import { ConversionEngine } from "../../src/conversion/engine.mjs";
import { createDemoServices } from "../../src/conversion/mock-services.mjs";
import { SupabaseRepository } from "./conversion-repository.mjs";
import { createLiveProviders, validateTwilioWebhook } from "./conversion-providers.mjs";
import type { ConversionAPIDependencies, Readiness } from "./conversion-api.mjs";

export function conversionDependencies(context: Context): ConversionAPIDependencies {
  const env = (name: string): string | undefined => Netlify.env.get(name);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const repository = url && key ? new SupabaseRepository({ url, key }) : null;
  const production = context.deploy.context === "production";
  const mode = env("CALVREN_AUTOMATION_MODE") === "live" ? "live" : "demo";
  const has = (...names: string[]): boolean => names.every(name => !!env(name)?.trim());
  const readiness = (): Readiness => {
    const providers = {
      openai: has("OPENAI_API_KEY"),
      twilio: has("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "CALVREN_PUBLIC_URL"),
      google: has("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
      notifications: has("RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL"),
    };
    const issues: string[] = [];
    if (!repository) issues.push("Set SUPABASE_URL and SUPABASE_SECRET_KEY, then apply the Calvren migration.");
    if (!has("CALVREN_ADMIN_TOKEN")) issues.push("Set a strong CALVREN_ADMIN_TOKEN.");
    if (mode !== "live") issues.push("Real messaging is disabled. Set CALVREN_AUTOMATION_MODE=live only after testing.");
    if (!production) issues.push("Live providers are disabled outside the published production deploy.");
    for (const [provider, configured] of Object.entries(providers)) if (!configured) issues.push(provider + " credentials are missing.");
    issues.push("These checks report configuration presence; test credentials and calendar permissions before activating a client.");
    return { database: !!repository, admin: has("CALVREN_ADMIN_TOKEN"), mode, production, providers, server_demo: !!repository, browser_demo: true, issues };
  };
  const demo = createDemoServices();
  let live: ReturnType<typeof createLiveProviders> | undefined;
  const services = (client: ClientConfig, lead: Lead) => {
    if (client.mode !== lead.mode) throw new ConversionError("MODE_MISMATCH", "The lead and client modes do not match. Human review is required.", 409);
    if (client.mode === "demo") return demo;
    if (mode !== "live" || !production || !repository) throw new ConversionError("LIVE_DISABLED", "Live automation requires a published production deploy, Supabase and CALVREN_AUTOMATION_MODE=live.", 503);
    live ||= createLiveProviders({ env });
    return live;
  };
  const engine = (): ConversionEngine => {
    if (!repository) throw new ConversionError("DATABASE_NOT_CONFIGURED", "Connect Supabase to use server automation. The browser demo is available without credentials.", 503);
    const providers: Pick<EngineDependencies, "ai" | "messaging" | "calendar" | "notifications"> = {
      ai: { analyze: input => services(input.client, input.bundle.lead).ai.analyze(input) },
      messaging: { send: input => services(input.client, input.lead).messaging.send(input) },
      calendar: {
        available: input => services(input.client, input.lead).calendar.available(input),
        book: input => services(input.client, input.lead).calendar.book(input),
      },
      notifications: { send: input => services(input.client, input.lead).notifications.send(input) },
    };
    return new ConversionEngine({ repository, ...providers, uuid: randomUUID });
  };
  return {
    env, repository, engine, readiness, ip: context.ip,
    verifyWebhook: (request, path) => validateTwilioWebhook({ request, env, path }),
    log: (event, details) => console.error(JSON.stringify({ event, ...details })),
  };
}

/** The native scheduled function processes one due lead per tick to stay inside Netlify's 30-second scheduled limit. */
export async function runScheduledFollowUps(context: Context): Promise<void> {
  if (context.deploy.context !== "production") return;
  const deps = conversionDependencies(context);
  if (!deps.repository || !deps.readiness().admin) return;
  // Repository leases and version checks make overlapping scheduler executions safe.
  try {
    const result = await deps.engine().followUps(1);
    console.info(JSON.stringify({ event: "conversion_followups", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "conversion_followups_failed", code: error instanceof ConversionError ? error.code : "AUTOMATION_ERROR" }));
  }
}
