import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { adminAuthorized } from "../netlify/lib/conversion-api.mjs";

type Env=(key:string)=>string|undefined;
type Row=Record<string,any>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}});
const clientId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const agentId=/^[a-zA-Z0-9_-]{5,120}$/;
const e164=/^[+][1-9][0-9]{7,14}$/;
const validEvents=new Set(["call_started","call_ended","call_analyzed"]);

export function verifyRetellSignature(raw:string,key:string|undefined,header:string|null,now=Date.now()):boolean{
  if(!key||!header||!Number.isFinite(now))return false;
  const match=/^v=([0-9]{12,16}),d=([a-fA-F0-9]{64})$/.exec(header);
  if(!match)return false;
  const stamp=Number(match[1]);
  if(!Number.isSafeInteger(stamp)||Math.abs(now-stamp)>300000)return false;
  const digest=createHmac("sha256",key).update(raw+match[1]).digest();
  return timingSafeEqual(digest,Buffer.from(match[2],"hex"));
}
function dbSettings(env:Env){
  const url=env("SUPABASE_URL")||"",key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)||!key)throw Error("Private database unavailable.");
  return {url:url.replace(/\/$/,""),key};
}
async function db(env:Env,path:string,method="GET",body?:unknown):Promise<Row[]>{
  const {url,key}=dbSettings(env);
  const res=await fetch(url+"/rest/v1/"+path,{method,headers:{
    apikey:key,"Content-Type":"application/json",
    ...(body===undefined?{}:{Prefer:"return=representation,resolution=merge-duplicates"})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error("Private receptionist storage failed.");
  const result=await res.text();
  return result?JSON.parse(result) as Row[]:[];
}
async function selectOne(env:Env,table:string,query:Record<string,string>):Promise<Row|null>{
  const params=new URLSearchParams({...query,limit:"1"});
  const rows=await db(env,table+"?"+params.toString());
  return rows[0]||null;
}
async function activeClient(env:Env,id:string):Promise<Row|null>{
  const client=await selectOne(env,"calvren_clients",{id:"eq."+id,select:"config"});
  return client?.config?.mode==="live"&&client.config.active===true?client:null;
}
async function approvedPaidClient(env:Env,id:string):Promise<boolean>{
  if(!await activeClient(env,id))return false;
  const member=await selectOne(env,"calvren_billing_memberships",{client_id:"eq."+id,select:"auth_user_id,subscription_status,current_period_end,stripe_price_id"});
  if(!member||!["active","trialing"].includes(member.subscription_status)||!member.stripe_price_id)return false;
  if(member.current_period_end&&Date.parse(member.current_period_end)<=Date.now())return false;
  const onboard=await selectOne(env,"calvren_onboarding",{
    auth_user_id:"eq."+member.auth_user_id,select:"status,scope_approved_at,approved_scope"
  });
  return !!onboard&&["approved","live"].includes(onboard.status)&&!!onboard.scope_approved_at&&
    typeof onboard.approved_scope==="string"&&!!onboard.approved_scope.trim();
}
async function readConfig(env:Env,filters:Record<string,string>):Promise<Row|null>{
  return selectOne(env,"calvren_receptionist_configs",{
    ...filters,select:"client_id,retell_agent_id,retell_phone_number,enabled,updated_at"
  });
}
async function safeRaw(request:Request):Promise<string|null>{
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))return null;
  if(Number(request.headers.get("content-length")||0)>125000)return null;
  const raw=await request.text();
  return raw.length>125000?null:raw;
}
function verified(request:Request,raw:string,env:Env):boolean{
  return verifyRetellSignature(raw,env("RETELL_WEBHOOK_KEY"),request.headers.get("x-retell-signature"));
}
function asIso(value:unknown):string|null{
  return typeof value==="number"&&Number.isFinite(value)&&value>0&&value<4000000000000?
    new Date(value).toISOString():null;
}
async function inbound(request:Request,env:Env):Promise<Response>{
  if(request.method!=="POST")return json({error:"POST required"},405);
  const raw=await safeRaw(request);if(raw===null)return json({error:"Invalid payload"},415);
  if(!verified(request,raw,env))return json({error:"Invalid Retell signature"},401);
  let data:Row;
  try{data=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  if(data.event!=="call_inbound"||!data.call_inbound||data.chat_inbound)return json({call_inbound:{reject:true}});
  const info=data.call_inbound;
  if(typeof info.to_number!=="string"||!e164.test(info.to_number))return json({call_inbound:{reject:true}});
  const config=await readConfig(env,{retell_phone_number:"eq."+info.to_number,enabled:"eq.true"});
  if(!config||(info.agent_id&&info.agent_id!==config.retell_agent_id)||
    !await approvedPaidClient(env,config.client_id))return json({call_inbound:{reject:true}});
  const client=await activeClient(env,config.client_id);
  const businessName=String(client?.config?.business_name||"").trim().slice(0,160);
  if(!businessName)return json({call_inbound:{reject:true}});
  return json({call_inbound:{
    override_agent_id:config.retell_agent_id,
    dynamic_variables:{business_name:businessName},
    metadata:{calvren_client_id:config.client_id}
  }});
}
async function eventWebhook(request:Request,env:Env):Promise<Response>{
  if(request.method!=="POST")return json({error:"POST required"},405);
  const raw=await safeRaw(request);if(raw===null)return json({error:"Invalid payload"},415);
  if(!verified(request,raw,env))return json({error:"Invalid Retell signature"},401);
  let data:Row;
  try{data=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  const call=data.call;
  if(!validEvents.has(data.event)||!call||typeof call.call_id!=="string"||
    !agentId.test(call.call_id)||typeof call.agent_id!=="string"||
    !agentId.test(call.agent_id)||typeof call.to_number!=="string"||!e164.test(call.to_number)){
    return json({ok:true,ignored:true});
  }
  const config=await readConfig(env,{retell_agent_id:"eq."+call.agent_id,retell_phone_number:"eq."+call.to_number,enabled:"eq.true"});
  // Do not allow caller-supplied metadata to select a different tenant.
  if(!config||!await activeClient(env,config.client_id))return json({ok:true,ignored:true});
  await db(env,"rpc/calvren_receptionist_record_event","POST",{
    p_client_id:config.client_id,p_call_id:call.call_id,p_agent_id:call.agent_id,
    p_event:data.event,p_started_at:asIso(call.start_timestamp),p_ended_at:asIso(call.end_timestamp)
  });
  return json({ok:true});
}
export async function handleReceptionist(request:Request,env:Env):Promise<Response>{
  const path=new URL(request.url).pathname;
  try{
    if(path==="/api/receptionist/inbound")return inbound(request,env);
    if(path==="/api/receptionist/webhook")return eventWebhook(request,env);
    if(!adminAuthorized(request,env("CALVREN_ADMIN_TOKEN")))return json({error:"Operator authentication required"},401);
    if(path==="/api/receptionist/configs"&&request.method==="GET"){
      const rows=await db(env,"calvren_receptionist_configs?select=client_id,retell_agent_id,retell_phone_number,enabled,updated_at&order=updated_at.desc&limit=100");
      return json({ok:true,retell_webhook_key_configured:!!env("RETELL_WEBHOOK_KEY"),configs:rows});
    }
    const m=/^\/api\/receptionist\/configs\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})(?:\/(activate|deactivate|calls))?$/.exec(path);
    if(!m||!clientId.test(m[1]))return json({error:"Not found"},404);
    const id=m[1],action=m[2]||"";
    if(action==="calls"&&request.method==="GET"){
      const rows=await db(env,"calvren_receptionist_calls?"+new URLSearchParams({
        client_id:"eq."+id,select:"call_id,agent_id,last_event,started_at,ended_at,updated_at",
        order:"updated_at.desc",limit:"100"
      }));
      return json({ok:true,calls:rows});
    }
    if(!action&&request.method==="PUT"){
      if(!await activeClient(env,id))return json({error:"An active live client is required"},409);
      const raw=await safeRaw(request);if(raw===null)return json({error:"Invalid payload"},400);
      let input:Row;try{input=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
      if(!agentId.test(input.retell_agent_id||"")||!e164.test(input.retell_phone_number||""))
        return json({error:"Provide the verified Retell agent ID and E.164 phone number"},400);
      const rows=await db(env,"calvren_receptionist_configs?on_conflict=client_id","POST",{
        client_id:id,retell_agent_id:input.retell_agent_id,retell_phone_number:input.retell_phone_number,
        enabled:false,updated_at:new Date().toISOString()
      });
      return json({ok:true,config:rows[0],activation:"disabled_until_approved"});
    }
    if(["activate","deactivate"].includes(action)&&request.method==="POST"){
      const config=await readConfig(env,{client_id:"eq."+id});
      if(!config)return json({error:"Configure a client first"},404);
      if(action==="activate"){
        if(!env("RETELL_WEBHOOK_KEY"))return json({error:"Configure the Retell webhook signing key first"},409);
        if(!await approvedPaidClient(env,id))return json({error:"Paid subscription, approved onboarding and active live client required"},409);
      }
      const rows=await db(env,"calvren_receptionist_configs?client_id=eq."+encodeURIComponent(id),"PATCH",{
        enabled:action==="activate",updated_at:new Date().toISOString()
      });
      return json({ok:true,config:rows[0]});
    }
    return json({error:"Not found"},404);
  }catch(error){
    console.error(JSON.stringify({event:"retell_receptionist_failed",type:error instanceof Error?error.name:"unknown"}));
    return json({error:"Receptionist operation unavailable; no automatic retry or activation occurred"},503);
  }
}
