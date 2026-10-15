import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { OperatorRepository } from "../netlify/lib/conversion-api.mjs";
import { sendClientMail } from "./customer-email.mjs";

type Env = (name:string)=>string|undefined;
export interface BillingDependencies { env:Env; fetch?:typeof fetch; repository?:OperatorRepository|null; }
type ObjectRow=Record<string,any>;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stripeId=(v:unknown,prefix:string):v is string=>typeof v==="string"&&new RegExp("^"+prefix+"_[a-zA-Z0-9]+$").test(v);
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const stripeKey=(env:Env)=>env("STRIPE_SECRET_KEY")?.trim()||"";
const validKey=(key:string)=>/^(?:sk|rk)_(?:test|live)_[a-zA-Z0-9]+$/.test(key);
const testMode=(env:Env)=>/^(?:sk|rk)_test_/.test(stripeKey(env));
const liveMode=(env:Env)=>/^(?:sk|rk)_live_/.test(stripeKey(env));
const priceId=(env:Env)=>env("STRIPE_PRICE_ID")?.trim()||"";
const setupPriceId=(env:Env)=>env("STRIPE_SETUP_PRICE_ID")?.trim()||"";
const webhookReady=(env:Env)=>/^whsec_[a-zA-Z0-9]+$/.test(env("STRIPE_WEBHOOK_SECRET")||"");
const billingReady=(env:Env)=>validKey(stripeKey(env))&&stripeId(priceId(env),"price")&&stripeId(setupPriceId(env),"price")&&webhookReady(env);
const dbConfig=(env:Env)=>{
  const url=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw Error("Billing database unavailable.");
  return {base:url.replace(/\/$/,""),key};
};
async function queryDb(deps:BillingDependencies,path:string,method="GET",body?:unknown){
  const {base,key}=dbConfig(deps.env);
  const response=await (deps.fetch??fetch)(base+"/rest/v1/"+path,{
    method,headers:{"apikey":key,"Content-Type":"application/json","Prefer":"return=representation,resolution=merge-duplicates"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error("Billing records unavailable.");
  const data=await response.json();
  if(!Array.isArray(data))throw Error("Unexpected billing records.");
  return data as ObjectRow[];
}
async function membership(deps:BillingDependencies,userId:string){
  const rows=await queryDb(deps,"calvren_billing_memberships?"+new URLSearchParams({
    auth_user_id:"eq."+userId,select:"auth_user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,subscription_status,current_period_end,client_id,welcome_email_sent_at",limit:"1"
  }));
  return rows[0]||null;
}
async function userFromToken(request:Request,deps:BillingDependencies){
  const header=request.headers.get("Authorization")||"";
  if(!/^Bearer [\w.\-]+$/.test(header))return null;
  const token=header.slice(7);
  const {base,key}=dbConfig(deps.env);
  const response=await (deps.fetch??fetch)(base+"/auth/v1/user",{headers:{"apikey":key,"Authorization":"Bearer "+token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;
  const user=await response.json();
  if(!uuid.test(user.id)||typeof user.email!=="string"||!user.email_confirmed_at)return null;
  return {id:user.id as string,email:user.email as string};
}
async function verifiedBillingEmail(deps:BillingDependencies,id:string):Promise<string|null>{
  const {base,key}=dbConfig(deps.env);
  const response=await (deps.fetch??fetch)(base+"/auth/v1/admin/users/"+id,{
    headers:{"apikey":key,"Authorization":"Bearer "+key},signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return null;
  const user=await response.json();
  return user.id===id&&typeof user.email==="string"&&user.email_confirmed_at?user.email:null;
}
async function ensureWelcomeEmail(deps:BillingDependencies,id:string,existingEmail?:string){
  const member=await membership(deps,id);
  if(!paid(member)||member?.welcome_email_sent_at)return;
  const recipient=existingEmail||await verifiedBillingEmail(deps,id);
  if(!recipient)return;
  if(await sendClientMail(deps.env,recipient,"welcome",{id:"calvren-welcome-"+id,fetcher:deps.fetch})){
    await queryDb(deps,"calvren_billing_memberships?auth_user_id=eq."+id,"PATCH",
      {welcome_email_sent_at:new Date().toISOString()});
  }
}
async function stripe(deps:BillingDependencies,path:string,body?:URLSearchParams){
  const key=stripeKey(deps.env);
  if(!validKey(key))throw Error("Stripe billing not yet configured.");
  const response=await (deps.fetch??fetch)("https://api.stripe.com/v1/"+path,{
    method:body?"POST":"GET",
    headers:{"Authorization":"Bearer "+key,"Stripe-Version":"2025-03-31.basil",...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
    ...(body?{body:body.toString()}:{}),signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error("Stripe billing request failed.");
  return data as ObjectRow;
}
const paid=(m:ObjectRow|null)=>!!m&&["active","trialing"].includes(m.subscription_status)
  &&(!m.current_period_end||new Date(m.current_period_end).getTime()>Date.now());
async function publicConfig(deps:BillingDependencies){
  if(!billingReady(deps.env)){
    // Presence/format diagnostics only; never log secret contents or identifiers.
    console.warn(JSON.stringify({event:"calvren_billing_configuration_incomplete",
      key_format_valid:validKey(stripeKey(deps.env)),
      recurring_price_set:stripeId(priceId(deps.env),"price"),
      setup_price_set:stripeId(setupPriceId(deps.env),"price"),
      webhook_secret_format_valid:webhookReady(deps.env)}));
    return json({ready:false,message:"Subscription checkout is being configured."});
  }
  try{
    const price=await stripe(deps,"prices/"+encodeURIComponent(priceId(deps.env)));
    const setup=await stripe(deps,"prices/"+encodeURIComponent(setupPriceId(deps.env)));
    if(setup.id!==setupPriceId(deps.env)||!setup.active||setup.recurring||!Number.isSafeInteger(setup.unit_amount)||setup.unit_amount<1||setup.currency!==price.currency)
      return json({ready:false,message:"Setup price requires configuration."});
    if(price.id!==priceId(deps.env)||!price.active||!price.recurring||!Number.isSafeInteger(price.unit_amount)||price.unit_amount<1)
      return json({ready:false,message:"Subscription price requires setup."});
    return json({ready:true,amount:price.unit_amount,setup_amount:setup.unit_amount,first_payment:price.unit_amount+setup.unit_amount,currency:price.currency,
      interval:price.recurring.interval,interval_count:price.recurring.interval_count||1,
      test_mode:testMode(deps.env)});
  }catch{return json({ready:false,message:"Subscription price is unavailable."});}
}
async function webhook(request:Request,deps:BillingDependencies){
  const secret=deps.env("STRIPE_WEBHOOK_SECRET")||"";
  if(!/^whsec_[a-zA-Z0-9]+$/.test(secret))return json({error:"Webhook not configured."},503);
  const signature=request.headers.get("Stripe-Signature")||"";
  const segments=signature.split(",").map(x=>x.trim().split("="));
  const t=segments.find(x=>x[0]==="t")?.[1]||"";
  const versions=segments.filter(x=>x[0]==="v1").map(x=>x[1]);
  if(!/^\d{10}$/.test(t)||Math.abs(Date.now()/1000-Number(t))>300||!versions.length)return json({error:"Invalid signature."},400);
  const raw=await request.text();
  if(raw.length>1024*1024)return json({error:"Payload too large."},413);
  const expected=createHmac("sha256",secret).update(t+"."+raw).digest("hex");
  if(!versions.some(x=>safeEqual(x,expected)))return json({error:"Invalid signature."},400);
  let event:ObjectRow;
  try{event=JSON.parse(raw);}catch{return json({error:"Invalid payload."},400);}
  if(event.livemode!==liveMode(deps.env))return json({error:"Stripe environment mismatch."},400);
  const obj=event?.data?.object;
  if(!obj||typeof obj!=="object")return json({ok:true,ignored:true});
  let subId:string|undefined,userId:string|undefined;
  if(event.type==="checkout.session.completed"&&obj.mode==="subscription"&&obj.payment_status!=="unpaid"){
    subId=typeof obj.subscription==="string"?obj.subscription:obj.subscription?.id;
    userId=obj.client_reference_id;
  }else if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)){
    subId=obj.id;userId=obj.metadata?.auth_user_id;
  }else return json({ok:true,ignored:true});
  if(!stripeId(subId,"sub")||!userId||!uuid.test(userId))return json({ok:true,ignored:true});
  // Always retrieve the current subscription, never trust stale or out-of-order event bodies.
  const current=await stripe(deps,"subscriptions/"+encodeURIComponent(subId));
  const allowedPrice=priceId(deps.env);
  const items=Array.isArray(current?.items?.data)?current.items.data:[];
  if(!stripeId(allowedPrice,"price")||!items.some((item:ObjectRow)=>item.price?.id===allowedPrice))return json({ok:true,ignored:true});
  if(current.metadata?.auth_user_id&&current.metadata.auth_user_id!==userId)return json({error:"Subscription owner mismatch."},409);
  if(!stripeId(current.customer,"cus")||!stripeId(current.id,"sub"))return json({error:"Invalid subscription."},400);
  const expire=items.find((item:ObjectRow)=>item.price?.id===allowedPrice)?.current_period_end||current.current_period_end||null;
  const rows=await queryDb(deps,"calvren_billing_memberships?on_conflict=auth_user_id","POST",{
    auth_user_id:userId,stripe_customer_id:current.customer,stripe_subscription_id:current.id,
    stripe_price_id:allowedPrice,subscription_status:current.status,
    current_period_end:Number.isInteger(expire)?new Date(expire*1000).toISOString():null,
    updated_at:new Date().toISOString()
  });
  if(rows.length===1&&paid(rows[0])){
    try{await ensureWelcomeEmail(deps,userId);}catch{console.warn(JSON.stringify({event:"calvren_welcome_mail_retry_later"}));}
  }
  return json({ok:true,updated:rows.length===1});
}
export async function handleBilling(request:Request,deps:BillingDependencies):Promise<Response>{
  const path=new URL(request.url).pathname;
  try{
    if(path==="/api/billing/public"&&request.method==="GET")return publicConfig(deps);
    if(path==="/api/billing/webhook"&&request.method==="POST")return webhook(request,deps);
    if(!["/api/billing/me","/api/billing/checkout","/api/billing/portal","/api/billing/automation"].includes(path))
      return json({error:"Not found."},404);
    const user=await userFromToken(request,deps);
    if(!user)return json({error:"Sign in with your verified email first."},401);
    const existing=await membership(deps,user.id);
    if(path==="/api/billing/me"&&request.method==="GET"){
      if(paid(existing)&&!existing?.welcome_email_sent_at){
        try{await ensureWelcomeEmail(deps,user.id,user.email);}catch{console.warn(JSON.stringify({event:"calvren_welcome_mail_retry_later"}));}
      }
      return json({email:user.email,paid:paid(existing),status:existing?.subscription_status||"none",
        expires_at:existing?.current_period_end||null,activation:existing?.client_id?"connected":"pending"});
    }
    if(path==="/api/billing/checkout"&&request.method==="POST"){
      if(!billingReady(deps.env))return json({error:"Subscription checkout is not configured yet."},503);
      if(paid(existing))return json({error:"Your subscription is already active. Open your client dashboard."},409);
      if(deps.repository){
        const key=createHash("sha256").update("billing-checkout:"+user.id).digest("hex");
        if(!await deps.repository.consumeRateLimit(key,6,3600,new Date().toISOString()))
          return json({error:"Too many checkout attempts. Try again later."},429);
      }
      const publicOrigin=deps.env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev";
      const origin=new URL(publicOrigin).origin;
      const p=new URLSearchParams({
        mode:"subscription",allow_promotion_codes:"true","line_items[0][price]":priceId(deps.env),"line_items[0][quantity]":"1",
        "line_items[1][price]":setupPriceId(deps.env),"line_items[1][quantity]":"1",
        client_reference_id:user.id,"subscription_data[metadata][auth_user_id]":user.id,
        customer_email:user.email,
        success_url:origin+"/client.html?checkout=success",cancel_url:origin+"/payment?checkout=canceled",
      });
      if(existing?.stripe_customer_id)p.set("customer",existing.stripe_customer_id),p.delete("customer_email");
      const session=await stripe(deps,"checkout/sessions",p);
      if(!/^https:\/\/checkout\.stripe\.com\//.test(session.url||""))throw Error("Invalid Stripe checkout.");
      return json({url:session.url});
    }
    if(path==="/api/billing/portal"&&request.method==="POST"){
      if(!existing||!stripeId(existing.stripe_customer_id,"cus"))return json({error:"No billing profile exists yet."},404);
      const origin=new URL(deps.env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev").origin;
      const portal=await stripe(deps,"billing_portal/sessions",new URLSearchParams({
        customer:existing.stripe_customer_id,return_url:origin+"/client.html"
      }));
      if(!/^https:\/\/billing\.stripe\.com\//.test(portal.url||""))throw Error("Invalid billing portal.");
      return json({url:portal.url});
    }
    if(path==="/api/billing/automation"&&request.method==="GET"){
      if(!paid(existing))return json({error:"An active subscription is required."},403);
      if(!existing?.client_id)return json({status:"setup_pending",message:"Your automation is being connected by Calvren. No live integrations are enabled yet.",leads:[]});
      // Private service key; never authorize by client_id from the browser.
      const clientId=existing.client_id;
      const rows=await queryDb(deps,"calvren_leads?"+new URLSearchParams({
        client_id:"eq."+clientId,select:"data",limit:"20"
      }));
      return json({status:"connected",leads:rows.map(row=>({
        id:row.data?.id||"",status:row.data?.status||"unknown",created_at:row.data?.created_at||null
      }))});
    }
    return json({error:"Use the expected method."},405);
  }catch(error){
    console.error(JSON.stringify({event:"calvren_billing_failed",kind:request.method==="POST"?"write":"read"}));
    return json({error:"Billing is temporarily unavailable. Please try again or contact Calvren."},503);
  }
}
