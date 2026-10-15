import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp=await mkdtemp(join(tmpdir(),"calvren-onboarding-"));
const source=await readFile(new URL("../server/onboarding.mts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const mail=await readFile(new URL("../server/customer-email.mts",import.meta.url),"utf8");
const mailJs=ts.transpileModule(mail,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile(join(temp,"customer-email.mjs"),mailJs);
await writeFile(join(temp,"onboarding.mjs"),output);
const {handleOnboarding}=await import(pathToFileURL(join(temp,"onboarding.mjs")).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const userId="5aafe427-dffc-429c-8a9b-1347f6b2ee4e",otherId="1aafe427-dffc-429c-8a9b-1347f6b2ee4e";
const TOKEN="calvren-owner-token-with-32-plus-characters";
const env=name=>({
  SUPABASE_URL:"https://test.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_fixture",
  CALVREN_ADMIN_TOKEN:TOKEN
})[name];
const validForm={
  business_name:"Northshore Plumbing",industry:"Home services",website:"https://example.com",
  description:"Routine repairs and installations",contact_name:"Alex",contact_email:"alex@example.com",
  services:"Leaks, drains",business_hours:"Mon-Fri 9-5",
  lead_sources:"Website",handoff_email:"office@example.com",
  consent_data_handling:true,approve_workflow_scope:true
};
const endpoint=(path,method="GET",body,auth="Bearer verified.user.jwt")=>new Request("https://calvren.pages.dev"+path,{
  method,headers:{Authorization:auth,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
});
function fixture({active=true,record=null,client=null}={}){
  let saved=record;
  const calls=[];
  const fetch=async(url,init={})=>{
    calls.push([url,init.method||"GET"]);
    if(url.endsWith("/auth/v1/user"))return Response.json({id:userId,email:"alex@example.com",email_confirmed_at:"2026-10-14T00:00:00Z"});
    if(url.includes("/rest/v1/calvren_billing_memberships")){
      if(init.method==="PATCH")return Response.json([{client_id:JSON.parse(init.body).client_id}]);
      return Response.json(active?[{subscription_status:"active",current_period_end:"2030-01-01T00:00:00Z",client_id:client}]:[]);
    }
    if(url.includes("/rest/v1/calvren_clients"))return Response.json([{id:"plumbing-live",config:{mode:"live",active:true}}]);
    if(url.includes("/rest/v1/calvren_onboarding")){
      if(init.method==="POST"||init.method==="PATCH"){
        saved={...saved,...JSON.parse(init.body)};
        return Response.json([saved]);
      }
      if(url.includes("auth_user_id=eq."))return Response.json(saved?[saved]:[]);
      return Response.json(saved?[saved]:[]);
    }
    return Response.json({error:"Unknown request"}, {status:404});
  };
  return {fetch,calls,get saved(){return saved}};
}
async function usingFetch(fake,operation){
  const previous=globalThis.fetch;
  globalThis.fetch=fake;
  try{return await operation()}finally{globalThis.fetch=previous}
}
test("client onboarding requires a verified session before querying private records",async()=>{
  const f=fixture();
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","GET",undefined,""),env));
  assert.equal(result.status,401);
  assert.equal(f.calls.length,0);
});
test("unauthorized owner cannot list private onboarding requests",async()=>{
  const f=fixture();
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding/admin","GET",undefined,"Bearer someone-else"),env));
  assert.equal(result.status,401);
  assert.equal(f.calls.length,0);
});
test("unpaid customer cannot save an onboarding form",async()=>{
  const f=fixture({active:false});
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","PUT",{form:validForm,current_step:2}),env));
  assert.equal(result.status,403);
  assert.equal(f.calls.some(([url])=>url.includes("calvren_onboarding")),false);
});
test("paid customer saves draft only under identity returned from Supabase Auth",async()=>{
  const f=fixture();
  const body={auth_user_id:otherId,status:"live",current_step:2,form:{business_name:"Northshore Plumbing",status:"live",api_key:"SHOULD_NOT_SAVE"}};
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","PUT",body),env));
  assert.equal(result.status,200);
  assert.equal(f.saved.auth_user_id,userId);
  assert.equal(f.saved.status,"draft");
  assert.equal(f.saved.form.api_key,undefined);
  assert.equal(f.saved.current_step,2);
});
test("cannot submit incomplete or unapproved onboarding",async()=>{
  const f=fixture();
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","POST",{form:{...validForm,consent_data_handling:false}}),env));
  assert.equal(result.status,400);
  assert.equal(f.saved,null);
});
test("submitted forms are locked from client changes",async()=>{
  const f=fixture({record:{auth_user_id:userId,status:"reviewing",form:validForm,current_step:4,owner_note:"",submitted_at:"2026-10-14"}});
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","PUT",{form:validForm,current_step:1}),env));
  assert.equal(result.status,409);
  assert.equal(f.saved.status,"reviewing");
});
test("owners must link a live business before marking an implementation launched",async()=>{
  const f=fixture({record:{auth_user_id:userId,status:"submitted",form:validForm,current_step:4,owner_note:""}});
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding/admin/"+userId,"PATCH",{status:"live"},"Bearer "+TOKEN),env));
  assert.equal(result.status,409);
  assert.notEqual(f.saved.status,"live");
});

test("optional kickoff request is saved with the questionnaire",async()=>{
  const f=fixture();
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","POST",{
    form:{...validForm,kickoff_requested:true,kickoff_availability:"Thursday afternoons Pacific"},current_step:4
  }),env));
  assert.equal(result.status,200);
  assert.equal(f.saved.form.kickoff_requested,true);
  assert.equal(f.saved.form.kickoff_availability,"Thursday afternoons Pacific");
});
test("kickoff request needs preferred times; no time is automatically booked",async()=>{
  const f=fixture();
  const result=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding","POST",{
    form:{...validForm,kickoff_requested:true},current_step:4
  }),env));
  assert.equal(result.status,400);
  assert.equal(f.saved,null);
});
test("cannot mark launch live without exact customer approval",async()=>{
  const f=fixture({record:{auth_user_id:userId,status:"testing",form:validForm,launch_scope:"",
    scope_approved_at:null,approved_scope:"",owner_note:""}});
  const admin="/api/onboarding/admin/"+userId;
  let r=await usingFetch(f.fetch,()=>handleOnboarding(endpoint(admin,"PATCH",{
    status:"awaiting_approval",launch_scope:"Website enquiries, 9–5 weekday bookings, human escalation."
  },"Bearer "+TOKEN),env));
  assert.equal(r.status,200);
  r=await usingFetch(f.fetch,()=>handleOnboarding(endpoint(admin,"PATCH",{
    status:"live"
  },"Bearer "+TOKEN),env));
  assert.equal(r.status,409);
  const unauthorized=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding/approve","POST",{
    approved:true,scope:"wrong old scope"
  }),env));
  assert.equal(unauthorized.status,409);
  r=await usingFetch(f.fetch,()=>handleOnboarding(endpoint("/api/onboarding/approve","POST",{
    approved:true,scope:"Website enquiries, 9–5 weekday bookings, human escalation."
  }),env));
  assert.equal(r.status,200);
  assert.equal(f.saved.status,"approved");
  assert.ok(f.saved.scope_approved_at);
  r=await usingFetch(f.fetch,()=>handleOnboarding(endpoint(admin,"PATCH",{
    status:"live",launch_scope:"Changed booking hours"
  },"Bearer "+TOKEN),env));
  assert.equal(r.status,409);
  r=await usingFetch(f.fetch,()=>handleOnboarding(endpoint(admin,"PATCH",{
    status:"live",client_id:"plumbing-live"
  },"Bearer "+TOKEN),env));
  assert.equal(r.status,200);
  assert.equal(f.saved.status,"live");
});
