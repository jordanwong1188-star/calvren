import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";

const dir=await mkdtemp(join(tmpdir(),"calvren-retell-"));
const source=await readFile(new URL("../server/receptionist.mts",import.meta.url),"utf8");
const code=source.replace('import { adminAuthorized } from "../netlify/lib/conversion-api.mjs";',
  'const adminAuthorized = (request, expected) => expected?.length>=32 && request.headers.get("authorization")==="Bearer "+expected;');
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile(join(dir,"receptionist.mjs"),js);
const {verifyRetellSignature,handleReceptionist}=await import(pathToFileURL(join(dir,"receptionist.mjs")).href);
test.after(()=>rm(dir,{recursive:true,force:true}));
const admin="test-calvren-owner-token-with-thirty-two-chars";
const secret="test-retell-webhook-signing-key";
const env=key=>({
  SUPABASE_URL:"https://test.supabase.co",
  SUPABASE_SECRET_KEY:"sb_secret_fixture",
  CALVREN_ADMIN_TOKEN:admin,RETELL_WEBHOOK_KEY:secret
})[key];
const sign=body=>{const stamp=Date.now();return 'v='+stamp+',d='+createHmac("sha256",secret).update(body+stamp).digest("hex");};
const request=(path,body,signature=true)=>new Request("https://calvren.ca"+path,{
  method:"POST",headers:{"Content-Type":"application/json",...(signature?{"X-Retell-Signature":sign(JSON.stringify(body))}:{})},
  body:JSON.stringify(body)
});
test("Retell raw-body signature rejects tampering and expired requests",()=>{
  const raw='{"event":"call_started"}',stamp=Date.now();
  const header='v='+stamp+',d='+createHmac("sha256",secret).update(raw+stamp).digest("hex");
  assert.equal(verifyRetellSignature(raw,secret,header,stamp),true);
  assert.equal(verifyRetellSignature(raw+" ",secret,header,stamp),false);
  assert.equal(verifyRetellSignature(raw,secret,header,stamp+301000),false);
  assert.equal(verifyRetellSignature(raw,undefined,header,stamp),false);
  assert.equal(verifyRetellSignature(raw,secret,"v=1,d=bad",stamp),false);
});
test("No anonymous operator access and no unsigned inbound call",async()=>{
  const get=await handleReceptionist(new Request("https://calvren.ca/api/receptionist/configs"),env);
  assert.equal(get.status,401);
  const inbound=await handleReceptionist(request("/api/receptionist/inbound",
    {event:"call_inbound",call_inbound:{to_number:"+16045550123"}},false),env);
  assert.equal(inbound.status,401);
});
test("Signed inbound call is rejected for disabled client",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json([]);
  try{
    const res=await handleReceptionist(request("/api/receptionist/inbound",{
      event:"call_inbound",call_inbound:{to_number:"+16045550123",from_number:"+16045550124",agent_id:"agent_123456"}
    }),env);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{call_inbound:{reject:true}});
  }finally{globalThis.fetch=original}
});
test("Webhook stores only authorized tenant's minimal call metadata",async()=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(url,init)=>{
    const u=String(url);seen.push({url:u,init});
    if(u.includes("calvren_receptionist_configs"))return Response.json([{
      client_id:"plumbing-live",retell_agent_id:"agent_123456",retell_phone_number:"+16045550123",enabled:true
    }]);
    if(u.includes("calvren_clients"))return Response.json([{config:{mode:"live",active:true,business_name:"Plumbing Co"}}]);
    if(u.includes("rpc/calvren_receptionist_record_event"))return Response.json(null);
    return Response.json([], {status:200});
  };
  try{
    const res=await handleReceptionist(request("/api/receptionist/webhook",{
      event:"call_ended",call:{
        call_id:"call_123456",agent_id:"agent_123456",to_number:"+16045550123",
        metadata:{calvren_client_id:"victim-other-client"},transcript:"sensitive transcript",
        start_timestamp:1780000000000,end_timestamp:1780000030000
      }
    }),env);
    assert.equal(res.status,200);
    const writes=seen.filter(x=>x.url.includes("rpc/calvren_receptionist_record_event"));
    assert.equal(writes.length,1);
    const body=JSON.parse(writes[0].init.body);
    assert.equal(body.p_client_id,"plumbing-live");
    assert.equal(body.p_call_id,"call_123456");
    assert.equal(JSON.stringify(body).includes("sensitive transcript"),false);
  }finally{globalThis.fetch=original}
});
