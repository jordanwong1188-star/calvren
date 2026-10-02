import type { Config, Context } from "@netlify/functions";
import { handleWorkflow } from "../lib/workflow-core.mjs";
import { dependencies } from "../lib/runtime.mjs";

export default async function workflow(request: Request, context: Context): Promise<Response> {
  return handleWorkflow(request, dependencies(context));
}
export const config: Config = {
  path: ["/api/status", "/api/workflow", "/api/leads", "/api/leads/:id", "/api/leads/:id/draft"],
};
