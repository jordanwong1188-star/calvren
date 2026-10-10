import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OperatorRepository } from "../netlify/lib/conversion-api.mjs";
import type { Storage } from "../netlify/lib/workflow-core.mjs";
interface Dependencies { repository: OperatorRepository; storage: Storage; env(name:string):string|undefined; ip?:string; fetch?:typeof fetch; }
interface Signup { id:string; email:string; email_verified:false; created_at:string; updated_at:string; promotional_consent:boolean; consent_at:string|null; promo_state:"not_requested"|"sending"|"sent"|"failed"|"unavailable"|"unsubscribed"; unsubscribe_hash:string|null; unsubscribed_at:string|null; }
class AccessError extends Error {constructor(public status:number,message:string){super(message);}}
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const entities:Record<string,string>={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>entities[c]);
function identifier(email:string){const chars=hash("calvren-demo:"+email).slice(0,32).split("");chars[12]="4";chars[16]=(8|(parseInt(chars[16],16)&3)).toString(16);const h=chars.join("");return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");}
async function readInput(request:Request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))throw new AccessError(415,"Use the demo signup form.");
  const reader=request.body?.getReader();if(!reader)throw new AccessError(400,"Enter an email.");
  const parts:Uint8Array[]=[];let length=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>2048){await reader.cancel();throw new AccessError(413,"The signup is too large.");}parts.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new AccessError(400,"Check the signup details.");}
}
function siteOrigin(env:Dependencies["env"]){const url=new URL(env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev");if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw Error("Invalid site origin.");return url.origin;}
async function sendPromotion(record:Signup,token:string,deps:Dependencies):Promise<Signup["promo_state"]>{
  const key=deps.env("RESEND_API_KEY"),from=deps.env("NOTIFICATION_FROM_EMAIL"),address=deps.env("CALVREN_BUSINESS_ADDRESS")?.trim();
  if(!key||!from||!address||address.length>500)return "unavailable";
  try{
    const origin=siteOrigin(deps.env),unsubscribe=origin+"/api/demo-access/unsubscribe?id="+record.id+"&token="+token;
    const heading="Your next lead deserves a clear next step.";
    const text=heading+"\n\nThanks for trying Calvren. We build lead-response and appointment-booking automation around your business: your services, qualifying questions, follow-up timing and human handoff rules.\n\nSee a fake enquiry move through the demo: "+origin+"/try-demo.html\n\nWant to explore a setup for your team? Talk to Jordan: "+origin+"/contact.html\n\nJordan Wong | Calvren\nJordan.wong1177@gmail.com | 236-988-8283\n"+address+"\n\nYou requested this one-time promotional introduction on Calvren. This does not subscribe you to a recurring campaign. Unsubscribe: "+unsubscribe;
    const html='<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#183b31;background:#f6f5ee;padding:32px"><p style="font-size:24px;font-weight:bold">calvren.</p><h1>'+heading+'</h1><p>Thanks for trying Calvren. Give your next lead a response, collect the details your team needs and guide suitable enquiries toward an appointment.</p><p>Your services. Your questions. Your follow-up and booking rules. A person takes over when needed.</p><p><a style="display:inline-block;background:#183b31;color:#f6f5ee;padding:14px 20px;text-decoration:none" href="'+origin+'/contact.html">Discuss your business →</a></p><p><a href="'+origin+'/try-demo.html">Return to the simulated demo</a></p><p>Jordan Wong · Calvren<br>Jordan.wong1177@gmail.com · 236-988-8283</p><p style="font-size:12px">'+escape(address)+'</p><p style="font-size:12px">You requested this one-time promotional introduction. No recurring campaign subscription. <a href="'+escape(unsubscribe)+'">Unsubscribe</a>.</p></div>';
    const response=await (deps.fetch??fetch)("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":"calvren-demo-promo-"+record.id},body:JSON.stringify({from,to:[record.email],reply_to:"Jordan.wong1177@gmail.com",subject:heading,text,html,headers:{"List-Unsubscribe":"<"+unsubscribe+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}}),signal:AbortSignal.timeout(8000),redirect:"error"});
    // Accepted by the provider does not mean delivered to the inbox.
    return response.ok?"sent":"failed";
  }catch{return "failed";}
}
export async function handleDemoSignup(request:Request,deps:Dependencies):Promise<Response>{
  try{
    if(request.method!=="POST")return json({error:"Use POST."},405);
    const input=await readInput(request);
    if(!input||typeof input!=="object"||Array.isArray(input)||typeof input.email!=="string"||typeof input.promotional_consent!=="boolean")throw new AccessError(400,"Enter an email and your promotional email choice.");
    if(input.website!==undefined&&input.website!=="")throw new AccessError(400,"The signup could not be accepted.");
    const email=input.email.trim().toLowerCase();
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\u0000-\u001f\u007f]/.test(email))throw new AccessError(400,"Enter a valid email.");
    const stamp=new Date().toISOString();
    for(const [scope,maximum,window] of [["global",30,3600],["ip:"+deps.ip,10,3600],["email:"+email,3,86400]] as const){
      if(!await deps.repository.consumeRateLimit(hash("demo-signup:"+scope),maximum,window,stamp))throw new AccessError(429,"Too many attempts. Please try again later.");
    }
    const id=identifier(email),key="demo-signups/"+id;
    const initial:Signup={id,email,email_verified:false,created_at:stamp,updated_at:stamp,promotional_consent:false,consent_at:null,promo_state:"not_requested",unsubscribe_hash:null,unsubscribed_at:null};
    await deps.storage.setJSON(key,initial,{onlyIfNew:true});
    let entry=await deps.storage.getWithMetadata(key,{type:"json"});
    if(!entry)throw Error("Signup unavailable.");
    const record=entry.data as Signup;
    // Reserve at most one promotional request with a compare-and-swap before calling the provider.
    // Repeated requests never resend, and an unsubscribed address cannot be re-enrolled here.
    const emailConfigured=!!(deps.env("RESEND_API_KEY")&&deps.env("NOTIFICATION_FROM_EMAIL")&&deps.env("CALVREN_BUSINESS_ADDRESS")?.trim());
    if(input.promotional_consent&&(record.promo_state==="not_requested"||(record.promo_state==="unavailable"&&emailConfigured))&&!record.unsubscribed_at){
      const token=randomBytes(32).toString("base64url");
      const reserved:Signup={...record,promotional_consent:true,consent_at:stamp,updated_at:stamp,promo_state:"sending",unsubscribe_hash:hash(token)};
      const write=await deps.storage.setJSON(key,reserved,{onlyIfMatch:entry.etag});
      if(write.modified&&write.etag){
        const outcome=await sendPromotion(reserved,token,deps);
        // A concurrent unsubscribe wins; provider failure never blocks access to the simulation.
        await deps.storage.setJSON(key,{...reserved,promo_state:outcome,updated_at:new Date().toISOString()},{onlyIfMatch:write.etag});
      }
      entry=await deps.storage.getWithMetadata(key,{type:"json"});
    }
    return json({ok:true,id,demo_url:"/lead-demo.html",promotion:(entry?.data as Signup)?.promo_state||"not_requested"},201);
  }catch(error){return json({error:error instanceof AccessError?error.message:"We couldn’t save your email. Please try again or contact Jordan."},error instanceof AccessError?error.status:503);}
}
const htmlPage=(body:string,status=200)=>new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calvren — Email preferences</title><link rel="stylesheet" href="/styles.css"></head><body><main class="document"><a class="brand" href="/">calvren.</a>'+body+'</main></body></html>',{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
export async function handleDemoUnsubscribe(request:Request,deps:Dependencies):Promise<Response>{
  try{
    if(!["GET","POST"].includes(request.method))return htmlPage("<h1>Use the unsubscribe link in your email.</h1>",405);
    const url=new URL(request.url),id=url.searchParams.get("id")||"",token=url.searchParams.get("token")||"";
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))return htmlPage("<h1>This link could not be verified.</h1>",400);
    const key="demo-signups/"+id;
    for(let attempt=0;attempt<2;attempt++){
      const entry=await deps.storage.getWithMetadata(key,{type:"json"}),record=entry?.data as Signup|undefined;
      if(!entry||!record?.unsubscribe_hash||!timingSafeEqual(createHash("sha256").update(record.unsubscribe_hash).digest(),createHash("sha256").update(hash(token)).digest()))return htmlPage("<h1>This link could not be verified.</h1>",400);
      if(request.method==="GET")return htmlPage('<h1>Email preferences</h1><p>Confirm below to stop promotional emails from this demo signup.</p><form method="POST" action="'+escape(url.pathname+url.search)+'"><button class="button" type="submit">Unsubscribe</button></form>');
      const stamp=new Date().toISOString();
      if(record.unsubscribed_at|| (await deps.storage.setJSON(key,{...record,promotional_consent:false,promo_state:"unsubscribed",unsubscribed_at:stamp,updated_at:stamp},{onlyIfMatch:entry.etag})).modified)return htmlPage("<h1>You’re unsubscribed.</h1><p>You can still use the Calvren demo.</p>");
    }
    return htmlPage("<h1>Please try the link again.</h1>",409);
  }catch{return htmlPage("<h1>Please try again later.</h1>",503);}
}
