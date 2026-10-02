import type { Context } from "@netlify/functions";
import { handleSubmission } from "../lib/workflow-core.mjs";
import { dependencies } from "../lib/runtime.mjs";

// Reserved event filename: Netlify verifies the platform JWS before invocation.
// There is intentionally no custom path or public fetchable event subscription.
export default async function submissionCreated(request: Request, context: Context): Promise<Response> {
  return handleSubmission(request, dependencies(context));
}
