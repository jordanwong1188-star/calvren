import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
function compile(source) {
  const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
  assert.deepEqual(result.diagnostics.filter(item=>item.category===ts.DiagnosticCategory.Error),[]);
  return result.outputText;
}
const contracts=compile(await readFile(new URL("../src/conversion/contracts.mts",import.meta.url),"utf8"));
const contractsUrl="data:text/javascript;base64,"+Buffer.from(contracts).toString("base64");
const source=compile(await readFile(new URL("../netlify/lib/conversion-repository.mts",import.meta.url),"utf8"))
  .replaceAll("../../src/conversion/contracts.mjs",contractsUrl);
const { SupabaseRepository }=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
const client="test-client";
const lead="11111111-1111-4111-8111-111111111111";
const token="22222222-2222-4222-8222-222222222222";
const messageId="33333333-3333-4333-8333-333333333333";
const now="2030-01-02T10:00:00.000Z";
const fakeKey="sb_secret_synthetic_test_key";
const bundle={
  lead:{id:lead,client_id:client,version:0,mode:"live"},
  messages:[],appointments:[],notifications:[]
};
function setup(value,status=200) {
  const calls=[];
  const repository=new SupabaseRepository({
    url:"https://synthetic.supabase.co",key:fakeKey,
    fetch:async (url,init)=>{
      calls.push({url:String(url),init,body:init.body?JSON.parse(init.body):null});
      return status===204?new Response(null,{status}):new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
    }
  });
  return {repository,calls};
}

test("new Supabase secret uses apikey only and tenant query is encoded",async ()=>{
  const {repository,calls}=setup([{config:{id:client,business_name:"Synthetic business"}}]);
  assert.equal((await repository.getClient(client)).id,client);
  const url=new URL(calls[0].url);
  assert.equal(url.searchParams.get("id"),"eq."+client);
  assert.equal(url.searchParams.get("limit"),"1");
  assert.equal(calls[0].init.headers.apikey,fakeKey);
  assert.equal(calls[0].init.headers.Authorization,undefined);
  assert.equal(calls[0].init.cache,"no-store");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await assert.rejects(repository.getClient("tenant&select=*"),/Invalid client ID/);
  assert.equal(calls.length,1);
});

test("legacy service-role JWT uses Bearer; anon and malformed keys rejected",async ()=>{
  const jwt=Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url")+"."+
    Buffer.from(JSON.stringify({role:"service_role"})).toString("base64url")+".synthetic_signature";
  let headers;
  const repository=new SupabaseRepository({url:"https://synthetic.supabase.co",key:jwt,fetch:async(_url,init)=>{
    headers=init.headers; return new Response("[]");
  }});
  await repository.listClients();
  assert.equal(headers.Authorization,"Bearer "+jwt);
  const anon=Buffer.from(JSON.stringify({alg:"HS256"})).toString("base64url")+"."+
    Buffer.from(JSON.stringify({role:"anon"})).toString("base64url")+".synthetic_signature";
  for(const key of [anon,"bad-key","bad."+Buffer.from('{"role":"service_role"}').toString("base64url")+".signature"]) {
    assert.throws(()=>new SupabaseRepository({url:"https://synthetic.supabase.co",key}),/server-only Supabase/);
  }
});

test("rejects insecure or credential-bearing remote database URLs",()=>{
  for(const url of ["http://remote.example.com","https://user:pass@synthetic.supabase.co","https://synthetic.supabase.co?token=x","https://synthetic.supabase.co/path"]) {
    assert.throws(()=>new SupabaseRepository({url,key:fakeKey}),/server-only Supabase/);
  }
  assert.doesNotThrow(()=>new SupabaseRepository({url:"http://127.0.0.1:54321",key:fakeKey}));
});

test("atomic intake includes stable retry key and permits active-phone dedupe",async()=>{
  const existing={...bundle,lead:{...bundle.lead,id:token}};
  const {repository,calls}=setup({created:false,bundle:existing});
  const result=await repository.createLead(bundle,"stable-request-key");
  assert.equal(result.created,false);
  assert.equal(result.bundle.lead.id,token);
  assert.equal(calls[0].url,"https://synthetic.supabase.co/rest/v1/rpc/calvren_create_lead");
  assert.equal(calls[0].body.p_idempotency_key,"stable-request-key");
  assert.deepEqual(calls[0].body.p_bundle,bundle);
});

test("tenant-mismatched response and child rows never reach callers or writes",async()=>{
  const bad={...bundle,lead:{...bundle.lead,client_id:"other-client"}};
  const {repository,calls}=setup(bad);
  await assert.rejects(repository.getBundle(client,lead),/mismatched response/);
  const badWrite={...bundle,messages:[{id:messageId,lead_id:lead,client_id:"other-client"}]};
  await assert.rejects(repository.saveBundle(badWrite,token,now),/tenant identity/);
  assert.equal(calls.length,1);
});

test("lease CAS and inbound retain tenant/version/event arguments",async()=>{
  let {repository,calls}=setup(bundle);
  assert.deepEqual(await repository.saveBundle(bundle,token,now),bundle);
  assert.deepEqual(calls[0].body,{p_bundle:bundle,p_token:token,p_now:now});
  ({repository,calls}=setup({created:true,bundle}));
  const message={id:messageId,client_id:client,lead_id:lead};
  await repository.appendInbound(client,lead,message,"twilio-event");
  assert.deepEqual(calls[0].body,{p_client_id:client,p_lead_id:lead,p_message:message,p_event_key:"twilio-event"});
  ({repository,calls}=setup(null));
  assert.equal(await repository.acquireLease(client,lead,now,90),null);
  assert.equal(calls[0].body.p_ttl_seconds,90);
});

test("appointment reservation sends stable identity and rejects cross-tenant appointments",async()=>{
  const appointment={id:messageId,client_id:client,lead_id:lead};
  const {repository,calls}=setup(bundle);
  await repository.reserveAppointment(bundle,appointment,token,now);
  assert.equal(calls[0].body.p_appointment.id,messageId);
  await assert.rejects(repository.reserveAppointment(bundle,{...appointment,client_id:"other-client"},token,now),/identity do not match/);
  assert.equal(calls.length,1);
});

test("due-follow-up scan stays bounded and returned identities are checked",async()=>{
  const {repository,calls}=setup([{client_id:client,lead_id:lead}]);
  assert.deepEqual(await repository.dueFollowUps(now,25),[{client_id:client,lead_id:lead}]);
  assert.equal(calls[0].body.p_limit,25);
  await assert.rejects(repository.dueFollowUps(now,101),/numeric limit/);
});

test("delivery callback uses exact message ID and preserves scoped provider/event identity",async()=>{
  const {repository,calls}=setup(true);
  assert.equal(await repository.updateMessageStatus(client,lead,"SM-synthetic","sent","callback-key",messageId),true);
  assert.deepEqual(calls[0].body,{p_client_id:client,p_lead_id:lead,p_provider_id:"SM-synthetic",p_status:"sent",p_event_key:"callback-key",p_message_id:messageId});
  await assert.rejects(repository.updateMessageStatus(client,lead,"SM-synthetic","sent","callback-key","bad-id"),/record ID/);
  assert.equal(calls.length,1);
});

test("hashed intake keys and durable rate limits never store plaintext keys",async()=>{
  const digest="a".repeat(64);
  const {repository,calls}=setup(true);
  assert.equal(await repository.verifyClientKey(client,digest),true);
  assert.equal(await repository.consumeRateLimit(digest,5,60,now),true);
  assert.equal(calls[0].body.p_key_hash,digest);
  assert.equal(calls[1].body.p_key_hash,digest);
  await assert.rejects(repository.rotateClientKey(client,"plaintext-intake-key"),/SHA-256/);
  assert.equal(calls.length,2);
});

test("provider failures redact details and map conflicts without retrying mutations",async()=>{
  const {repository,calls}=setup({code:"23505",message:"private-error-"+fakeKey,details:"customer-private@example.com"},409);
  await assert.rejects(repository.createLead(bundle,"stable-key"),error=>{
    assert.equal(error.status,409);
    assert.equal(error.code,"conflict");
    assert.doesNotMatch(error.message,/private-error|synthetic_test_key|customer-private/);
    return true;
  });
  assert.equal(calls.length,1);
  const offline=new SupabaseRepository({url:"https://synthetic.supabase.co",key:fakeKey,fetch:async()=>{
    throw new Error("private-error-"+fakeKey);
  }});
  await assert.rejects(offline.createLead(bundle,"stable-key"),error=>{
    assert.equal(error.status,503);
    assert.doesNotMatch(error.message,/synthetic_test_key/);
    return true;
  });
});

test("migration protects browser roles and contains atomic tenant/isolation primitives",async()=>{
  const sql=await readFile(new URL("../supabase/migrations/202610030001_calvren_conversion.sql",import.meta.url),"utf8");
  for(const table of ["clients","leads","messages","appointments","notifications","events","client_keys","rate_limits"]) {
    assert.ok(sql.includes("alter table public.calvren_"+table+" enable row level security;"));
    assert.ok(sql.includes("revoke all on table public.calvren_"+table+" from public,anon,authenticated;"));
  }
  assert.doesNotMatch(sql,/security definer/i);
  assert.ok(sql.includes("foreign key (client_id,lead_id) references public.calvren_leads(client_id,id)"));
  assert.ok(sql.includes("pg_advisory_xact_lock"));
  assert.ok(sql.includes("calvren-calendar:"));
  assert.ok(sql.includes("lease_token=null,lease_expires_at=null"));
  assert.doesNotMatch(sql,/sb_secret_[a-zA-Z0-9]{12,}|sk-[a-zA-Z0-9]{20,}/);
});
