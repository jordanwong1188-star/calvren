import type { Config, Context } from "@netlify/functions";
import { runScheduledFollowUps } from "../lib/conversion-runtime.mjs";

export default async function conversionFollowUps(_request: Request, context: Context): Promise<void> {
  // Netlify invokes scheduled functions internally; there is no public cron API or caller-controlled tenant.
  await runScheduledFollowUps(context);
}
export const config: Config = { schedule: "*/5 * * * *" };
