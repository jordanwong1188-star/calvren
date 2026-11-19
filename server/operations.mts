// Owner-only aggregate operational counts. Never return customer identities or messages.
type Env=(name:string)=>string|undefined;
export interface OperationsDependencies {env:Env;authorized:boolean;fetcher?:typeof fetch;}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const keys=["active_linked_clients","failed_deliveries_7d","unknown_deliveries_7d","human_handoffs_pending","onboarding_needs_details","onboarding_in_progress"] as const;
export async function readOperations(env:Env,fetcher:typeof fetch=fetch){
 const base=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)||!key)throw Error("Operational reporting is not configured.");
 const headers:Record<string,string>={apikey:key,Accept:"application/json"};
 if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
 const response=await fetcher(base.replace(/\/$/,"")+"/rest/v1/rpc/calvren_operational_snapshot",{method:"GET",headers,cache:"no-store",signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw Error("Operational reporting is unavailable.");
 const data:unknown=await response.json();
 if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid operational report.");
 const parsed=data as Record<string,unknown>;
 const result:Record<string,unknown>={};
 for(const k of keys){
   const n=Number(parsed[k]);
   if(!Number.isSafeInteger(n)||n<0)throw Error("Incomplete operational report.");
   result[k]=n;
 }
 result.checked_at=typeof parsed.checked_at==="string"&&Number.isFinite(Date.parse(parsed.checked_at))?parsed.checked_at:new Date().toISOString();
 result.oldest_unresolved_delivery=typeof parsed.oldest_unresolved_delivery==="string"&&Number.isFinite(Date.parse(parsed.oldest_unresolved_delivery))?parsed.oldest_unresolved_delivery:null;
 const dates=["followups_last_attempt_at","followups_last_success_at","hub_last_attempt_at","hub_last_success_at"] as const;
 for(const key of dates)result[key]=typeof parsed[key]==="string"&&Number.isFinite(Date.parse(parsed[key] as string))?parsed[key]:null;
 for(const key of ["followups_last_processed","hub_last_processed"] as const)
   result[key]=typeof parsed[key]==="number"&&Number.isSafeInteger(parsed[key])?parsed[key]:null;
 for(const key of ["followups_last_outcome","hub_last_outcome"] as const)
   result[key]=parsed[key]==="succeeded"||parsed[key]==="failed"?parsed[key]:null;
 const recent=(date:unknown,minutes:number)=>typeof date==="string"&&Date.now()-Date.parse(date)>=0&&Date.now()-Date.parse(date)<minutes*60000;
 result.followups_health=parsed.followups_last_outcome==="failed"?"failed":
   recent(result.followups_last_success_at,20)?"recent":"unverified_or_overdue";
 result.hub_health=parsed.hub_last_outcome==="failed"?"failed":
   recent(result.hub_last_success_at,30*60)?"recent":"unverified_or_overdue";
 result.delivery_alert=Number(result.failed_deliveries_7d)+Number(result.unknown_deliveries_7d)>0;
 return result;
}
export async function handleOperations(request:Request,deps:OperationsDependencies):Promise<Response>{
 if(request.method!=="GET")return json({error:"Use GET."},405);
 if(!deps.authorized)return json({error:"Owner or scheduler access required."},401);
 try{
   const report=await readOperations(deps.env,deps.fetcher);
   return json({ok:true,...report,note:"Read-only counts. Review failed/unknown deliveries manually; never automatically resend an uncertain delivery."});
 }catch{return json({error:"Operational counts are temporarily unavailable. Check the operator workspace and job logs."},503);}
}
