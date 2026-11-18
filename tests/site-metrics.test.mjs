import test from "node:test";
import assert from "node:assert/strict";
import {handleSiteMetrics} from "../server/site-metrics.mts";
const env=name=>({SUPABASE_URL:"https://sample.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_testserveronly"}[name]);
const request=(event,page="/")=>new Request("https://calvren.ca/api/metrics/event",{
  method:"POST",headers:{Origin:"https://calvren.ca","Content-Type":"application/json","Sec-Fetch-Site":"same-origin"},
  body:JSON.stringify({event,page})
});
test("marketing events record only whitelisted aggregate names and paths",async()=>{
  let called=0;
  const response=await handleSiteMetrics(request("demo_started","/lead-demo"),{env,fetch:async(url,init)=>{
    called++;
    assert.match(url,/\/rest\/v1\/rpc\/calvren_record_site_metric$/);
    assert.deepEqual(JSON.parse(init.body),{p_event:"demo_started",p_page:"/lead-demo"});
    assert.equal(init.headers.Authorization,undefined);
    return new Response(null,{status:204});
  }});
  assert.equal(response.status,202);
  assert.equal(called,1);
});
test("invalid events, visitor attributes and cross-site posts never reach database",async()=>{
  let called=0;
  const deps={env,fetch:()=>{called++;return Response.json({});}};
  assert.equal((await handleSiteMetrics(request("name=Alice"),deps)).status,400);
  assert.equal((await handleSiteMetrics(request("page_view","/private"),deps)).status,400);
  const unexpected=new Request("https://calvren.ca/api/metrics/event",{
    method:"POST",headers:{Origin:"https://calvren.ca","Content-Type":"application/json"},
    body:JSON.stringify({event:"page_view",page:"/",email:"secret@example.com"})
  });
  assert.equal((await handleSiteMetrics(unexpected,deps)).status,400);
  const crossSite=new Request("https://calvren.ca/api/metrics/event",{
    method:"POST",headers:{Origin:"https://attacker.example","Content-Type":"application/json"},
    body:JSON.stringify({event:"page_view",page:"/"})
  });
  assert.equal((await handleSiteMetrics(crossSite,deps)).status,403);
  assert.equal(called,0);
});
test("owner report is authentication gated and aggregates counts without private data",async()=>{
  const req=new Request("https://calvren.ca/api/metrics/summary");
  const no=await handleSiteMetrics(req,{env,authorized:false,fetch:()=>{throw Error("must not call");}});
  assert.equal(no.status,401);
  const yes=await handleSiteMetrics(req,{env,authorized:true,fetch:async(url)=>{
    assert.match(url,/\/rest\/v1\/calvren_site_metrics_daily\?/);
    return Response.json([{day:"2026-11-18",event_name:"page_view",page_path:"/",hits:12},
      {day:"2026-11-18",event_name:"audit_submitted",page_path:"/contact",hits:2},
      {day:"2026-11-18",event_name:"demo_started",page_path:"/lead-demo",hits:3}]);
  }});
  assert.equal(yes.status,200);
  const result=await yes.json();
  assert.equal(result.counts.page_view,12);
  assert.equal(result.counts.audit_submitted,2);
  assert.equal(result.daily[0].demo_started,3);
  assert.ok(!JSON.stringify(result).includes("email"));
});
