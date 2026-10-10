import test,{after} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";
const directory=await mkdtemp(join(tmpdir(),"calvren-hosting-"));
after(()=>rm(directory,{recursive:true,force:true}));
const modules=[
  ...["contracts","demo-config","validation","time","memory-repository","mock-services","engine"].map(name=>"src/conversion/"+name+".mts"),
  ...["conversion-api","conversion-providers","conversion-repository","workflow-core"].map(name=>"netlify/lib/"+name+".mts"),
  ...["conversion-runtime","private-storage","forms","demo-access","router"].map(name=>"server/"+name+".mts"),
  "functions/_middleware.ts"
];
for(const path of modules){
  const source=await readFile(new URL("../"+path,import.meta.url),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
  const target=join(directory,path.replace(/\.mts$/,".mjs").replace(/\.ts$/,".mjs"));
  await mkdir(dirname(target),{recursive:true});await writeFile(target,output.outputText);
}
const load=path=>import(pathToFileURL(join(directory,path+".mjs")).href);
const {handlePublicForm}=await load("server/forms");
const {handleServer}=await load("server/router");
const {handleDemoSignup,handleDemoUnsubscribe}=await load("server/demo-access");
const {onRequest}=await load("functions/_middleware");
const token="hosting-fixture-operator-token-at-least-32-characters";
const env=name=>({CALVREN_ADMIN_TOKEN:token,SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SECRET_KEY:"sb_secret_fixture"}[name]);
test("portable backend preserves custom operator authentication and defaults to demo",async()=>{
  const url="https://fixture.supabase.co/functions/v1/calvren/api/conversion/status";
  let response=await handleServer(new Request(url),{env});
  assert.equal(response.status,401);
  response=await handleServer(new Request(url,{headers:{Authorization:"Bearer "+token}}),{env});
  assert.equal(response.status,200);
  const {readiness}=await response.json();
  assert.equal(readiness.mode,"demo");assert.equal(readiness.database,true);
  assert.equal(readiness.providers.twilio,false);
  response=await handleServer(new Request(url.replace("/api/conversion/status","/api/internal/follow-ups"),{method:"POST"}),{env});
  assert.equal(response.status,401);
});
function formFixture(overrides={}){
  const writes=[];const rows=new Map();const limits=[];
  const deps={ip:"fixture-ip",repository:{async consumeRateLimit(...args){limits.push(args);return true;}},
    storage:{async get(key){return rows.get(key)??null;},async delete(key){rows.delete(key);},async setJSON(key,data,conditions){writes.push({key,data,conditions});if(!rows.has(key))rows.set(key,data);return{modified:true};}},...overrides};
  const fields={"form-name":"project-enquiry",name:"Jordan Test",email:"test@example.com",message:"Please help us organise new enquiries.",consent:"yes","submission-key":"fixture-request",industry:"Local services"};
  const request=extra=>new Request("https://calvren.example/forms",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...fields,...extra})});
  return{deps,request,writes,rows,limits};
}
test("public forms save private enquiries without AI processing and retry with a stable identity",async()=>{
  const f=formFixture();
  const first=await handlePublicForm(f.request(),f.deps);assert.equal(first.status,201);
  const id=(await first.json()).id;
  const second=await handlePublicForm(f.request(),f.deps);assert.equal((await second.json()).id,id);
  assert.equal(f.rows.size,1);assert.equal(f.writes[0].data.status,"new");assert.equal(f.writes[0].data.automation,null);
  assert.equal(f.writes[0].conditions.onlyIfNew,true);
  assert.ok(f.limits.every(([hash])=>/^[a-f0-9]{64}$/.test(hash)));
});
test("public forms enforce consent, honeypot, field bounds and rate limits",async()=>{
  const f=formFixture();
  assert.equal((await handlePublicForm(f.request({consent:""}),f.deps)).status,400);
  assert.equal((await handlePublicForm(f.request({website:"bot"}),f.deps)).status,200);
  assert.equal((await handlePublicForm(f.request({email:"bad"}),f.deps)).status,400);
  assert.equal((await handlePublicForm(f.request({message:"x".repeat(3001)}),f.deps)).status,400);
  assert.equal(f.writes.length,0);
  const limited=formFixture({repository:{async consumeRateLimit(){return false;}}});
  assert.equal((await handlePublicForm(limited.request(),limited.deps)).status,429);
});
test("client reviews store optional publication permission without publishing feedback",async()=>{
  const f=formFixture();
  const response=await handlePublicForm(f.request({"form-name":"client-insight",company:"Test Business",workflow:"Lead intake",experience:"It made our enquiry process easier.","feedback-consent":"yes"}),f.deps);
  assert.equal(response.status,201);assert.ok(f.writes[0].key.startsWith("feedback/"));
  assert.equal(f.writes[0].data.publication_permission,false);assert.equal(f.writes[0].data.review_consent,true);
});
test("Cloudflare proxy forwards protected APIs and forms without cookies or redirecting credentials",async()=>{
  const realFetch=globalThis.fetch, calls=[];
  try{
    globalThis.fetch=async request=>{calls.push(request);return new Response('{"ok":true}',{headers:{"Content-Type":"application/json"}});};
    const request=new Request("https://calvren.pages.dev/api/conversion/status",{headers:{Authorization:"Bearer "+token,Cookie:"private=session","CF-Connecting-IP":"203.0.113.10"}});
    const result=await onRequest({request,env:{},next:async()=>{throw new Error("Unexpected static route");}});
    assert.equal(result.status,200);assert.equal(calls[0].headers.get("authorization"),"Bearer "+token);
    assert.equal(calls[0].headers.get("cookie"),null);assert.equal(calls[0].headers.get("x-calvren-client-ip"),"203.0.113.10");
    assert.equal(new URL(calls[0].url).pathname,"/functions/v1/calvren/api/conversion/status");
    const form=new Request("https://calvren.pages.dev/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"name=Test"});
    assert.equal((await onRequest({request:form,env:{},next:async()=>new Response("static")})).status,200);
    assert.ok(calls[1].url.endsWith("/calvren/forms"));assert.equal(await calls[1].text(),"name=Test");
    const plainForm=new Request("https://calvren.pages.dev/thanks.html",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"name=Test"});
    const plainResult=await onRequest({request:plainForm,env:{},next:async()=>new Response("static")});
    assert.equal(plainResult.status,303);assert.equal(plainResult.headers.get("location"),"/thanks.html");assert.ok(calls[2].url.endsWith("/calvren/forms"));
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:"https://untrusted.example/"}});
    assert.equal((await onRequest({request,env:{},next:async()=>new Response("static")})).status,503);
    assert.equal((await onRequest({request:new Request("https://calvren.pages.dev/styles.css"),env:{},next:async()=>new Response("static")})).status,200);
  }finally{globalThis.fetch=realFetch;}
});

function signupFixture(configured=true){
  const rows=new Map(),mails=[];let revision=0;const limits=[];
  const settings=configured?{RESEND_API_KEY:"fixture-email-key",NOTIFICATION_FROM_EMAIL:"Calvren <hello@example.com>",CALVREN_BUSINESS_ADDRESS:"Fixture address for tests",CALVREN_PUBLIC_URL:"https://calvren.pages.dev"}:{};
  const deps={ip:"fixture",env:name=>settings[name],repository:{async consumeRateLimit(...args){limits.push(args);return true;}},
    storage:{async getWithMetadata(key){return rows.get(key)??null;},async get(key){return rows.get(key)?.data??null;},
      async setJSON(key,data,conditions){const previous=rows.get(key);if((conditions?.onlyIfNew&&previous)||(conditions?.onlyIfMatch&&previous?.etag!==conditions.onlyIfMatch))return{modified:false};
        const etag=String(++revision);rows.set(key,{data:structuredClone(data),etag});return{modified:true,etag};}},
    fetch:async(url,options)=>{mails.push({url,options});return new Response('{"id":"fixture-message"}',{status:200});}
  };
  const request=(consent=false,extra={})=>new Request("https://calvren.pages.dev/api/demo-access",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"visitor@example.com",promotional_consent:consent,...extra})});
  return{deps,rows,mails,limits,request,settings};
}
test("demo email capture returns immediate access without creating a verified account or sending unsolicited promotion",async()=>{
  const f=signupFixture(),response=await handleDemoSignup(f.request(),f.deps);
  assert.equal(response.status,201);const data=await response.json();assert.equal(data.demo_url,"/lead-demo.html");assert.equal(data.promotion,"not_requested");
  assert.equal(f.mails.length,0);const row=[...f.rows.values()][0].data;assert.equal(row.email_verified,false);assert.equal(row.promotional_consent,false);
  assert.ok(f.limits.every(([key])=>/^[a-f0-9]{64}$/.test(key)));
});
test("promotional introduction requires explicit boolean consent and sends at most once",async()=>{
  const f=signupFixture();
  assert.equal((await handleDemoSignup(f.request(false,{promotional_consent:"yes"}),f.deps)).status,400);
  const results=await Promise.all([handleDemoSignup(f.request(true),f.deps),handleDemoSignup(f.request(true),f.deps)]);
  assert.ok(results.every(r=>r.status===201));assert.equal(f.mails.length,1);
  await handleDemoSignup(f.request(true),f.deps);assert.equal(f.mails.length,1);
  const mail=JSON.parse(f.mails[0].options.body);assert.deepEqual(mail.to,["visitor@example.com"]);assert.match(mail.html,/Fixture address/);
  assert.match(mail.headers["List-Unsubscribe"],/calvren.pages.dev\/api\/demo-access\/unsubscribe/);
  assert.equal(mail.headers["List-Unsubscribe-Post"],"List-Unsubscribe=One-Click");
  assert.equal(f.mails[0].options.headers["Idempotency-Key"].startsWith("calvren-demo-promo-"),true);
});
test("demo remains available when promotional email is not configured, and a later explicit request can send once setup is complete",async()=>{
  const f=signupFixture(false);let response=await handleDemoSignup(f.request(true),f.deps);
  assert.equal(response.status,201);assert.equal((await response.json()).promotion,"unavailable");assert.equal(f.mails.length,0);
  Object.assign(f.settings,{RESEND_API_KEY:"fixture",NOTIFICATION_FROM_EMAIL:"hello@example.com",CALVREN_BUSINESS_ADDRESS:"Fixture address"});
  response=await handleDemoSignup(f.request(true),f.deps);assert.equal((await response.json()).promotion,"sent");assert.equal(f.mails.length,1);
});
test("promotional provider failure never blocks demo access or repeatedly retries an email",async()=>{
  const f=signupFixture();f.deps.fetch=async(url,options)=>{f.mails.push({url,options});return new Response("rejected",{status:400});};
  const response=await handleDemoSignup(f.request(true),f.deps);assert.equal(response.status,201);assert.equal((await response.json()).promotion,"failed");
  await handleDemoSignup(f.request(true),f.deps);assert.equal(f.mails.length,1);
});
test("unsubscribe GET confirms without changing consent; POST revokes and prevents re-enrolment",async()=>{
  const f=signupFixture();await handleDemoSignup(f.request(true),f.deps);
  const mail=JSON.parse(f.mails[0].options.body),url=mail.headers["List-Unsubscribe"].slice(1,-1);
  assert.equal((await handleDemoUnsubscribe(new Request(url),f.deps)).status,200);
  assert.equal([...f.rows.values()][0].data.promotional_consent,true);
  assert.equal((await handleDemoUnsubscribe(new Request(url,{method:"POST"}),f.deps)).status,200);
  assert.equal([...f.rows.values()][0].data.promotional_consent,false);
  const response=await handleDemoSignup(f.request(true),f.deps);assert.equal((await response.json()).promotion,"unsubscribed");assert.equal(f.mails.length,1);
  const bad=new URL(url);bad.searchParams.set("token","a".repeat(43));
  assert.equal((await handleDemoUnsubscribe(new Request(bad),f.deps)).status,400);
});
test("demo signup validates input, bounds request size and fails closed on rate limits",async()=>{
  const f=signupFixture();
  assert.equal((await handleDemoSignup(f.request(false,{email:"invalid"}),f.deps)).status,400);
  assert.equal((await handleDemoSignup(f.request(false,{website:"bot"}),f.deps)).status,400);
  assert.equal((await handleDemoSignup(f.request(false,{email:"x".repeat(2100)}),f.deps)).status,413);
  f.deps.repository.consumeRateLimit=async()=>false;
  assert.equal((await handleDemoSignup(f.request(),f.deps)).status,429);assert.equal(f.rows.size,0);assert.equal(f.mails.length,0);
});
