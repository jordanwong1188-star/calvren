import test from "node:test";
import assert from "node:assert/strict";
import {runScheduled,recordSchedulerRun} from "../server/cron-heartbeat.mts";

const env=name=>({SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_fixture_private"}[name]);
function recorder(status=204){
 const calls=[];
 const fetcher=async(url,options)=>{
   calls.push({url,options});
   return new Response(null,{status});
 };
 return {calls,fetcher};
}
test("scheduled successful runs persist a server-only heartbeat without customer content",async()=>{
 const {calls,fetcher}=recorder();
 const response=await runScheduled("hub-scheduler",env,async()=>({review:2,reports:3,alerts:1,skipped:5,failed:0}),fetcher);
 assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/rest\/v1\/rpc\/calvren_record_scheduler_run$/);
 assert.equal(calls[0].options.headers.apikey,env("SUPABASE_SECRET_KEY"));
 const payload=JSON.parse(calls[0].options.body);
 assert.deepEqual(payload,{p_job_name:"hub-scheduler",p_success:true,p_processed:6,p_failed:0});
});
test("failed provider action is stored and never presented as a successful scheduled job",async()=>{
 const {calls,fetcher}=recorder();
 const response=await runScheduled("hub-scheduler",env,async()=>({review:1,failed:2}),fetcher);
 assert.equal(response.status,503);
 assert.equal(JSON.parse(calls[0].options.body).p_success,false);
 assert.equal(JSON.parse(calls[0].options.body).p_failed,2);
});
test("a missing heartbeat fails closed even if worker reported success",async()=>{
 const {fetcher}=recorder(503);
 const response=await runScheduled("follow-ups",env,async()=>({processed:1,failed:0}),fetcher);
 assert.equal(response.status,503);
});
test("worker error attempts to record a failure without retrying the worker",async()=>{
 const {calls,fetcher}=recorder();
 let runs=0;
 const response=await runScheduled("follow-ups",env,async()=>{runs++;throw Error("temporary provider failure");},fetcher);
 assert.equal(response.status,503);assert.equal(runs,1);
 assert.equal(JSON.parse(calls[0].options.body).p_success,false);
 assert.equal(JSON.parse(calls[0].options.body).p_failed,1);
});
test("new scheduler record endpoint fails without a configured private server key",async()=>{
 await assert.rejects(()=>recordSchedulerRun("follow-ups",true,0,0,()=>undefined),/not configured/);
});
