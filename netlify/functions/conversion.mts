import type { Config, Context } from "@netlify/functions";
import { handleConversion } from "../lib/conversion-api.mjs";
import { conversionDependencies } from "../lib/conversion-runtime.mjs";

export default async function conversion(request: Request, context: Context): Promise<Response> {
  return handleConversion(request, conversionDependencies(context));
}
export const config: Config = { path: "/api/conversion/*" };
