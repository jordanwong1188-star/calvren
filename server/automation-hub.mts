import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {Buffer} from "node:buffer";

type Env=(name:string)=>string|undefined;
type Row=Record<string,any>;
type Plan="starter"|"growth"|"pro"|null;
type Member=Row; // Runtime membership shape is validated by the server's Stripe webhook and auth route.
interface HubDependencies {env:Env; fetch?:typeof fetch; user:{id:string;email:string};member:Member|null;plan:Plan;}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validDate=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
function credentials(env:Env){
  const base=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)||!key)throw Error("Database unavailable.");
  return {base:base.replace(/\/$/,""),key};
}
async function query(env:Env,path:string,options:{method?:string;body?:unknown;ignore?:boolean;fetcher?:typeof fetch}={}):Promise<Row[]>{
  const {base,key}=credentials(env);
  const response=await (options.fetcher||fetch)(base+"/rest/v1/"+path,{method:options.method||"GET",
    headers:{"apikey":key,"Content-Type":"application/json","Prefer":"return=representation,resolution="+(options.ignore?"ignore":"merge")+"-duplicates"},
    ...(options.body===undefined?{}:{body:JSON.stringify(options.body)}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error("Database request failed.");
  const result=await response.json();
  if(!Array.isArray(result))throw Error("Invalid database response.");
  return result;
}
const qp=(table:string,fields:Record<string,string>)=>table+"?"+new URLSearchParams(fields);
const active=(member:Member)=>["active","trialing"].includes(member.subscription_status)&&
  (!member.current_period_end||new Date(member.current_period_end).getTime()>Date.now());
function memberPlan(env:Env,member:Member):Plan{
  if(!active(member))return null;
  const key=env("STRIPE_SECRET_KEY")||"";
  const live=/^(sk|rk)_live_/.test(key);
  if(member.stripe_price_id===env("STRIPE_PRICE_ID"))return "starter";
  if(member.stripe_price_id===(live?"price_1Ua3rFQ9mewkKyl5dIhzjarI":env("STRIPE_GROWTH_PRICE_ID")))return "growth";
  if(member.stripe_price_id===(live?"price_1Ua3rNQ9mewkKyl5TrGGeeQU":env("STRIPE_PRO_PRICE_ID")))return "pro";
  return null;
}
async function onboarded(env:Env,userId:string,fetcher?:typeof fetch){
  const rows=await query(env,qp("calvren_onboarding",{auth_user_id:"eq."+userId,
    select:"status,scope_approved_at,launch_scope,approved_scope",limit:"1"}),{fetcher});
  const record=rows[0];
  return !!record&&record.status==="live"&&!!record.scope_approved_at&&
    !!record.launch_scope&&record.launch_scope===record.approved_scope;
}
async function clientLive(env:Env,clientId:string,fetcher?:typeof fetch){
  const rows=await query(env,qp("calvren_clients",{id:"eq."+clientId,select:"config",limit:"1"}),{fetcher});
  return rows[0]?.config?.mode==="live"&&rows[0]?.config?.active===true;
}
function validateReviewUrl(raw:unknown):string{
  if(raw==="")return "";
  if(typeof raw!=="string"||raw.length>500)throw Error("Provide a Google Business review link.");
  const u=new URL(raw);
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||!["g.page","google.com","www.google.com","search.google.com","maps.google.com"].includes(u.hostname))
    throw Error("Use an HTTPS Google Business review link.");
  return u.toString();
}
async function settings(env:Env,clientId:string,fetcher?:typeof fetch){
  const r=await query(env,qp("calvren_hub_settings",{client_id:"eq."+clientId,
    select:"client_id,review_url,review_enabled,report_enabled,pro_alert_enabled,integration_enabled,updated_at",limit:"1"}),{fetcher});
  return r[0]||{client_id:clientId,review_url:"",review_enabled:false,report_enabled:false,pro_alert_enabled:false,integration_enabled:false};
}
function approvedWebhookUrl(env:Env,value:unknown){
  if(typeof value!=="string"||value.length>500)throw Error("Provide a valid approved integration URL.");
  const u=new URL(value);
  const permitted=(env("CALVREN_INTEGRATION_ALLOWED_HOSTS")||"").split(",")
    .map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(u.protocol!=="https:"||!!u.username||!!u.password||!!u.port||
    !/^[a-z0-9.-]+$/.test(u.hostname)||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||
    u.hostname==="localhost"||u.hostname.endsWith(".local")||!permitted.includes(u.hostname))
    throw Error("Only owner-allowlisted HTTPS integration hosts may be used.");
  return u.toString();
}
export async function configureProIntegration(request:Request,env:Env,fetcher?:typeof fetch):Promise<Response>{
  try{
    const expected=env("CALVREN_ADMIN_TOKEN")||"";
    const provided=request.headers.get("Authorization")?.replace(/^Bearer /,"")||"";
    const signature=(value:string)=>createHash("sha256").update(value).digest();
    if(expected.length<24||!provided||!timingSafeEqual(signature(expected),signature(provided)))
      return json({error:"Owner authentication required."},401);
    if(request.method!=="POST")return json({error:"Use POST."},405);
    const raw=await request.text();if(raw.length>1000)return json({error:"Invalid integration settings."},413);
    const body=JSON.parse(raw) as Row;
    if(!safeId.test(body?.client_id||"")||typeof body?.enabled!=="boolean")
      return json({error:"Choose a valid client and enabled state."},400);
    const members=await query(env,qp("calvren_billing_memberships",{client_id:"eq."+body.client_id,
      select:"auth_user_id,client_id,stripe_price_id,subscription_status,current_period_end",limit:"1"}),{fetcher});
    const member=members[0];
    if(!member||memberPlan(env,member)!=="pro"||
      !await onboarded(env,member.auth_user_id,fetcher)||
      !await clientLive(env,member.client_id,fetcher))
      return json({error:"A paid, approved, live Pro client is required."},403);
    const url=body.enabled?approvedWebhookUrl(env,body.url):"";
    if(body.enabled&&!(env("CALVREN_INTEGRATION_SECRET")||"").trim())
      return json({error:"Configure the server-side integration signing secret first."},409);
    await query(env,"calvren_hub_settings?on_conflict=client_id",{method:"POST",fetcher,
      body:{client_id:body.client_id,integration_url:url,integration_enabled:body.enabled,updated_at:new Date().toISOString()}});
    return json({configured:true,enabled:body.enabled,host:body.enabled?new URL(url).hostname:null});
  }catch(error){return json({error:safeError(error)},400);}
}
const safeError=(error:unknown)=>{const s=error instanceof Error?error.message:"Unable to complete request.";return /^(Provide|Use |Review |This |Only |Your |A completed|The appointment|An active|Please |Confirm |Cannot |Review requests|Monthly reports)/.test(s)?s:"The automation hub is temporarily unavailable.";};
const approved=(plan:Plan)=>plan==="growth"||plan==="pro";
/**
 * Database Vault holds the HMAC secret. Cron only sends a short-lived signature,
 * so the raw secret never leaves PostgreSQL or appears in a job definition.
 * The RPC is executable only by service_role, not anon/authenticated users.
 */
export async function verifyNativeCron(request:Request,env:Env,route:"follow-ups"|"hub-scheduler",fetcher?:typeof fetch):Promise<boolean>{
  const stamp=request.headers.get("X-Calvren-Timestamp")||"";
  const signature=request.headers.get("X-Calvren-Signature")||"";
  if(!/^\d{10}$/.test(stamp)||! /^[a-f0-9]{64}$/.test(signature))return false;
  if(Math.abs(Date.now()/1000-Number(stamp))>90)return false;
  try{
    const {base,key}=credentials(env);
    const response=await (fetcher||fetch)(base+"/rest/v1/rpc/calvren_verify_dispatch_signature",{
      method:"POST",headers:{"apikey":key,"Content-Type":"application/json"},
      body:JSON.stringify({p_route:route,p_timestamp:stamp,p_sig:signature}),
      signal:AbortSignal.timeout(7000)});
    return response.ok&&(await response.json())===true;
  }catch{return false;}
}

export async function handleAutomationHub(request:Request,deps:HubDependencies):Promise<Response>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  try{
    if(!approved(deps.plan)||!deps.member||!active(deps.member))return json({error:"Growth or Pro is required."},403);
    const clientId=deps.member.client_id;
    if(!clientId||!safeId.test(clientId))return json({status:"setup_pending",message:"Calvren must link and approve your live business before these modules can run."});
    const live=await onboarded(deps.env,deps.user.id,deps.fetch)&&await clientLive(deps.env,clientId,deps.fetch);
    if(path==="/api/billing/hub/settings"&&method==="GET")
      return json({status:live?"live":"setup_pending",plan:deps.plan,settings:await settings(deps.env,clientId,deps.fetch)});
    if(path==="/api/billing/hub/settings"&&method==="PUT"){
      const body=await request.text();
      if(body.length>1500)return json({error:"Settings are too large."},413);
      const value=JSON.parse(body) as Row;
      if(!value||Array.isArray(value)||typeof value!=="object"||
        ["review_enabled","report_enabled","pro_alert_enabled"].some(k=>typeof value[k]!=="boolean"))
        return json({error:"Provide valid module switches."},400);
      const review=validateReviewUrl(value.review_url??"");
      if(value.review_enabled&&!review)return json({error:"Provide a valid Google Business review link before enabling review requests."},400);
      const existing=await settings(deps.env,clientId,deps.fetch);
      const next={client_id:clientId,review_url:review,review_enabled:value.review_enabled,
        report_enabled:value.report_enabled,pro_alert_enabled:deps.plan==="pro"&&value.pro_alert_enabled,
        integration_enabled:existing.integration_enabled===true,updated_at:new Date().toISOString()};
      const rows=await query(deps.env,"calvren_hub_settings?on_conflict=client_id",
        {method:"POST",body:next,fetcher:deps.fetch});
      return json({saved:true,status:live?"live":"setup_pending",settings:rows[0]||next});
    }
    if(path==="/api/billing/hub/completions"&&method==="GET"){
      const appointments=await query(deps.env,qp("calvren_appointments",{client_id:"eq."+clientId,
        select:"id,lead_id,ends_at,data",order:"ends_at.desc",limit:"80"}),{fetcher:deps.fetch});
      const completed=await query(deps.env,qp("calvren_service_completions",{client_id:"eq."+clientId,
        select:"appointment_id,completed_at",limit:"100"}),{fetcher:deps.fetch});
      const completedIds=new Set(completed.map(row=>row.appointment_id));
      const eligible=appointments.filter(row=>row.data?.status==="booked"&&
        validDate(row.ends_at)&&Date.parse(row.ends_at)<=Date.now());
      return json({status:live?"live":"setup_pending",appointments:eligible.map(row=>({
        id:row.id,lead_id:row.lead_id,ends_at:row.ends_at,confirmed:completedIds.has(row.id)
      }))});
    }
    if(path==="/api/billing/hub/completions"&&method==="POST"){
      if(!live)return json({error:"Review and approve the live onboarding scope before marking a service completed."},409);
      const body=await request.text();if(body.length>512)return json({error:"Invalid completion."},413);
      const value=JSON.parse(body) as Row;
      if(!uuid.test(value?.appointment_id||"")||value?.confirmed!==true)return json({error:"Confirm a valid completed appointment."},400);
      const appointment=(await query(deps.env,qp("calvren_appointments",{id:"eq."+value.appointment_id,
        client_id:"eq."+clientId,select:"id,lead_id,ends_at,data",limit:"1"}),{fetcher:deps.fetch}))[0];
      if(!appointment||appointment.data?.status!=="booked"||!validDate(appointment.ends_at)||
        Date.parse(appointment.ends_at)>Date.now())return json({error:"The appointment must have ended and been booked."},409);
      const lead=(await query(deps.env,qp("calvren_leads",{id:"eq."+appointment.lead_id,
        client_id:"eq."+clientId,select:"data",limit:"1"}),{fetcher:deps.fetch}))[0]?.data;
      if(!lead||lead.consent_review!==true||lead.opted_out===true||!email.test(lead.email||""))
        return json({error:"Review requests require the customer's separately recorded email consent."},409);
      const saved=await query(deps.env,"calvren_service_completions?on_conflict=client_id,appointment_id",{
        method:"POST",ignore:true,fetcher:deps.fetch,
        body:{client_id:clientId,appointment_id:appointment.id,lead_id:appointment.lead_id,confirmed_by:deps.user.id}});
      return json({confirmed:true,already_recorded:saved.length===0});
    }
    if(path==="/api/billing/hub/inbox"&&method==="GET"){
      if(deps.plan!=="pro")return json({error:"The unified inbox requires Pro."},403);
      const leads=await query(deps.env,qp("calvren_leads",{client_id:"eq."+clientId,
        select:"id,data",order:"id.desc",limit:"80"}),{fetcher:deps.fetch});
      const messages=await query(deps.env,qp("calvren_messages",{client_id:"eq."+clientId,
        select:"lead_id,data",limit:"500"}),{fetcher:deps.fetch});
      const recent=new Map<string,Row>();
      for(const row of messages){
        const prev=recent.get(row.lead_id),cur=row.data||{};
        if(!prev||String(prev.timestamp||"")<String(cur.timestamp||""))recent.set(row.lead_id,cur);
      }
      return json({status:live?"live":"setup_pending",threads:leads.map(row=>({
        id:row.id,name:String(row.data?.name||"Customer").slice(0,120),
        channel:row.data?.channel||"website",status:row.data?.status||"new",
        last_message:recent.get(row.id)?.message?.slice(0,160)||"",
        last_activity:recent.get(row.id)?.timestamp||row.data?.updated_at||null,
        needs_human:row.data?.status==="needs_human"
      }))});
    }
    const match=/^\/api\/billing\/hub\/inbox\/([0-9a-f-]{36})(?:\/(notes|reply))?$/.exec(path);
    if(match){
      if(deps.plan!=="pro")return json({error:"The unified inbox requires Pro."},403);
      if(!uuid.test(match[1]))return json({error:"Invalid conversation."},400);
      const leadId=match[1],notesPath=path.endsWith("/notes"),replyPath=path.endsWith("/reply");
      const lead=(await query(deps.env,qp("calvren_leads",{id:"eq."+leadId,
        client_id:"eq."+clientId,select:"id,data",limit:"1"}),{fetcher:deps.fetch}))[0];
      if(!lead)return json({error:"Conversation not found."},404);
      if(method==="POST"&&replyPath){
        if(!live||deps.env("CALVREN_AUTOMATION_MODE")!=="live")
          return json({error:"Live client automation and approved onboarding are required to send messages."},409);
        const leadData=lead.data||{};
        if(leadData.channel!=="sms"||leadData.consent_sms!==true||leadData.opted_out===true||
          !/^\+[1-9]\d{7,14}$/.test(leadData.phone||""))
          return json({error:"This lead has not consented to live SMS replies."},409);
        const raw=await request.text();if(raw.length>1300)return json({error:"Reply is too long."},413);
        const value=JSON.parse(raw) as Row;
        const message=typeof value?.message==="string"?value.message.trim():"";
        if(!message||message.length>800||!uuid.test(value?.nonce||"")||value?.confirmed!==true)
          return json({error:"Confirm an SMS reply with a unique request ID (800 characters maximum)."},400);
        const recent=await query(deps.env,qp("calvren_hub_deliveries",{
          client_id:"eq."+clientId,kind:"eq.pro_reply",ref_key:"like."+leadId+"-*",
          created_at:"gte."+new Date(Date.now()-3600000).toISOString(),select:"id",limit:"6"}),{fetcher:deps.fetch});
        if(recent.length>=5)return json({error:"A maximum of five SMS replies per lead per hour is allowed."},429);
        const key=leadId+"-"+value.nonce;
        const delivery=await claim(deps.env,clientId,"pro_reply",key,deps.fetch);
        if(!delivery)return json({error:"This reply has already been submitted; refresh the conversation."},409);
        const outboundId=crypto.randomUUID(),now=new Date().toISOString();
        const record={
          id:outboundId,client_id:clientId,lead_id:leadId,sender:"human",channel:"sms",
          message,timestamp:now,ai:false,status:"pending",provider_id:null,idempotency_key:"pro-reply-"+value.nonce
        };
        await query(deps.env,"calvren_messages",{method:"POST",body:{id:outboundId,
          client_id:clientId,lead_id:leadId,data:record},fetcher:deps.fetch});
        try{
          const client=(await query(deps.env,qp("calvren_clients",{id:"eq."+clientId,
            select:"config",limit:"1"}),{fetcher:deps.fetch}))[0]?.config;
          const account=deps.env("TWILIO_ACCOUNT_SID")||"",pass=deps.env("TWILIO_AUTH_TOKEN")||"",
            from=client?.phone_number||deps.env("TWILIO_PHONE_NUMBER")||"";
          if(!/^AC[0-9a-f]{32}$/i.test(account)||!pass||!/^\+[1-9]\d{7,14}$/.test(from))
            throw Error("Provider not configured.");
          const origin=new URL(deps.env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev").origin;
          const send=await (deps.fetch||fetch)("https://api.twilio.com/2010-04-01/Accounts/"+account+"/Messages.json",{
            method:"POST",headers:{Authorization:"Basic "+Buffer.from(account+":"+pass).toString("base64"),
              "Content-Type":"application/x-www-form-urlencoded"},
            body:new URLSearchParams({To:leadData.phone,From:from,Body:message,
              StatusCallback:origin+"/api/conversion/twilio/status?message_id="+outboundId}).toString(),
            signal:AbortSignal.timeout(8000)});
          const result=await send.json().catch(()=>({}));
          if(!send.ok||!/^SM[0-9a-f]{32}$/i.test(result.sid||""))
            throw Error("Delivery could not be confirmed.");
          record.status="sent";record.provider_id=result.sid;
          await query(deps.env,qp("calvren_messages",{id:"eq."+outboundId,
            client_id:"eq."+clientId}),{method:"PATCH",body:{data:record},fetcher:deps.fetch});
          await closeDelivery(deps.env,delivery.id,"sent",result.sid,"",deps.fetch);
          return json({sent:true,status:"accepted",message_id:outboundId});
        }catch{
          record.status="unknown";
          await query(deps.env,qp("calvren_messages",{id:"eq."+outboundId,
            client_id:"eq."+clientId}),{method:"PATCH",body:{data:record},fetcher:deps.fetch}).catch(()=>{});
          await closeDelivery(deps.env,delivery.id,"unknown","","provider_unconfirmed",deps.fetch).catch(()=>{});
          return json({error:"Delivery is unconfirmed. Check Twilio before retrying; Calvren will not automatically resend."},503);
        }
      }
      if(method==="POST"&&notesPath){
        if(!live)return json({error:"Finish the approved onboarding before writing notes."},409);
        const raw=await request.text();if(raw.length>2500)return json({error:"Note is too long."},413);
        const value=JSON.parse(raw) as Row,body=typeof value?.body==="string"?value.body.trim():"";
        if(!body||body.length>2000)return json({error:"Provide a note between 1 and 2000 characters."},400);
        const rows=await query(deps.env,"calvren_hub_notes",{
          method:"POST",body:{client_id:clientId,lead_id:leadId,body,author_user_id:deps.user.id},fetcher:deps.fetch});
        return json({note:rows[0]||null});
      }
      if(method!=="GET"||notesPath||replyPath)return json({error:"Use the expected method."},405);
      const [messages,notes,appointments]=await Promise.all([
        query(deps.env,qp("calvren_messages",{client_id:"eq."+clientId,lead_id:"eq."+leadId,
          select:"data",limit:"250"}),{fetcher:deps.fetch}),
        query(deps.env,qp("calvren_hub_notes",{client_id:"eq."+clientId,lead_id:"eq."+leadId,
          select:"id,body,created_at",order:"created_at.asc",limit:"100"}),{fetcher:deps.fetch}),
        query(deps.env,qp("calvren_appointments",{client_id:"eq."+clientId,lead_id:"eq."+leadId,
          select:"id,starts_at,ends_at,data",limit:"20"}),{fetcher:deps.fetch})
      ]);
      return json({status:live?"live":"setup_pending",lead:{
        id:lead.id,name:lead.data?.name||"Customer",email:lead.data?.email||"",
        phone:lead.data?.phone||"",status:lead.data?.status||"new",
        opted_out:lead.data?.opted_out===true,channel:lead.data?.channel||"website"},
        messages:messages.map(x=>({sender:x.data?.sender,channel:x.data?.channel,
          message:String(x.data?.message||"").slice(0,4000),status:x.data?.status,timestamp:x.data?.timestamp})),
        appointments:appointments.map(a=>({id:a.id,starts_at:a.starts_at,ends_at:a.ends_at,status:a.data?.status})),
        notes});
    }
    return json({error:"Endpoint not found."},404);
  }catch(error){console.error(JSON.stringify({event:"calvren_hub_error",path,method}));
    const message=safeError(error);
    return json({error:message},message.includes("temporarily")?503:400);}
}

// Report counts are intentionally aggregations without any customer PII.
async function monthlySummary(env:Env,clientId:string,month:string,fetcher?:typeof fetch){
  const start=Date.parse(month+"-01T00:00:00Z");
  const [year,mo]=month.split("-").map(Number);
  const next=Date.UTC(year,mo,1);
  const [leads,appointments]=await Promise.all([
    query(env,qp("calvren_leads",{client_id:"eq."+clientId,select:"data",limit:"1000"}),{fetcher}),
    query(env,qp("calvren_appointments",{client_id:"eq."+clientId,select:"starts_at,data",limit:"1000"}),{fetcher})
  ]);
  const belongs=(v:unknown)=>validDate(v)&&Date.parse(v as string)>=start&&Date.parse(v as string)<next;
  const matching=leads.filter(row=>belongs(row.data?.created_at));
  return {month,leads:matching.length,
    qualified:matching.filter(row=>["qualified","booking","booked","won"].includes(row.data?.status)).length,
    bookings:appointments.filter(row=>belongs(row.starts_at)&&row.data?.status==="booked").length,
    partial:leads.length>=1000||appointments.length>=1000};
}
async function sendWebhook(env:Env,url:string,payload:Record<string,string>,key:string,fetcher?:typeof fetch){
  const destination=approvedWebhookUrl(env,url),secret=env("CALVREN_INTEGRATION_SECRET")||"";
  if(secret.length<32)return {ok:false,id:"",reason:"integration_secret_missing"};
  const body=JSON.stringify(payload),ts=Math.floor(Date.now()/1000).toString();
  const signature=createHmac("sha256",secret).update(ts+"."+body).digest("hex");
  const response=await (fetcher||fetch)(destination,{method:"POST",headers:{
    "Content-Type":"application/json","X-Calvren-Timestamp":ts,
    "X-Calvren-Signature":"sha256="+signature,"X-Calvren-Idempotency-Key":key
  },body,signal:AbortSignal.timeout(9000),redirect:"error"});
  return {ok:response.ok,id:"",reason:response.ok?"":"webhook_unconfirmed"};
}
async function sendMail(env:Env,to:string,subject:string,body:string,key:string,fetcher?:typeof fetch){
  const apiKey=env("RESEND_API_KEY"),from=env("NOTIFICATION_FROM_EMAIL");
  if(!apiKey||!from||!email.test(to))return {ok:false,id:"",reason:"mail_unconfigured"};
  const response=await (fetcher||fetch)("https://api.resend.com/emails",{method:"POST",
    headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json","Idempotency-Key":key.slice(0,256)},
    body:JSON.stringify({from,to:[to],subject,text:body,reply_to:"calvrenautomation@gmail.com"}),
    signal:AbortSignal.timeout(12000)});
  if(!response.ok)return {ok:false,id:"",reason:"mail_rejected"};
  const data=await response.json().catch(()=>({}));
  return {ok:typeof data.id==="string",id:String(data.id||""),reason:""};
}
async function claim(env:Env,clientId:string,kind:string,ref:string,fetcher?:typeof fetch){
  const rows=await query(env,"calvren_hub_deliveries?on_conflict=client_id,kind,ref_key",
    {method:"POST",ignore:true,fetcher,body:{client_id:clientId,kind,ref_key:ref,status:"pending"}});
  return rows[0]||null;
}
async function closeDelivery(env:Env,id:string,status:string,provider:string,error:string,fetcher?:typeof fetch){
  await query(env,qp("calvren_hub_deliveries",{id:"eq."+id}),{method:"PATCH",fetcher,
    body:{status,provider_id:provider.slice(0,180),last_error:error.slice(0,180),completed_at:new Date().toISOString()}});
}
async function confirmedEmail(env:Env,userId:string,fetcher?:typeof fetch){
  const {base,key}=credentials(env);
  const response=await (fetcher||fetch)(base+"/auth/v1/admin/users/"+userId,{
    headers:{"apikey":key,"Authorization":"Bearer "+key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;
  const value=await response.json();
  return value.id===userId&&value.email_confirmed_at&&email.test(value.email)?value.email as string:null;
}
const secret=(env:Env)=>env("CALVREN_REVIEW_UNSUB_SECRET")||env("STRIPE_WEBHOOK_SECRET")||"";
function token(env:Env,clientId:string,hash:string,exp:number){
  const value=clientId+"."+hash+"."+exp;
  const signature=createHmac("sha256",secret(env)).update("calvren-review-unsubscribe-v1:"+value).digest("hex");
  return value+"."+signature;
}
export async function unsubscribeReview(request:Request,env:Env,fetcher?:typeof fetch):Promise<Response>{
  try{
    if(request.method!=="POST")return json({error:"Use POST."},405);
    const body=await request.text();if(body.length>900)return json({error:"Invalid opt-out request."},413);
    const value=JSON.parse(body) as Row;
    const parts=typeof value?.token==="string"?value.token.split("."):[];
    if(parts.length!==4||!safeId.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1])||
      !/^\d{10,13}$/.test(parts[2])||!/^[a-f0-9]{64}$/.test(parts[3])||
      +parts[2]<Date.now()||+parts[2]>Date.now()+40*86400000||secret(env).length<32)return json({error:"Invalid or expired opt-out link."},400);
    const signed=token(env,parts[0],parts[1],+parts[2]).split(".")[3];
    if(!timingSafeEqual(Buffer.from(signed),Buffer.from(parts[3])))return json({error:"Invalid opt-out link."},400);
    await query(env,"calvren_review_optouts?on_conflict=client_id,email_sha256",{
      method:"POST",fetcher,body:{client_id:parts[0],email_sha256:parts[1]}});
    return json({ok:true,message:"You will not receive more Calvren review-request emails for this business."});
  }catch{return json({error:"Unable to save opt-out request."},503);}
}
export async function entitledGrowthClients(env:Env,fetcher?:typeof fetch):Promise<Set<string>>{
  const allowed=new Set<string>();
  const members=await query(env,qp("calvren_billing_memberships",{
    select:"auth_user_id,client_id,stripe_price_id,subscription_status,current_period_end",
    subscription_status:"in.(active,trialing)",client_id:"not.is.null",limit:"500"}),{fetcher});
  for(const m of members){
    if(!approved(memberPlan(env,m))||!safeId.test(m.client_id||""))continue;
    if(await onboarded(env,m.auth_user_id,fetcher)&&await clientLive(env,m.client_id,fetcher))
      allowed.add(m.client_id);
  }
  return allowed;
}
// Cron is called only by a server-verified secret (see server/router.mts). It never reads
// customer identifiers from request parameters and never sends without paid, live approval.
export async function processAutomationCron(env:Env,fetcher?:typeof fetch):Promise<{review:number;reports:number;alerts:number;skipped:number;failed:number}>{
  const totals={review:0,reports:0,alerts:0,skipped:0,failed:0};
  const members=await query(env,qp("calvren_billing_memberships",{
    select:"auth_user_id,client_id,stripe_price_id,subscription_status,current_period_end",
    subscription_status:"in.(active,trialing)",client_id:"not.is.null",limit:"100"}),{fetcher});
  const now=new Date();
  const lastMonth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
  let outboundCount=0;
  for(const m of members){
    if(outboundCount>=20)break;
    const plan=memberPlan(env,m);
    if(!approved(plan)||!m.client_id||!safeId.test(m.client_id)||
      !await onboarded(env,m.auth_user_id,fetcher)||
      !await clientLive(env,m.client_id,fetcher)){totals.skipped++;continue;}
    const cfg=await settings(env,m.client_id,fetcher);
    if(cfg.report_enabled&&now.getUTCDate()<=7&&outboundCount<20){
      const recipient=await confirmedEmail(env,m.auth_user_id,fetcher);
      if(recipient){
        const stats=await monthlySummary(env,m.client_id,lastMonth,fetcher);
        if(!stats.partial){
          const delivery=await claim(env,m.client_id,"monthly_report",lastMonth,fetcher);
          if(delivery){
            outboundCount++;
            try{
              const msg="Your Calvren activity summary for "+lastMonth+
                "\n\nNew leads: "+stats.leads+"\nQualified leads: "+stats.qualified+
                "\nBooked appointments: "+stats.bookings+
                "\n\nSee your secure dashboard: https://calvren.pages.dev/client.html"+
                "\n\nThis is a subscription service report. Contact Calvren if the totals need review.";
              const sent=await sendMail(env,recipient,"Calvren monthly performance — "+lastMonth,msg,
                "calvren-monthly-"+m.client_id+"-"+lastMonth,fetcher);
              await closeDelivery(env,delivery.id,sent.ok?"sent":"failed",sent.id,sent.reason,fetcher);
              sent.ok?totals.reports++:totals.failed++;
            }catch{await closeDelivery(env,delivery.id,"unknown","","delivery_unconfirmed",fetcher);totals.failed++;}
          }
        }else totals.skipped++;
      }
    }
    if(cfg.review_enabled&&cfg.review_url&&secret(env).length>=32&&outboundCount<20){
      let validUrl=false;try{validUrl=validateReviewUrl(cfg.review_url)===cfg.review_url;}catch{}
      if(validUrl){
        const completions=await query(env,qp("calvren_service_completions",{client_id:"eq."+m.client_id,
          select:"appointment_id,lead_id,completed_at",order:"completed_at.desc",limit:"80"}),{fetcher});
        for(const completion of completions){
          if(outboundCount>=20)break;
          const finished=Date.parse(completion.completed_at||"");
          if(!Number.isFinite(finished)||finished>Date.now()-24*3600*1000||finished<Date.now()-40*86400000)continue;
          const lead=(await query(env,qp("calvren_leads",{client_id:"eq."+m.client_id,
            id:"eq."+completion.lead_id,select:"data",limit:"1"}),{fetcher}))[0]?.data;
          if(!lead||lead.consent_review!==true||lead.opted_out===true||!email.test(lead.email||""))continue;
          const hash=createHash("sha256").update(lead.email.trim().toLowerCase()).digest("hex");
          const optouts=await query(env,qp("calvren_review_optouts",{client_id:"eq."+m.client_id,
            email_sha256:"eq."+hash,select:"email_sha256",limit:"1"}),{fetcher});
          if(optouts.length)continue;
          const delivery=await claim(env,m.client_id,"review",completion.appointment_id,fetcher);
          if(!delivery)continue;
          outboundCount++;
          try{
            const link=token(env,m.client_id,hash,Date.now()+30*86400000);
            const note="Thank you for choosing our business. If you would like to share an honest review of your experience, you can do so here:\n"+
              cfg.review_url+"\n\nNo review is required, and positive and negative feedback are equally welcome."+
              "\n\nTo stop future review requests: https://calvren.pages.dev/unsubscribe-review.html?token="+encodeURIComponent(link);
            const sent=await sendMail(env,lead.email,"A quick request for your feedback",note,
              "calvren-review-"+m.client_id+"-"+completion.appointment_id,fetcher);
            await closeDelivery(env,delivery.id,sent.ok?"sent":"failed",sent.id,sent.reason,fetcher);
            sent.ok?totals.review++:totals.failed++;
          }catch{await closeDelivery(env,delivery.id,"unknown","","delivery_unconfirmed",fetcher);totals.failed++;}
        }
      }
    }
    if(plan==="pro"&&cfg.integration_enabled&&outboundCount<20){
      const receiver=(await query(env,qp("calvren_hub_settings",{client_id:"eq."+m.client_id,
        select:"integration_url,integration_enabled",limit:"1"}),{fetcher}))[0];
      if(receiver?.integration_url){
        let ok=false;try{ok=!!approvedWebhookUrl(env,receiver.integration_url);}catch{}
        if(ok&&(env("CALVREN_INTEGRATION_SECRET")||"").length>=32){
          const leads=await query(env,qp("calvren_leads",{client_id:"eq."+m.client_id,
            select:"id,data",limit:"100"}),{fetcher});
          for(const row of leads){
            if(outboundCount>=20)break;
            const status=row.data?.status;
            if(!["booked","needs_human"].includes(status)||!validDate(row.data?.updated_at)||
              Date.parse(row.data.updated_at)<Date.now()-14*86400000)continue;
            const ref=row.id+"-"+status;
            const delivery=await claim(env,m.client_id,"pro_webhook",ref,fetcher);
            if(!delivery)continue;
            outboundCount++;
            try{
              const sent=await sendWebhook(env,receiver.integration_url,{
                event:status==="booked"?"appointment.booked":"lead.handoff_required",
                client_id:m.client_id,lead_id:row.id,status,occurred_at:row.data.updated_at,
                subscription:"pro"
              },"calvren-"+m.client_id+"-"+ref,fetcher);
              await closeDelivery(env,delivery.id,sent.ok?"sent":"unknown","",sent.reason,fetcher);
              sent.ok?totals.alerts++:totals.failed++;
            }catch{
              await closeDelivery(env,delivery.id,"unknown","","webhook_unconfirmed",fetcher);
              totals.failed++;
            }
          }
        }
      }
    }
    if(plan==="pro"&&cfg.pro_alert_enabled&&outboundCount<20){
      const clients=await query(env,qp("calvren_clients",{id:"eq."+m.client_id,
        select:"config",limit:"1"}),{fetcher});
      const destination=clients[0]?.config?.notification_email;
      if(email.test(destination||"")){
        const leads=await query(env,qp("calvren_leads",{client_id:"eq."+m.client_id,
          select:"id,data",limit:"100"}),{fetcher});
        for(const row of leads.filter(r=>r.data?.status==="needs_human").slice(0,20)){
          if(outboundCount>=20)break;
          const delivery=await claim(env,m.client_id,"pro_alert",row.id,fetcher);
          if(!delivery)continue;
          outboundCount++;
          try{
            const sent=await sendMail(env,destination,"Calvren: human handoff needed",
              "A lead requires your attention. Open your secure Pro inbox to review it: https://calvren.pages.dev/client.html",
              "calvren-handoff-"+m.client_id+"-"+row.id,fetcher);
            await closeDelivery(env,delivery.id,sent.ok?"sent":"failed",sent.id,sent.reason,fetcher);
            sent.ok?totals.alerts++:totals.failed++;
          }catch{await closeDelivery(env,delivery.id,"unknown","","delivery_unconfirmed",fetcher);totals.failed++;}
        }
      }
    }
  }
  return totals;
}
