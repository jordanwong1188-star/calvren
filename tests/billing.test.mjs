import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";
const temp=await mkdtemp(join(tmpdir(),"calvren-billing-"));
after(()=>rm(temp,{recursive:true,force:true}));
const src=await readFile(new URL("../server/billing.mts",import.meta.url),"utf8");
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile(join(temp,"billing.mjs"),js);
const {handleBilling}=await import(pathToFileURL(join(temp,"billing.mjs")).href);
const userId="5aafe427-dffc-429c-8a9b-1347f6b2ee4e";
const secret="whsec_webhooktest1234",priceId="price_123abc",subId="sub_123abc",customerId="cus_123abc";
const env=name=>({
  STRIPE_SECRET_KEY:"sk_test_fixture1234",STRIPE_WEBHOOK_SECRET:secret,
  STRIPE_PRICE_ID:priceId,STRIPE_SETUP_PRICE_ID:"price_setup123",SUPABASE_URL:"https://fixture.supabase.co",
  SUPABASE_SECRET_KEY:"sb_secret_example",CALVREN_PUBLIC_URL:"https://calvren.pages.dev"
}[name]);
function fixture({member=null,clientId=null}={}){
  const calls=[],saved=[];
  const fetch=async (url,init={})=>{
    calls.push({url,init});
    if(url.endsWith("/auth/v1/user"))return new Response(JSON.stringify({id:userId,email:"client@example.com",
      email_confirmed_at:"2026-10-13T00:00:00Z"}));
    if(url.includes("/rest/v1/calvren_billing_memberships")){
      if(init.method==="POST"){saved.push(JSON.parse(init.body));return Response.json([saved.at(-1)]);}
      return Response.json(member?[member]:[]);
    }
    if(url.includes("/rest/v1/calvren_leads"))return Response.json([
      {data:{id:"1",status:"qualified",created_at:"2026-10-13T00:00:00Z"}}]);
    if(url.endsWith("/v1/prices/price_setup123"))return Response.json({id:"price_setup123",active:true,unit_amount:34900,currency:"cad",recurring:null});
    if(url.endsWith("/v1/prices/"+priceId))return Response.json({id:priceId,active:true,unit_amount:15900,
      currency:"cad",recurring:{interval:"month",interval_count:1}});
    if(url.endsWith("/v1/subscriptions/"+subId))return Response.json({
      id:subId,customer:customerId,status:"active",metadata:{auth_user_id:userId},
      items:{data:[{price:{id:priceId},current_period_end:1890000000}]}
    });
    if(url.includes("/v1/promotion_codes?"))return Response.json({data:[{id:"promo_1UQX7IQ9mewkKyl5lR0GMbi4",active:true,code:"CALVREN15",promotion:{coupon:"tlQfQM4u"}}]});
    if(url.endsWith("/v1/checkout/sessions"))return Response.json({url:"https://checkout.stripe.com/c/pay/cs_test_fixture"});
    if(url.endsWith("/v1/billing_portal/sessions"))return Response.json({url:"https://billing.stripe.com/p/session/test_fixture"});
    return Response.json({error:"Unknown test request"}, {status:500});
  };
  const deps={env,fetch,repository:{async consumeRateLimit(){return true;}}};
  const req=(path,method="GET",authorized=false,extra={})=>new Request("https://calvren.pages.dev/api/billing/"+path,{
    method,headers:{...(authorized?{Authorization:"Bearer verified.fake.jwt"}:{}),...extra.headers},
    ...(extra.body?{body:extra.body}:{})
  });
  return {deps,req,calls,saved,clientId};
}
function signedPayload(payload){
  const raw=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000);
  const digest=createHmac("sha256",secret).update(timestamp+"."+raw).digest("hex");
  return {raw,header:"t="+timestamp+",v1="+digest};
}
test("billing public price only comes from configured Stripe price",async()=>{
  const f=fixture();
  const response=await handleBilling(f.req("public"),f.deps);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ready:true,amount:15900,setup_amount:34900,first_payment:50800,currency:"cad",interval:"month",interval_count:1,test_mode:true});
});
test("server billing accepts least-privilege restricted Stripe test keys",async()=>{
  const f=fixture();
  f.deps.env=name=>name==="STRIPE_SECRET_KEY"?"rk_test_syntheticfixture123":env(name);
  const response=await handleBilling(f.req("public"),f.deps);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ready,true);
  assert.equal(body.test_mode,true);
  const call=f.calls.find(x=>x.url.endsWith("/v1/prices/"+priceId));
  assert.equal(call.init.headers.Authorization,"Bearer rk_test_syntheticfixture123");
});
test("restricted live key enforces Stripe webhook livemode",async()=>{
  const f=fixture();
  f.deps.env=name=>name==="STRIPE_SECRET_KEY"?"rk_live_syntheticfixture123":env(name);
  const event={id:"evt_fixture",livemode:false,type:"customer.subscription.updated",
    data:{object:{id:subId,metadata:{auth_user_id:userId}}}};
  const signed=signedPayload(event);
  const response=await handleBilling(f.req("webhook","POST",false,{
    headers:{"Stripe-Signature":signed.header},body:signed.raw
  }),f.deps);
  assert.equal(response.status,400);
  assert.equal(f.saved.length,0);
});
test("unauthenticated checkout, client data, portal cannot be accessed",async()=>{
  const f=fixture();
  for(const path of ["checkout","portal","me","automation"]){
    const r=await handleBilling(f.req(path,path==="checkout"||path==="portal"?"POST":"GET"),f.deps);
    assert.equal(r.status,401,path);
  }
  assert.equal(f.calls.length,0,"No Stripe or database requests before identity verification.");
});
test("session creation uses authenticated user id, fixed server price, and return URLs",async()=>{
  const f=fixture();
  const response=await handleBilling(f.req("checkout","POST",true),f.deps);
  assert.equal(response.status,200);
  const request=f.calls.find(x=>x.url.endsWith("/v1/checkout/sessions"));
  const body=new URLSearchParams(request.init.body);
  assert.equal(body.get("allow_promotion_codes"),"true","Stripe Checkout alone must display promo-code entry.");
  assert.equal(body.get("discounts[0][promotion_code]"),null,"No website-managed code should be applied.");
  assert.equal(body.get("client_reference_id"),userId);
  assert.equal(body.get("subscription_data[metadata][auth_user_id]"),userId);
  assert.equal(body.get("customer_email"),"client@example.com");
  assert.equal(body.get("line_items[0][price]"),priceId);
  assert.equal(body.get("line_items[1][price]"),"price_setup123");
  assert.equal(body.get("success_url"),"https://calvren.pages.dev/client.html?checkout=success");
  assert.equal(body.get("cancel_url"),"https://calvren.pages.dev/payment?checkout=canceled");
});
test("signed checkout completion fetches current subscription before granting access",async()=>{
  const f=fixture();
  const event={id:"evt_123",livemode:false,type:"checkout.session.completed",
    data:{object:{mode:"subscription",payment_status:"paid",subscription:subId,client_reference_id:userId}}};
  const signed=signedPayload(event);
  let response=await handleBilling(f.req("webhook","POST",false,{
    headers:{"Stripe-Signature":signed.header},body:signed.raw}),f.deps);
  assert.equal(response.status,200);
  assert.equal(f.saved.length,1);
  assert.equal(f.saved[0].auth_user_id,userId);
  assert.equal(f.saved[0].stripe_subscription_id,subId);
  assert.equal(f.saved[0].subscription_status,"active");
  assert.equal(f.saved[0].client_id,undefined,"Webhook must never auto-assign a tenant.");
});
test("forged, stale and wrong-mode webhooks cannot grant access",async()=>{
  const f=fixture();
  const event={id:"evt_123",livemode:false,type:"customer.subscription.updated",
    data:{object:{id:subId,metadata:{auth_user_id:userId}}}};
  const signed=signedPayload(event);
  for(const signature of ["t=1234567890,v1="+signed.header.split("v1=")[1],"t="+Math.floor(Date.now()/1000)+",v1="+"0".repeat(64)]){
    const result=await handleBilling(f.req("webhook","POST",false,{headers:{"Stripe-Signature":signature},body:signed.raw}),f.deps);
    assert.equal(result.status,400);
  }
  assert.equal(f.saved.length,0);
});
test("client automation data is strictly scoped to server-linked paid tenant",async()=>{
  const base={stripe_customer_id:customerId,stripe_subscription_id:subId,stripe_price_id:priceId,
    subscription_status:"active",current_period_end:"2030-01-01T00:00:00Z"};
  const noTenant=fixture({member:{...base,client_id:null}});
  const response=await handleBilling(noTenant.req("automation","GET",true),noTenant.deps);
  assert.equal((await response.json()).status,"setup_pending");
  assert.equal(noTenant.calls.some(x=>x.url.includes("/calvren_leads")),false);
  const linked=fixture({member:{...base,client_id:"abc_plumbing"}});
  const answer=await handleBilling(linked.req("automation","GET",true),linked.deps);
  assert.equal(answer.status,200);
  assert.equal((await answer.json()).status,"connected");
  const db=linked.calls.find(x=>x.url.includes("/calvren_leads"));
  assert.ok(db.url.includes("client_id=eq.abc_plumbing"));
  assert.ok(!db.url.includes("client_id=eq.others"));
});
test("subscription without payment cannot read tenant activity",async()=>{
  const f=fixture({member:{subscription_status:"canceled",client_id:"abc_plumbing"}});
  const response=await handleBilling(f.req("automation","GET",true),f.deps);
  assert.equal(response.status,403);
  assert.equal(f.calls.some(x=>x.url.includes("/calvren_leads")),false);
});

test("promotion code is entered only in Stripe hosted Checkout, not on Calvren",async()=>{
  const f=fixture();
  const request=new Request("https://calvren.pages.dev/api/billing/checkout",{
    method:"POST",headers:{"Authorization":"Bearer verified.fake.jwt","Content-Type":"application/json"},
    body:JSON.stringify({discount_code:"made-up"})
  });
  const response=await handleBilling(request,f.deps);
  assert.equal(response.status,200,"Obsolete site promo field must not affect checkout.");
  assert.equal(f.calls.some(x=>x.url.includes("/v1/promotion_codes?")),false);
  const sent=f.calls.find(x=>x.url.endsWith("/v1/checkout/sessions"));
  const params=new URLSearchParams(sent.init.body);
  assert.equal(params.get("allow_promotion_codes"),"true");
  assert.equal(params.get("discounts[0][promotion_code]"),null);
  assert.equal(params.get("line_items[0][price]"),priceId);
  assert.equal(params.get("line_items[1][price]"),"price_setup123");
});
test("public pricing page has no discount solicitation",async()=>{
  const page=await readFile(new URL("../public/payment.html",import.meta.url),"utf8");
  const client=await readFile(new URL("../public/client-portal.js",import.meta.url),"utf8");
  assert.ok(!page.includes("discount-code"));
  assert.ok(!page.includes("Negotiated discount"));
  assert.ok(!client.includes("discount-code"));
});
