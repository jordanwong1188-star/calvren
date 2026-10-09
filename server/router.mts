import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { handleConversion, adminAuthorized } from "../netlify/lib/conversion-api.mjs";
import { handleWorkflow } from "../netlify/lib/workflow-core.mjs";
import { createConversionDependencies } from "./conversion-runtime.mjs";
import { SupabasePrivateStorage } from "./private-storage.mjs";
import { handlePublicForm } from "./forms.mjs";
export interface ServerOptions { env(name:string):string|undefined; ip?:string; }
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function handleServer(request: Request, options: ServerOptions): Promise<Response> {
  try {
    const original=new URL(request.url);
    const path=original.pathname.replace(/^(?:\/functions\/v1)?\/calvren(?=\/|$)/,"") || "/";
    const env=(name:string)=>name==="CALVREN_DATA_ENV"?"production":options.env(name);
    const url=env("SUPABASE_URL"), key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
    const configuredOrigin=env("CALVREN_PUBLIC_URL");
    const origin=configuredOrigin?new URL(configuredOrigin).origin:original.origin;
    // Paths are fixed here; a visitor cannot supply an upstream destination.
    const routed=new Request(origin+path+original.search,request);
    const deps=createConversionDependencies({env,production:true,ip:options.ip});
    if(path==="/health"&&request.method==="GET")return json({ok:true,service:"calvren",hosting:"supabase"});
    if(path==="/api/internal/follow-ups"){
      if(request.method!=="POST")return json({error:"Use POST."},405);
      const expected=env("CALVREN_CRON_TOKEN"), supplied=request.headers.get("authorization")?.replace(/^Bearer /,"")||"";
      const hash=(value:string)=>createHash("sha256").update(value).digest();
      if(!expected||expected.length<32||!supplied||!timingSafeEqual(hash(expected),hash(supplied)))return json({error:"Scheduler authentication required."},401);
      if(!deps.repository||!deps.readiness().admin)return json({error:"Operator setup is incomplete."},503);
      return json({ok:true,...await deps.engine().followUps(1)});
    }
    if(path==="/forms"&&request.method==="POST"){
      if(!url||!key||!deps.repository)return json({error:"Database setup is incomplete."},503);
      return handlePublicForm(routed,{repository:deps.repository,storage:new SupabasePrivateStorage({url,key}),ip:options.ip});
    }
    if(path.startsWith("/api/conversion/")||(path==="/api/leads"&&request.method==="POST"))return handleConversion(routed,deps);
    if(path==="/api/feedback"){
      if(!adminAuthorized(routed,env("CALVREN_ADMIN_TOKEN")))return json({error:"Operator authentication required."},401);
      if(!url||!key)return json({error:"Database setup is incomplete."},503);
      const storage=new SupabasePrivateStorage({url,key}), feedback=[];
      for await(const page of storage.list({prefix:"feedback/",paginate:true}))for(const item of page.blobs)feedback.push(await storage.get(item.key,{type:"json"}));
      return json({ok:true,feedback});
    }
    if(/^\/api\/(?:status|workflow|leads(?:\/|$))/.test(path)){
      if(!url||!key)return json({error:"Database setup is incomplete."},503);
      return handleWorkflow(routed,{env,environment:"production",fetch:globalThis.fetch,storage:()=>new SupabasePrivateStorage({url,key})});
    }
    return json({error:"Endpoint not found."},404);
  }catch{console.error(JSON.stringify({event:"calvren_request_failed",code:"SERVER_ERROR"}));return json({error:"The request could not complete. Please try again."},503);}
}
