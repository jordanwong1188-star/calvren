import type { Config, Context } from "@netlify/functions";
import { handleWorkflow } from "../lib/workflow-core.mjs";
import { dependencies } from "../lib/runtime.mjs";
import { handleConversion } from "../lib/conversion-api.mjs";
import { conversionDependencies } from "../lib/conversion-runtime.mjs";

export default async function workflow(request: Request, context: Context): Promise<Response> {
  if (request.method === "POST" && new URL(request.url).pathname === "/api/leads") {
    return handleConversion(request, conversionDependencies(context));
  }
  return handleWorkflow(request, dependencies(context));
}
export const config: Config = {
  path: ["/api/status", "/api/workflow", "/api/leads", "/api/leads/:id", "/api/leads/:id/draft"],
};
