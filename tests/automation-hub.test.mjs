import test,{after} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";
const dir=await mkdtemp(join(tmpdir(),"calvren-hub-"));
after(()=>rm(dir,{recursive:true,force:true}));
const source=await readFile(new URL("../server/automation-hub.mts",import.meta.url),"utf8");
await writeFile(join(dir,"hub.mjs"),ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}
}).outputText);
const {handleAutomationHub,processAutomationCron,unsubscribeReview}=
  await import(pathToFileURL(join(dir,"hub.mjs")).href);
const uid="55555555-5555-4555-8555-555555555555",appId="66666666-6666-4666-8666-666666666666";
const leadId="77777777-7777-4777-8777-777777777777",clientId="sample_live";
const old=new Date(Date.now()-72*3600000).toISOString();
function fixture({plan="growth",consent=true,live=true,settings={}}={}){
  const events=[],deliveries=new Map();
  const member={auth_user_id:uid,client_id:clientId,stripe_price_id:plan==="pro"?"price_pro":plan==="starter"?"price_starter":"price_growth",
    subscription_status:"active",current_period_end:"2035-01-01T00:00:00Z"};
  const opts={client_id:clientId,review_url:"https://g.page/r/example/review",
    review_enabled:false,report_enabled:false,pro_alert_enabled:false,integration_enabled:false,...settings};
  const lead={id:leadId,client_id:clientId,name:"Consent Test",email:"someone@example.com",
    phone:"+16045551234",channel:"sms",consent_sms:true,consent_review:consent,opted_out:false,
    status:"booked",updated_at:old,created_at:old};
  const fetcher=async (url,init={})=>{
    const u=new URL(url);events.push({url,init});
    const send=rows=>Response.json(rows);
    if(u.pathname==="/rest/v1/calvren_billing_memberships")return send([member]);
    if(u.pathname==="/rest/v1/calvren_onboarding")return send([{
      status:live?"live":"testing",scope_approved_at:"2026-10-01",launch_scope:"Approved",
      approved_scope:"Approved"
    }]);
    if(u.pathname==="/rest/v1/calvren_clients")return send([{config:{id:clientId,active:true,mode:"live",
      phone_number:"+16045550100",notification_email:"owner@example.com"}}]);
    if(u.pathname==="/rest/v1/calvren_hub_settings"){
      if(init.method==="POST"){Object.assign(opts,JSON.parse(init.body));return send([opts]);}
      return send([opts]);
    }
    if(u.pathname==="/rest/v1/calvren_appointments")return send([{
      id:appId,lead_id:leadId,ends_at:old,starts_at:old,data:{status:"booked"}
    }]);
    if(u.pathname==="/rest/v1/calvren_service_completions"){
      if(init.method==="POST")return send([JSON.parse(init.body)]);
      return send([{appointment_id:appId,lead_id:leadId,completed_at:old}]);
    }
    if(u.pathname==="/rest/v1/calvren_leads")return send([{id:leadId,data:lead}]);
    if(u.pathname==="/rest/v1/calvren_review_optouts")return send([]);
    if(u.pathname==="/rest/v1/calvren_messages")return send([{lead_id:leadId,data:{
      sender:"lead",channel:"sms",message:"Hi there",timestamp:old,status:"received"}}]);
    if(u.pathname==="/rest/v1/calvren_hub_notes"){
      if(init.method==="POST")return send([JSON.parse(init.body)]);
      return send([]);
    }
    if(u.pathname==="/rest/v1/calvren_hub_deliveries"){
      if(init.method==="POST"){
        const row=JSON.parse(init.body),key=[row.client_id,row.kind,row.ref_key].join("|");
        if(deliveries.has(key))return send([]);
        const entry={...row,id:crypto.randomUUID()};deliveries.set(key,entry);return send([entry]);
      }
      return send([]);
    }
    if(u.pathname.startsWith("/auth/v1/admin/users/"))return Response.json({
      id:uid,email:"owner@example.com",email_confirmed_at:"2026-09-01"});
    if(url==="https://api.resend.com/emails")return Response.json({id:"mail_123"});
    return Response.json({error:"Unexpected test request"},{status:500});
  };
  const env=name=>({
    SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_fixture",
    STRIPE_PRICE_ID:"price_starter",STRIPE_SECRET_KEY:"sk_test_fixture",
    STRIPE_GROWTH_PRICE_ID:"price_growth",STRIPE_PRO_PRICE_ID:"price_pro",
    STRIPE_WEBHOOK_SECRET:"whsec_"+"a".repeat(48),
    RESEND_API_KEY:"re_fixture",NOTIFICATION_FROM_EMAIL:"hello@calvren.example",
    CALVREN_AUTOMATION_MODE:"live"
  }[name]);
  const deps={env,fetch:fetcher,user:{id:uid,email:"owner@example.com"},
    member,plan};
  const req=(path,method="GET",data)=>new Request("https://calvren.pages.dev/api/billing/hub/"+path,{
    method, ...(data?{headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{})
  });
  return {deps,events,req,env,fetcher,lead,member,deliveries};
}
test("Starter is forbidden from Growth/Pro module routes without a database read",async()=>{
  const f=fixture({plan:"starter"});
  const result=await handleAutomationHub(f.req("settings"),f.deps);
  assert.equal(result.status,403);
  assert.equal(f.events.length,0);
});
test("unapproved onboarding cannot confirm service completion",async()=>{
  const f=fixture({live:false});
  const r=await handleAutomationHub(f.req("completions","POST",{appointment_id:appId,confirmed:true}),f.deps);
  assert.equal(r.status,409);
  assert.equal(f.events.some(x=>x.init.method==="POST"),false);
});
test("a review cannot be queued without the customer's explicit email opt-in",async()=>{
  const f=fixture({consent:false});
  const response=await handleAutomationHub(f.req("completions","POST",{appointment_id:appId,confirmed:true}),f.deps);
  assert.equal(response.status,409);
  assert.equal(f.events.some(x=>x.url.includes("calvren_service_completions")&&x.init.method==="POST"),false);
});
test("an opted-in booked appointment can be confirmed only for the linked tenant",async()=>{
  const f=fixture();
  const response=await handleAutomationHub(f.req("completions","POST",{appointment_id:appId,confirmed:true}),f.deps);
  assert.equal(response.status,200);
  assert.equal((await response.json()).confirmed,true);
  const written=f.events.find(x=>x.url.includes("calvren_service_completions")&&x.init.method==="POST");
  assert.equal(JSON.parse(written.init.body).client_id,clientId);
  assert.ok(f.events.some(x=>x.url.includes("client_id=eq."+clientId)));
});
test("Growth cannot access Pro conversations",async()=>{
  const f=fixture();
  const res=await handleAutomationHub(f.req("inbox"),f.deps);
  assert.equal(res.status,403);
});
test("Pro inbox messages and internal notes are scoped to the authenticated business",async()=>{
  const f=fixture({plan:"pro"});
  const list=await handleAutomationHub(f.req("inbox"),f.deps);
  assert.equal(list.status,200);
  assert.equal((await list.json()).threads[0].id,leadId);
  const detail=await handleAutomationHub(f.req("inbox/"+leadId),f.deps);
  assert.equal(detail.status,200);
  assert.equal((await detail.json()).messages[0].message,"Hi there");
  const note=await handleAutomationHub(f.req("inbox/"+leadId+"/notes","POST",{body:"Please call back."}),f.deps);
  assert.equal(note.status,200);
  const body=JSON.parse(f.events.find(x=>x.url.includes("calvren_hub_notes")&&x.init.method==="POST").init.body);
  assert.equal(body.client_id,clientId);
  assert.equal(body.author_user_id,uid);
});
test("daily review job respects consent and sends at most one idempotent review email",async()=>{
  const f=fixture({settings:{review_enabled:true}});
  const first=await processAutomationCron(f.env,f.fetcher);
  assert.equal(first.review,1);
  const second=await processAutomationCron(f.env,f.fetcher);
  assert.equal(second.review,0);
  const mail=f.events.find(x=>x.url==="https://api.resend.com/emails");
  assert.ok(mail);
  const sent=JSON.parse(mail.init.body);
  assert.match(sent.text,/honest review/i);
  assert.match(sent.text,/unsubscribe-review/);
  assert.equal(f.events.filter(x=>x.url==="https://api.resend.com/emails").length,1);
});
test("daily review scheduler sends no unconsented customer email",async()=>{
  const f=fixture({consent:false,settings:{review_enabled:true}});
  const result=await processAutomationCron(f.env,f.fetcher);
  assert.equal(result.review,0);
  assert.equal(f.events.some(x=>x.url==="https://api.resend.com/emails"),false);
});
