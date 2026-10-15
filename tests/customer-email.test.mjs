import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";
const dir=await mkdtemp(join(tmpdir(),"calvren-client-email-"));
test.after(()=>rm(dir,{recursive:true,force:true}));
const src=await readFile(new URL("../server/customer-email.mts",import.meta.url),"utf8");
const compiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile(join(dir,"mail.mjs"),compiled);
const {sendClientMail}=await import(pathToFileURL(join(dir,"mail.mjs")).href);
const env=n=>({RESEND_API_KEY:"re_test_example",NOTIFICATION_FROM_EMAIL:"Calvren <hello@example.com>",CALVREN_PUBLIC_URL:"https://calvren.pages.dev"}[n]);
test("customer welcome uses branded HTML, accessible text, and an idempotency header",async()=>{
 let captured;
 const success=await sendClientMail(env,"customer@example.com","welcome",{
   id:"calvren-welcome-user123",fetcher:async(url,init)=>{captured={url,init};return Response.json({id:"em_fixture"});}
 });
 assert.equal(success,true);
 assert.equal(captured.url,"https://api.resend.com/emails");
 assert.equal(captured.init.headers["Idempotency-Key"],"calvren-welcome-user123");
 const payload=JSON.parse(captured.init.body);
 assert.match(payload.subject,/Welcome to Calvren/);
 assert.match(payload.html,/calvren/);
 assert.match(payload.text,/onboarding\.html/);
 assert.equal(payload.to[0],"customer@example.com");
});
test("submission confirmation safely escapes the business name and describes unbooked kickoff",async()=>{
 let payload;
 const success=await sendClientMail(env,"customer@example.com","submitted",{
   id:"calvren-submission-user123",business:'<img src=x onerror=alert(1)>',kickoff:true,
   fetcher:async(_,init)=>{payload=JSON.parse(init.body);return Response.json({id:"em_fixture"});}
 });
 assert.equal(success,true);
 assert.ok(!payload.html.includes('<img src=x'));
 assert.match(payload.text,/no meeting is booked yet/i);
 assert.match(payload.html,/&lt;img/);
});
test("transactional email is skipped safely when verified sender secrets are absent",async()=>{
 let calls=0;
 const result=await sendClientMail(()=>undefined,"person@example.com","welcome",{
  id:"welcome-id",fetcher:async()=>{calls++;return Response.json({});}
 });
 assert.equal(result,false);
 assert.equal(calls,0);
});

test("public enquiry receipt is personalized, branded, and has a verified-sender reply address",async()=>{
 let payload,captured;
 const success=await sendClientMail(env,"customer@example.com","enquiry_received",{
   id:"calvren-form-ack-123",firstName:"Taylor",business:"Harbour Plumbing",timeoutMs:3000,
   fetcher:async(_url,init)=>{payload=JSON.parse(init.body);captured=init;return Response.json({id:"em_ack"});}
 });
 assert.equal(success,true);
 assert.equal(payload.to[0],"customer@example.com");
 assert.equal(payload.reply_to,"calvrenautomation@gmail.com");
 assert.match(payload.subject,/received your enquiry/i);
 assert.match(payload.text,/Hi Taylor/);
 assert.match(payload.text,/Harbour Plumbing/);
 assert.match(payload.text,/not an appointment confirmation/i);
 assert.equal(captured.headers["Idempotency-Key"],"calvren-form-ack-123");
});
test("feedback receipt never implies customer feedback was published",async()=>{
 let mail;
 const success=await sendClientMail(env,"customer@example.com","feedback_received",{
   id:"calvren-feedback-ack",firstName:"Alex",business:"Example Studio",
   fetcher:async(_url,init)=>{mail=JSON.parse(init.body);return Response.json({id:"em_feedback"});}
 });
 assert.equal(success,true);
 assert.match(mail.subject,/thank you for your feedback/i);
 assert.match(mail.text,/Nothing will be published without/);
 assert.doesNotMatch(mail.text,/Jordan/);
});
