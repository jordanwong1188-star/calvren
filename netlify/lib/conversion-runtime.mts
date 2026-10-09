import type { Context } from "@netlify/functions";
import { ConversionError } from "../../src/conversion/contracts.mjs";
import { createConversionDependencies } from "../../server/conversion-runtime.mjs";
export function conversionDependencies(context: Context) {
  return createConversionDependencies({env:name => Netlify.env.get(name),production:context.deploy.context === "production",ip:context.ip});
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
