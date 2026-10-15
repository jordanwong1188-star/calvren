import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { sendClientMail } from "./customer-email.mjs";

type Environment=(key:string)=>string|undefined;
type Row=Record<string,any>;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const isUuid=(s:unknown):s is string=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const stages=["draft","submitted","reviewing","needs_details","building","testing","awaiting_approval","approved","live"];
const allowedFields:Record<string,number>={
  business_name:160,industry:100,website:300,description:1400,contact_name:120,contact_email:254,
  contact_phone:40,timezone:100,services:1200,service_areas:1000,business_hours:1000,
  lead_sources:800,lead_form_url:300,ai_tone:200,qualifying_questions:1500,
  booking_duration:20,booking_buffer:20,booking_rules:1200,calendar_email:254,
  handoff_email:254,handoff_phone:40,handoff_instructions:1200,additional_notes:1500,kickoff_availability:500
};
const required=["business_name","industry","description","contact_name","contact_email","services","business_hours","lead_sources","handoff_email"];
const validEmail=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function normalizeForm(input:unknown,submit:boolean):Row{
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid onboarding form.");
  const raw=input as Row,form:Row={};
  for(const [field,max] of Object.entries(allowedFields)){
    const value=raw[field]??"";
    if(typeof value!=="string"||value.length>max)throw Error("Check the length of "+field+".");
    form[field]=value.trim();
  }
  form.consent_data_handling=raw.consent_data_handling===true;
  form.approve_workflow_scope=raw.approve_workflow_scope===true;
  form.kickoff_requested=raw.kickoff_requested===true;
  if(submit){
    for(const field of required)if(!form[field])throw Error("Complete the required field: "+field.replaceAll("_"," ")+".");
    if(!validEmail(form.contact_email)||!validEmail(form.handoff_email))throw Error("Use a valid contact and handoff email.");
    if(form.website&& !/^https:\/\/[\w.-]+(?:[\/?#][^\s]*)?$/i.test(form.website))throw Error("Business website must be a full HTTPS URL.");
    if(!form.consent_data_handling||!form.approve_workflow_scope)throw Error("Review and confirm both acknowledgements before submitting.");
    if(form.kickoff_requested&&!form.kickoff_availability)throw Error("Provide a few preferred times for your optional kickoff call.");
  }
  return form;
}
function dbConfig(env:Environment){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw Error("Onboarding database unavailable.");
  return {url:url.replace(/\/$/,""),key};
}
async function database(env:Environment,path:string,method="GET",body?:unknown){
  const {url,key}=dbConfig(env);
  const result=await fetch(url+"/rest/v1/"+path,{
    method,headers:{"apikey":key,"Content-Type":"application/json",
      "Prefer":"return=representation,resolution=merge-duplicates"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)
  });
  if(!result.ok)throw Error("Unable to read or save onboarding records.");
  return (await result.json()) as Row[];
}
async function caller(request:Request,env:Environment){
  const bearer=request.headers.get("authorization")||"";
  if(!/^Bearer [\w.\-]+$/.test(bearer))return null;
  const {url,key}=dbConfig(env);
  const response=await fetch(url+"/auth/v1/user",{
    headers:{"apikey":key,"Authorization":bearer},signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return null;
  const user=await response.json() as Row;
  return isUuid(user.id)&&typeof user.email==="string"&&user.email_confirmed_at?{id:user.id as string,email:user.email as string}:null;
}
function operator(request:Request,env:Environment){
  const expected=env("CALVREN_ADMIN_TOKEN")||"",header=request.headers.get("authorization")||"";
  const supplied=header.startsWith("Bearer ")?header.slice(7):"";
  if(expected.length<32||supplied.length<32)return false;
  const digest=(v:string)=>createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(expected),digest(supplied));
}
async function paidMember(id:string,env:Environment){
  const rows=await database(env,"calvren_billing_memberships?"+new URLSearchParams({
    auth_user_id:"eq."+id,select:"subscription_status,current_period_end,client_id",limit:"1"
  }));
  const m=rows[0];
  return m&&["active","trialing"].includes(m.subscription_status)&&
    (!m.current_period_end||Date.parse(m.current_period_end)>Date.now())?m:null;
}
async function readRecord(env:Environment,id:string){
  return (await database(env,"calvren_onboarding?"+new URLSearchParams({
    auth_user_id:"eq."+id,select:"auth_user_id,form,status,current_step,owner_note,submitted_at,updated_at,launch_scope,approved_scope,scope_approved_at,confirmation_email_sent_at,scope_review_email_sent_at",limit:"1"
  })))[0]||null;
}
async function verifiedUserEmail(env:Environment,id:string):Promise<string|null>{
  const {url,key}=dbConfig(env);
  const response=await fetch(url+"/auth/v1/admin/users/"+id,{headers:{"apikey":key,"Authorization":"Bearer "+key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;
  const user=await response.json() as Row;
  return user.id===id&&typeof user.email==="string"&&validEmail(user.email)&&user.email_confirmed_at?user.email:null;
}
async function inputJson(request:Request){
  const data=await request.text();
  if(data.length>20000)throw Error("Onboarding submission is too large.");
  try{const parsed=JSON.parse(data);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();return parsed as Row}
  catch{throw Error("Send a valid onboarding form.");}
}
function expose(row:Row|null,clientId:string|null){
  return row?{form:row.form,status:row.status,current_step:row.current_step,
    owner_note:row.owner_note,submitted_at:row.submitted_at,updated_at:row.updated_at,
    launch_scope:row.launch_scope||"",scope_approved_at:row.scope_approved_at||null,
    automation_connected:!!clientId}:null;
}
export async function handleOnboarding(request:Request,env:Environment):Promise<Response>{
  const path=new URL(request.url).pathname,admin=path.startsWith("/api/onboarding/admin");
  try{
    if(admin){
      if(!operator(request,env))return json({error:"Owner access required."},401);
      if(path==="/api/onboarding/admin"&&request.method==="GET"){
        const records=await database(env,"calvren_onboarding?select=auth_user_id,form,status,current_step,owner_note,submitted_at,updated_at,launch_scope,scope_approved_at&order=updated_at.desc&limit=100");
        return json({records});
      }
      const match=/^\/api\/onboarding\/admin\/([0-9a-f-]{36})$/.exec(path);
      if(!match||request.method!=="PATCH"||!isUuid(match[1]))return json({error:"Not found."},404);
      const id=match[1],payload=await inputJson(request);
      if(!stages.includes(payload.status)||payload.status==="draft")return json({error:"Invalid status."},400);
      const current=await readRecord(env,id);
      if(!current)return json({error:"Onboarding request not found."},404);
      const note=payload.owner_note===undefined?current.owner_note:payload.owner_note;
      const nextScope=payload.launch_scope===undefined?current.launch_scope||"":payload.launch_scope;
      if(typeof nextScope!=="string"||nextScope.length>2400)return json({error:"The proposed workflow summary is too long."},400);
      const scopeChanged=nextScope.trim()!==(current.launch_scope||"");
      if(scopeChanged&&current.status==="live")return json({error:"Contact the client to agree a new scope before changing a launched workflow."},409);
      if(payload.status==="awaiting_approval"&&!nextScope.trim())return json({error:"Write the final workflow summary before requesting client approval."},400);
      if(payload.status==="awaiting_approval"&&!["testing","awaiting_approval","approved"].includes(current.status))
        return json({error:"Finish implementation testing before requesting approval."},409);
      if(payload.status==="live"&&(!current.scope_approved_at||!current.launch_scope||current.approved_scope!==current.launch_scope||scopeChanged||current.status!=="approved"))
        return json({error:"The customer must approve the exact final workflow before you can mark it live."},409);
      if(typeof note!=="string"||note.length>1200)return json({error:"Owner note is too long."},400);
      if(payload.client_id!==undefined){
        if(!isUuid(id)||typeof payload.client_id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(payload.client_id))
          return json({error:"Provide a valid existing business ID."},400);
        const clients=await database(env,"calvren_clients?"+new URLSearchParams({id:"eq."+payload.client_id,select:"id,config",limit:"1"}));
        const client=clients[0];
        if(!client||client.config?.mode!=="live"||client.config?.active!==true)
          return json({error:"Link an existing active live business, not a demo configuration."},409);
        const membership=await paidMember(id,env);
        if(!membership)return json({error:"The customer does not have an active subscription."},409);
        await database(env,"calvren_billing_memberships?auth_user_id=eq."+id,"PATCH",{client_id:payload.client_id});
      }
      const membership=await paidMember(id,env);
      if(payload.status==="live"&&!membership?.client_id)return json({error:"Link the customer's live business before marking launched."},409);
      const updated=await database(env,"calvren_onboarding?auth_user_id=eq."+id,"PATCH",{
        status:payload.status,owner_note:note.trim(),launch_scope:nextScope.trim(),
        ...(scopeChanged?{scope_approved_at:null,approved_scope:"",scope_review_email_sent_at:null}:{}),
        updated_at:new Date().toISOString()
      });
      const record=updated[0]||null;
      if(record&&payload.status==="awaiting_approval"&&!record.scope_review_email_sent_at){
        const email=await verifiedUserEmail(env,id).catch(()=>null);
        if(email&&await sendClientMail(env,email,"scope_ready",{
          business:record.form?.business_name,id:"calvren-scope-"+id+"-"+createHash("sha256").update(record.launch_scope||"").digest("hex").slice(0,24)
        })){
          await database(env,"calvren_onboarding?auth_user_id=eq."+id,"PATCH",{scope_review_email_sent_at:new Date().toISOString()});
        }
      }
      return json({record});
    }
    if(path!=="/api/onboarding"&&path!=="/api/onboarding/approve")return json({error:"Not found."},404);
    const user=await caller(request,env);
    if(!user)return json({error:"Sign in through Calvren first."},401);
    const member=await paidMember(user.id,env);
    if(!member)return json({error:"An active, linked Stripe subscription is required. If you have paid, contact Calvren to verify your account."},403);
    if(path==="/api/onboarding/approve"){
      if(request.method!=="POST")return json({error:"Use POST."},405);
      const payload=await inputJson(request);
      const existing=await readRecord(env,user.id);
      if(!existing||existing.status!=="awaiting_approval"||!existing.launch_scope)return json({error:"No final workflow is awaiting your approval."},409);
      if(payload.approved!==true||payload.scope!==existing.launch_scope)return json({error:"Review the latest workflow summary before approving."},409);
      const stamp=new Date().toISOString();
      const rows=await database(env,"calvren_onboarding?auth_user_id=eq."+user.id+"&status=eq.awaiting_approval","PATCH",{
        status:"approved",scope_approved_at:stamp,approved_scope:existing.launch_scope,updated_at:stamp
      });
      if(!rows.length)return json({error:"This workflow changed. Reload the latest version before approval."},409);
      return json({record:expose(rows[0],member.client_id||null)});
    }
    if(request.method==="GET")return json({email:user.email,record:expose(await readRecord(env,user.id),member.client_id||null)});
    if(!["PUT","POST"].includes(request.method))return json({error:"Use GET, PUT or POST."},405);
    const payload=await inputJson(request),submit=request.method==="POST";
    const form=normalizeForm(payload.form,submit),current=await readRecord(env,user.id);
    if(current&&!["draft","needs_details"].includes(current.status))return json({error:"Your questionnaire is already submitted. Contact Calvren to request changes."},409);
    const step=Number.isInteger(payload.current_step)?Math.max(1,Math.min(4,payload.current_step)):1;
    const rows=await database(env,"calvren_onboarding?on_conflict=auth_user_id","POST",{
      auth_user_id:user.id,form,current_step:step,status:submit?"submitted":"draft",
      submitted_at:submit?new Date().toISOString():null,updated_at:new Date().toISOString(),
      owner_note:current?.owner_note||""
    });
    if(submit&&rows[0]&&!rows[0].confirmation_email_sent_at){
      if(await sendClientMail(env,user.email,"submitted",{business:form.business_name,kickoff:form.kickoff_requested,
        id:"calvren-onboarding-"+user.id})){
        await database(env,"calvren_onboarding?auth_user_id=eq."+user.id,"PATCH",{confirmation_email_sent_at:new Date().toISOString()});
      }
    }
    return json({record:expose(rows[0]||null,member.client_id||null)});
  }catch(error){
    const message=error instanceof Error?error.message:"The request failed.";
    const benign=/^(Invalid|Check|Complete|Use a valid|Business website|Review and confirm|Onboarding submission|Send a valid|Your questionnaire|Provide a few|The proposed workflow)/.test(message);
    if(!benign)console.error(JSON.stringify({event:"calvren_onboarding_error",route:admin?"admin":"client"}));
    return json({error:benign?message:"Onboarding is temporarily unavailable. Please contact Calvren."},benign?400:503);
  }
}
