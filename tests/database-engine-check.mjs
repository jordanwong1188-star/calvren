import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import ts from "typescript";

const execute=promisify(execFile);
const temporary=await mkdtemp(join(tmpdir(),"calvren-database-engine-"));
const quote=value=>value===null?"NULL":"'"+(typeof value==="object"?JSON.stringify(value):String(value)).replaceAll("'","''")+"'";
async function sql(statement){
  const {stdout}=await execute("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c","SET ROLE service_role; "+statement],{maxBuffer:4*1024*1024});
  return stdout.trim()?JSON.parse(stdout.trim()):null;
}
/** Execute the actual adapter's REST/RPC payloads against disposable PostgreSQL.
 * HTTP formatting has separate fetch contract tests; this bridge validates engine/SQL compatibility. */
async function databaseTransport(input,options={}){
  const url=new URL(String(input));
  try{
    const rpc=/^\/rest\/v1\/rpc\/(calvren_[a-z_]+)$/.exec(url.pathname);
    if(rpc){
      const args=JSON.parse(String(options.body));
      assert.ok(Object.keys(args).every(name=>/^p_[a-z_]+$/.test(name)));
      const named=Object.entries(args).map(([name,value])=>name+" => "+quote(value)).join(",");
      return Response.json(await sql("SELECT to_jsonb(public."+rpc[1]+"("+named+"));"));
    }
    assert.equal(url.pathname,"/rest/v1/calvren_clients");
    assert.equal(options.method,"GET");
    const filter=url.searchParams.get("id");
    assert.ok(!filter||filter.startsWith("eq."));
    const where=filter?" WHERE id="+quote(filter.slice(3)):"";
    return Response.json(await sql("SELECT coalesce(jsonb_agg(jsonb_build_object('config',q.config)),'[]'::jsonb) FROM (SELECT config FROM public.calvren_clients"+where+" ORDER BY id LIMIT 200) q;"));
  }catch(error){
    console.error("CALVREN_DATABASE_ENGINE_QUERY_FAILED:",error.stderr||error.message);
    return Response.json({code:"22023"},{status:409});
  }
}
let clientId;
try{
  const core=(await readdir("src/conversion")).filter(name=>name.endsWith(".mts")).map(name=>"src/conversion/"+name);
  for(const path of [...core,"netlify/lib/conversion-repository.mts"]){
    const target=join(temporary,path.replace(/\.mts$/,".mjs"));
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,ts.transpileModule(await readFile(path,"utf8"),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
  }
  const module=path=>import(pathToFileURL(join(temporary,path)).href);
  const {SupabaseRepository}=await module("netlify/lib/conversion-repository.mjs");
  const {ConversionEngine}=await module("src/conversion/engine.mjs");
  const {newDemoClient}=await module("src/conversion/demo-config.mjs");
  const {createDemoServices}=await module("src/conversion/mock-services.mjs");
  const repository=new SupabaseRepository({url:"http://127.0.0.1:5432",key:"sb_secret_ci_only",fetch:databaseTransport});
  clientId="ci-engine-"+randomUUID().slice(0,8);
  const client=newDemoClient({id:clientId});
  await repository.saveClient(client);
  let tick=0;
  const clock=()=>new Date(Date.parse("2026-10-05T16:00:00Z")+(tick++)*100);
  const engine=new ConversionEngine({repository,...createDemoServices(),now:clock,uuid:randomUUID});
  const firstInput={client_id:clientId,name:"Fake CI Lead",phone:"+15555550999",message:"Hi, my kitchen sink is leaking and I need someone to look at it.",channel:"website",idempotency_key:"ci-intake"};
  let bundle=await engine.intake(firstInput);
  assert.equal(bundle.lead.status,"contacted",JSON.stringify(bundle.lead));
  assert.equal(bundle.messages.length,2);
  assert.equal(bundle.messages[1].status,"sent");
  const creation=bundle.messages[1].timestamp;
  assert.notEqual(creation,bundle.lead.last_contacted_at,"Created message timestamp stays immutable while contact time advances.");
  const replay=await engine.intake(firstInput);
  assert.equal(replay.messages.length,2);
  for(const [index,message]of ["Not an emergency, it can wait for a routine appointment.","Vancouver","Tomorrow"].entries()){
    bundle=await engine.receive({client_id:clientId,lead_id:bundle.lead.id,message,channel:"website",event_key:"ci-reply-"+index});
    assert.notEqual(bundle.lead.status,"needs_human",JSON.stringify(bundle.lead));
  }
  assert.equal(bundle.lead.qualification_status,"qualified");
  assert.equal(bundle.lead.appointment_status,"offered");
  assert.equal(bundle.lead.offered_slots.length,3);
  assert.equal(bundle.notifications.find(n=>n.event==="qualified")?.status,"sent");
  bundle=await engine.receive({client_id:clientId,lead_id:bundle.lead.id,message:"1",channel:"website",event_key:"ci-booking"});
  assert.equal(bundle.lead.status,"booked",JSON.stringify(bundle.lead));
  assert.equal(bundle.appointments.length,1);
  assert.equal(bundle.appointments[0].status,"booked");
  assert.equal(bundle.notifications.find(n=>n.event==="booked")?.status,"sent");
  assert.equal(bundle.lead.next_follow_up_at,null);
  const stored=await repository.getBundle(clientId,bundle.lead.id);
  assert.equal(stored.messages.length,bundle.messages.length);
  assert.equal(stored.messages[1].timestamp,creation);
  bundle=await engine.receive({client_id:clientId,lead_id:bundle.lead.id,message:"Thanks",channel:"website",event_key:"ci-thanks"});
  assert.equal(bundle.lead.status,"booked");
  bundle=await engine.receive({client_id:clientId,lead_id:bundle.lead.id,message:"STOP",channel:"website",event_key:"ci-stop"});
  assert.equal(bundle.lead.opted_out,true);
  assert.equal(bundle.lead.automation_active,false);
  assert.equal(bundle.lead.status,"needs_human");
  assert.equal(bundle.notifications.find(n=>n.event==="needs_human")?.status,"sent");
  console.log("CALVREN_DATABASE_ENGINE_PASSED: actual shared engine and Supabase adapter payloads through real PostgreSQL RPCs; intake, replay, qualification, booking, notifications, immutable history, terminal replies and STOP.");
}finally{
  if(clientId)await execute("psql",["-X","-q","-v","ON_ERROR_STOP=1","-c","DELETE FROM public.calvren_clients WHERE id="+quote(clientId)+";"]).catch(()=>{});
  await rm(temporary,{recursive:true,force:true});
}
