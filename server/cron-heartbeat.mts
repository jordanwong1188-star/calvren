// Server-side records of actual scheduler execution. No client IDs, messages or secrets.
type Env=(name:string)=>string|undefined;
export type CronJob="follow-ups"|"hub-scheduler";
type Stats={processed?:number;review?:number;reports?:number;alerts?:number;failed?:number;skipped?:number};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const nonnegative=(x:unknown)=>typeof x==="number"&&Number.isSafeInteger(x)&&x>=0?Math.min(10000,x):0;

export async function recordSchedulerRun(job:CronJob,success:boolean,processed:number,failed:number,env:Env,fetcher:typeof fetch=fetch):Promise<void>{
 const origin=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
 if(!origin||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(origin)||!key)throw Error("Scheduler recording is not configured.");
 const headers:Record<string,string>={apikey:key,"Content-Type":"application/json"};
 if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
 const response=await fetcher(origin.replace(/\/$/,"")+"/rest/v1/rpc/calvren_record_scheduler_run",{
   method:"POST",headers,body:JSON.stringify({p_job_name:job,p_success:success,p_processed:nonnegative(processed),p_failed:nonnegative(failed)}),
   redirect:"error",signal:AbortSignal.timeout(7000)
 });
 if(!response.ok)throw Error("Scheduler heartbeat could not be recorded.");
}
// The dispatch endpoint returns failure if a job reports failed sends, or if the
// heartbeat cannot be persisted. No automatic retry is performed here.
export async function runScheduled(job:CronJob,env:Env,runner:()=>Promise<Stats>,fetcher:typeof fetch=fetch):Promise<Response>{
 let output:Stats;
 try{output=await runner();}
 catch{
   try{await recordSchedulerRun(job,false,0,1,env,fetcher);}catch{console.error(JSON.stringify({event:"calvren_scheduler_record_failed",job}));}
   console.error(JSON.stringify({event:"calvren_scheduler_executor_failed",job}));
   return reply({error:"The scheduled job failed. Review the private operations log."},503);
 }
 const failed=nonnegative(output.failed);
 const processed=job==="follow-ups"?nonnegative(output.processed):
   nonnegative(output.review)+nonnegative(output.reports)+nonnegative(output.alerts);
 try{await recordSchedulerRun(job,failed===0,processed,failed,env,fetcher);}
 catch{
   console.error(JSON.stringify({event:"calvren_scheduler_record_failed",job}));
   return reply({error:"The scheduled job ran but its execution record could not be verified."},503);
 }
 if(failed>0)return reply({ok:false,processed,failed,error:"Some outbound actions failed or have uncertain delivery; manual investigation required."},503);
 return reply({ok:true,...output});
}
