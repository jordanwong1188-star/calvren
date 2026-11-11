import {chromium} from "playwright";
import assert from "node:assert/strict";

const site=process.env.CALVREN_TEST_SITE||"http://127.0.0.1:8080";
const browser=await chromium.launch({headless:true});
const js=withUser=>String.raw`export function createClient(){
  const user=${withUser?'{id:"55555555-5555-4555-8555-555555555555",email:"test@example.com"}':'null'};
  return {auth:{
    getSession:async()=>({data:{session:user?{user,access_token:"fixture-session"}:null},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
  }};
}`;
try{
  const context=await browser.newContext({viewport:{width:375,height:812}});
  let paid=true,plan="growth",meRequests=0,onboardingRequests=0,checkoutRequests=0;
  await context.route("https://esm.sh/@supabase/supabase-js@2.57.0",route=>route.fulfill({
    status:200,contentType:"application/javascript",headers:{"Access-Control-Allow-Origin":"*"},body:js(true)
  }));
  await context.route("**/api/billing/*",route=>{
    const path=new URL(route.request().url()).pathname;
    const respond=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
    if(path==="/api/billing/public")return respond({ready:true,test_mode:false,
      plans:{starter:{ready:true},growth:{ready:true},pro:{ready:true}}});
    if(path==="/api/billing/me"){
      meRequests++;
      assert.equal(route.request().headers().authorization,"Bearer fixture-session");
      return respond({email:"test@example.com",paid,status:paid?"active":"none",
        plan:paid?plan:null,activation:"pending",included_features:[]});
    }
    if(path==="/api/billing/checkout"){checkoutRequests++;return respond({error:"Checkout forbidden in verification"},409);}
    if(path==="/api/billing/automation")return respond({status:"setup_pending",message:"Finish onboarding"});
    if(path==="/api/billing/hub/settings")return respond({status:"setup_pending"});
    return respond({error:"Unexpected endpoint"},404);
  });
  await context.route("**/api/onboarding*",route=>{
    onboardingRequests++;
    assert.equal(route.request().headers().authorization,"Bearer fixture-session");
    return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({email:"test@example.com",record:null})});
  });
  const page=await context.newPage();
  const runtimeErrors=[];
  page.on("pageerror",e=>runtimeErrors.push(e.message));

  // A signed Stripe return is a hint; only an authenticated, paid membership
  // can unlock the thank-you screen and its onboarding CTA.
  await page.goto(site+"/client.html?checkout=success",{waitUntil:"domcontentloaded"});
  await page.locator("#client-payment-success").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#client-payment-pending").isVisible(),false);
  assert.equal(await page.locator("#client-start-area").isVisible(),false);
  assert.equal(await page.locator("#client-success-plan").textContent(),"Growth");
  assert.match(await page.locator("#client-success-title").textContent(),/Thank you for choosing Calvren/i);
  assert.equal(new URL(page.url()).pathname,"/client.html",
    "The customer should see a confirmation and decide when to begin onboarding.");
  const action=page.locator("#client-complete-onboarding");
  assert.equal(await action.getAttribute("href"),"/onboarding.html");
  assert.match(await action.textContent(),/Complete your onboarding/i);
  assert.equal(checkoutRequests,0);
  await action.click();
  await page.waitForURL(url=>url.pathname==="/onboarding.html",{timeout:10000});
  await page.locator("#onboarding-app").waitFor({state:"visible",timeout:10000});
  assert.ok(onboardingRequests>=1);
  assert.equal(await page.locator("#step-indicator").textContent(),"STEP 1 OF 4");

  // A Pro payment displays the correct confirmed plan, not a hardcoded tier.
  plan="pro";
  const pro=await context.newPage();
  await pro.goto(site+"/client.html?checkout=success",{waitUntil:"domcontentloaded"});
  await pro.locator("#client-payment-success").waitFor({state:"visible",timeout:10000});
  assert.equal(await pro.locator("#client-success-plan").textContent(),"Pro");

  // If Stripe's signed webhook has not arrived, the UI stays pending,
  // suppresses duplicate checkout and retries verification.
  paid=false;plan="starter";meRequests=0;
  const pending=await context.newPage();
  await pending.goto(site+"/client.html?checkout=success",{waitUntil:"domcontentloaded"});
  await pending.locator("#client-payment-pending").waitFor({state:"visible",timeout:10000});
  assert.equal(await pending.locator("#client-payment-success").isVisible(),false);
  assert.equal(await pending.locator("#client-start-area").isVisible(),false);
  assert.equal(checkoutRequests,0);
  paid=true;
  await pending.locator("#client-payment-success").waitFor({state:"visible",timeout:15000});
  assert.equal(await pending.locator("#client-success-plan").textContent(),"Starter");
  assert.ok(meRequests>=2);
  assert.equal(new URL(pending.url()).pathname,"/client.html");

  // An existing subscriber visiting the dashboard normally is not shown a
  // misleading new-purchase confirmation.
  const regular=await context.newPage();
  await regular.goto(site+"/client.html",{waitUntil:"domcontentloaded"});
  await regular.locator("#client-membership").waitFor({state:"visible",timeout:10000});
  assert.equal(await regular.locator("#client-payment-success").isVisible(),false);

  // Responsive mobile viewport must not overflow horizontally.
  const overflow=await pro.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=2,"Success screen must be mobile friendly, overflow="+overflow);

  const guestContext=await browser.newContext();
  await guestContext.route("https://esm.sh/@supabase/supabase-js@2.57.0",route=>route.fulfill({
    status:200,contentType:"application/javascript",headers:{"Access-Control-Allow-Origin":"*"},body:js(false)
  }));
  let guestBilling=0;
  await guestContext.route("**/api/billing/me",route=>{guestBilling++;return route.abort();});
  const guest=await guestContext.newPage();
  await guest.goto(site+"/client.html?checkout=success",{waitUntil:"domcontentloaded"});
  await guest.locator("#auth-panel").waitFor({state:"visible",timeout:10000});
  assert.equal(await guest.locator("#client-payment-success").isVisible(),false);
  assert.equal(guestBilling,0);

  assert.deepEqual(runtimeErrors,[]);
  console.log("CALVREN_STRIPE_THANKYOU_E2E_PASSED: verified plans, pending webhook, no double checkout, mobile, onboarding CTA and guest protection");
  await guestContext.close();
}finally{await browser.close();}
