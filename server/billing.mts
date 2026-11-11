import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { OperatorRepository } from "../netlify/lib/conversion-api.mjs";
import { sendClientMail } from "./customer-email.mjs";
import { handleAutomationHub } from "./automation-hub.mjs";

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
// All subscription entitlements derive from server-verified Stripe price IDs, never the browser.
export type CalvrenPlan="starter"|"growth"|"pro";
const plans={
  starter:{name:"Starter",monthly:9900,envKey:"STRIPE_PRICE_ID"},
  growth:{name:"Growth",monthly:24900,envKey:"STRIPE_GROWTH_PRICE_ID"},
  pro:{name:"Pro",monthly:49900,envKey:"STRIPE_PRO_PRICE_ID"}
} as const;
const features={
  starter:["lead_response","booking"],
  growth:["lead_response","booking","follow_ups","review_requests","monthly_reports"],
  pro:["lead_response","booking","follow_ups","review_requests","monthly_reports","custom_integrations","advanced_workflows","unified_inbox","priority_support"]
} as const;
// Price IDs identify public Stripe catalog records; they are not API credentials.
// For the production account, pin the *verified* live prices so an old optional
// environment variable cannot silently send customers to an obsolete price.
// In sandbox tests, use explicitly configured test price IDs.
const LIVE_PRICE_IDS={
  growth:"price_1UaAOfQ9mewkKyl5rXDk02Ff",
  pro:"price_1UaAOiQ9mewkKyl5NubJPt0S"
} as const;
const configuredPrice=(env:Env,plan:CalvrenPlan)=>{
  if(plan==="starter")return priceId(env);
  if(liveMode(env))return LIVE_PRICE_IDS[plan];
  return env(plans[plan].envKey)?.trim()||"";
};
// Existing $219/$389 subscribers retain their paid Growth/Pro access until an
// explicitly approved subscription change. New checkouts use ONLY the new IDs.
const LEGACY_LIVE_PRICE_IDS={
  growth:["price_1Ua3rFQ9mewkKyl5dIhzjarI"],
  pro:["price_1Ua3rNQ9mewkKyl5TrGGeeQU"]
} as const;
const planForPrice=(env:Env,value:unknown):CalvrenPlan|null=>{
  if(typeof value!=="string")return null;
  for(const plan of ["starter","growth","pro"] as const)
    if(stripeId(configuredPrice(env,plan),"price")&&configuredPrice(env,plan)===value)return plan;
  if(liveMode(env)){
    if(LEGACY_LIVE_PRICE_IDS.growth.includes(value as typeof LEGACY_LIVE_PRICE_IDS.growth[number]))return "growth";
    if(LEGACY_LIVE_PRICE_IDS.pro.includes(value as typeof LEGACY_LIVE_PRICE_IDS.pro[number]))return "pro";
  }
  return null;
};
const validPrice=(price:ObjectRow,id:string,amount:number)=>price?.id===id&&price.active===true
  &&price.currency==="cad"&&price.unit_amount===amount
  &&price.recurring?.interval==="month"&&(price.recurring?.interval_count||1)===1;

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
  const visible={
    starter:{label:"Starter",amount:9900,ready:false,checkout:"subscription"},
    growth:{label:"Growth",amount:24900,ready:false,checkout:"subscription"},
    pro:{label:"Pro",amount:49900,ready:false,checkout:"subscription"}
  };
  if(!billingReady(deps.env))return json({ready:false,plans:visible,message:"Subscription checkout is being configured."});
  try{
    const setup=await stripe(deps,"prices/"+encodeURIComponent(setupPriceId(deps.env)));
    if(setup.id!==setupPriceId(deps.env)||!setup.active||setup.recurring||setup.unit_amount!==34900||setup.currency!=="cad")
      return json({ready:false,plans:visible,message:"Setup price requires configuration."});
    const starter=await stripe(deps,"prices/"+encodeURIComponent(priceId(deps.env)));
    if(!validPrice(starter,priceId(deps.env),9900))
      return json({ready:false,plans:visible,message:"Starter price requires configuration."});
    visible.starter.ready=true;
    for(const plan of ["growth","pro"] as const){
      const id=configuredPrice(deps.env,plan);
      if(!stripeId(id,"price")||id===priceId(deps.env))continue;
      try{
        const price=await stripe(deps,"prices/"+encodeURIComponent(id));
        visible[plan].ready=validPrice(price,id,plans[plan].monthly);
      }catch{visible[plan].ready=false;}
    }
    return json({ready:true,amount:starter.unit_amount,setup_amount:setup.unit_amount,
      first_payment:starter.unit_amount+setup.unit_amount,currency:"cad",
      interval:"month",interval_count:1,test_mode:testMode(deps.env),plans:visible});
  }catch{return json({ready:false,plans:visible,message:"Subscription pricing is unavailable."});}
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
  const items=Array.isArray(current?.items?.data)?current.items.data:[];
  const matched=items.find((item:ObjectRow)=>planForPrice(deps.env,item?.price?.id)!==null);
  const allowedPrice=matched?.price?.id;
  if(!matched||!allowedPrice)return json({ok:true,ignored:true});
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
    if(path.startsWith("/api/billing/hub/")){
      const user=await userFromToken(request,deps);
      if(!user)return json({error:"Sign in with your verified email first."},401);
      const existing=await membership(deps,user.id);
      const plan=paid(existing)?planForPrice(deps.env,existing?.stripe_price_id):null;
      return handleAutomationHub(request,{env:deps.env,fetch:deps.fetch,user,member:existing,plan});
    }
    if(!["/api/billing/me","/api/billing/checkout","/api/billing/portal","/api/billing/automation","/api/billing/report"].includes(path))
      return json({error:"Not found."},404);
    const user=await userFromToken(request,deps);
    if(!user)return json({error:"Sign in with your verified email first."},401);
    const existing=await membership(deps,user.id);
    if(path==="/api/billing/me"&&request.method==="GET"){
      if(paid(existing)&&!existing?.welcome_email_sent_at){
        try{await ensureWelcomeEmail(deps,user.id,user.email);}catch{console.warn(JSON.stringify({event:"calvren_welcome_mail_retry_later"}));}
      }
      return json({email:user.email,paid:paid(existing),status:existing?.subscription_status||"none",
        expires_at:existing?.current_period_end||null,activation:existing?.client_id?"connected":"pending",
        plan:paid(existing)?planForPrice(deps.env,existing?.stripe_price_id):null,
        included_features:paid(existing)&&planForPrice(deps.env,existing?.stripe_price_id)?
          features[planForPrice(deps.env,existing.stripe_price_id)!]:[]});
    }
    if(path==="/api/billing/checkout"&&request.method==="POST"){
      if(!billingReady(deps.env))return json({error:"Subscription checkout is not configured yet."},503);
      let plan:CalvrenPlan="starter";
      const raw=await request.text();
      if(raw.length>1024)return json({error:"Checkout request too large."},413);
      if(raw.trim()){
        try{
          const payload=JSON.parse(raw);
          if(!payload||typeof payload!=="object"||Array.isArray(payload))
            return json({error:"Invalid checkout request."},400);
          if(Object.hasOwn(payload,"plan")){
            if(!["starter","growth","pro"].includes(payload.plan))
              return json({error:"Choose Starter, Growth or Pro."},400);
            plan=payload.plan as CalvrenPlan;
          }
        }catch{return json({error:"Invalid checkout request."},400);}
      }
      const selectedPrice=configuredPrice(deps.env,plan);
      if(!stripeId(selectedPrice,"price"))
        return json({error:"This plan is not available for online checkout yet. Contact Calvren."},503);
      const verified=await stripe(deps,"prices/"+encodeURIComponent(selectedPrice));
      if(!validPrice(verified,selectedPrice,plans[plan].monthly))
        return json({error:"This plan's verified Stripe price is unavailable. Contact Calvren."},503);
      if(paid(existing))return json({error:"Your subscription is already active. Open your client dashboard."},409);
      if(deps.repository){
        const key=createHash("sha256").update("billing-checkout:"+user.id).digest("hex");
        if(!await deps.repository.consumeRateLimit(key,6,3600,new Date().toISOString()))
          return json({error:"Too many checkout attempts. Try again later."},429);
      }
      const publicOrigin=deps.env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev";
      const origin=new URL(publicOrigin).origin;
      const p=new URLSearchParams({
        mode:"subscription",allow_promotion_codes:"true","line_items[0][price]":selectedPrice,"line_items[0][quantity]":"1",
        "line_items[1][price]":setupPriceId(deps.env),"line_items[1][quantity]":"1",
        client_reference_id:user.id,"subscription_data[metadata][auth_user_id]":user.id,
        "subscription_data[metadata][requested_plan]":plan,
        customer_email:user.email,
        // Stripe returns to Calvren, which shows a thank-you page only after
         // verified paid membership. The customer chooses when to start onboarding.
         success_url:origin+"/client.html?checkout=success",cancel_url:origin+"/payment?plan="+encodeURIComponent(plan)+"&checkout=canceled",
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
    if(path==="/api/billing/report"&&request.method==="GET"){
      if(!paid(existing))return json({error:"An active subscription is required."},403);
      const plan=planForPrice(deps.env,existing?.stripe_price_id);
      if(plan!=="growth"&&plan!=="pro")return json({error:"Monthly reports require a Growth or Pro subscription."},403);
      if(!existing?.client_id)return json({status:"setup_pending",message:"Your business connection is being activated."});
      const month=new URL(request.url).searchParams.get("month")||new Date().toISOString().slice(0,7);
      if(!/^20\d\d-(?:0[1-9]|1[0-2])$/.test(month))return json({error:"Invalid report month."},400);
      const first=new Date(month+"-01T00:00:00.000Z");
      const next=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,1)).getTime();
      const start=first.getTime();
      // No client-controlled tenant ID is accepted. Never include lead contact details in reports.
      const [leads,appointments]=await Promise.all([
        queryDb(deps,"calvren_leads?"+new URLSearchParams({
          client_id:"eq."+existing.client_id,select:"data",limit:"1000"
        })),
        queryDb(deps,"calvren_appointments?"+new URLSearchParams({
          client_id:"eq."+existing.client_id,select:"starts_at,data",limit:"1000"
        }))
      ]);
      const inMonth=(value:unknown)=>{
        if(typeof value!=="string")return false;
        const date=Date.parse(value);
        return Number.isFinite(date)&&date>=start&&date<next;
      };
      const periodLeads=leads.filter(row=>inMonth(row.data?.created_at));
      const periodAppointments=appointments.filter(row=>inMonth(row.starts_at));
      return json({status:"connected",plan,month,
        metrics:{
          leads:periodLeads.length,
          qualified:periodLeads.filter(row=>["qualified","booking","booked","won"].includes(row.data?.status)).length,
          booked_appointments:periodAppointments.filter(row=>row.data?.status==="booked").length
        },
        partial:leads.length>=1000||appointments.length>=1000});
    }
    if(path==="/api/billing/automation"&&request.method==="GET"){
      if(!paid(existing))return json({error:"An active subscription is required."},403);
      if(!existing?.client_id)return json({status:"setup_pending",message:"Your automation is being connected by Calvren. No live integrations are enabled yet.",leads:[]});
      // Private service key; never authorize by client_id from the browser.
      const clientId=existing.client_id;
      const rows=await queryDb(deps,"calvren_leads?"+new URLSearchParams({
        client_id:"eq."+clientId,select:"data",limit:"20"
      }));
      return json({status:"connected",plan:planForPrice(deps.env,existing?.stripe_price_id),
        leads:rows.map(row=>({
        id:row.data?.id||"",status:row.data?.status||"unknown",created_at:row.data?.created_at||null
      }))});
    }
    return json({error:"Use the expected method."},405);
  }catch(error){
    console.error(JSON.stringify({event:"calvren_billing_failed",kind:request.method==="POST"?"write":"read"}));
    return json({error:"Billing is temporarily unavailable. Please try again or contact Calvren."},503);
  }
}
