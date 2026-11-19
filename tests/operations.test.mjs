import test from "node:test";
import assert from "node:assert/strict";
import {handleOperations} from "../server/operations.mts";
const env=name=>({SUPABASE_URL:"https://sample.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_test_only"}[name]);
const input=new Request("https://calvren.ca/api/ops/summary",{method:"GET"});
test("owner report fails closed without credentials",async()=>{
  let called=false;
  const response=await handleOperations(input,{env,authorized:false,fetcher:async()=>{called=true;return Response.json({});}});
  assert.equal(response.status,401);assert.equal(called,false);
});
test("operational report returns only aggregate counts",async()=>{
  const response=await handleOperations(input,{env,authorized:true,fetcher:async(url,options)=>{
    assert.match(url,/\/rest\/v1\/rpc\/calvren_operational_snapshot$/);
    assert.equal(options.headers.apikey,"sb_secret_test_only");
    return Response.json({active_linked_clients:2,failed_deliveries_7d:1,unknown_deliveries_7d:0,
      human_handoffs_pending:3,onboarding_needs_details:1,onboarding_in_progress:4,
      checked_at:"2026-11-19T00:00:00Z",oldest_unresolved_delivery:"2026-11-18T14:00:00Z",
    followups_last_success_at:new Date().toISOString(),followups_last_outcome:"succeeded",followups_last_processed:0,
    hub_last_success_at:new Date().toISOString(),hub_last_outcome:"succeeded",hub_last_processed:0,
      customer_email:"private@example.com",message:"customer private message"});
  }});
  assert.equal(response.status,200);
  const report=await response.json();
  assert.equal(report.delivery_alert,true);assert.equal(report.human_handoffs_pending,3);
  assert.equal(report.followups_health,"recent");assert.equal(report.hub_health,"recent");
  assert.equal(JSON.stringify(report).includes("private@example.com"),false);
  assert.equal(JSON.stringify(report).includes("customer private message"),false);
});
test("no green status on incomplete aggregate or backend outage",async()=>{
 const incomplete=await handleOperations(input,{env,authorized:true,fetcher:async()=>Response.json({active_linked_clients:0})});
 assert.equal(incomplete.status,503);
 const failed=await handleOperations(input,{env,authorized:true,fetcher:async()=>new Response(null,{status:503})});
 assert.equal(failed.status,503);
});
