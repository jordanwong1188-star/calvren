import { handleServer } from "./generated/server/router.ts";
Deno.serve((request: Request) => handleServer(request,{
  env: name => Deno.env.get(name),
  ip: request.headers.get("x-calvren-client-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim()
}));
