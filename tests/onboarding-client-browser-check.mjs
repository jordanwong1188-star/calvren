import {chromium} from "playwright";
import assert from "node:assert/strict";

const origin=process.env.CALVREN_TEST_SITE||"http://127.0.0.1:8080";
const browser=await chromium.launch({headless:true});
let record=null,saved=0,submitted=0,approved=0,unauthorizedApiCalls=0;
const errors=[];
const sessionModule=withSession=>'export function createClient(){return {auth:{getSession:async()=>({data:{session:'+(
  withSession?'{access_token:"qa.verify.token"}':"null")+'},error:null})}}}';
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  const script=state=>route=>route.fulfill({status:200,
    headers:{"Access-Control-Allow-Origin":"*"},contentType:"application/javascript",body:sessionModule(state)});
  await page.route("https://esm.sh/**",script(true));
  await page.route("**/api/onboarding*",async route=>{
    const request=route.request(),method=request.method(),path=new URL(request.url()).pathname;
    assert.equal(request.headers().authorization,"Bearer qa.verify.token");
    const reply=(body,status=200)=>route.fulfill({
      status,contentType:"application/json",body:JSON.stringify(body)});
    if(path==="/api/onboarding/approve"&&method==="POST"){
      const data=request.postDataJSON();
      assert.equal(data.approved,true);assert.equal(data.scope,record?.launch_scope);
      record={...record,status:"approved",scope_approved_at:"2026-11-10T07:00:00Z"};
      approved++;return reply({record});
    }
    if(path!=="/api/onboarding")return reply({error:"Not found"},404);
    if(method==="GET")return reply({email:"qa@example.com",record});
    if(method==="PUT"||method==="POST"){
      const value=request.postDataJSON();
      assert.ok(!Object.hasOwn(value,"auth_user_id"),"Never pass arbitrary identity from browser.");
      record={form:value.form,current_step:value.current_step,
        status:method==="POST"?"submitted":"draft",owner_note:"",
        submitted_at:method==="POST"?"2026-11-10T00:00:00Z":null,
        launch_scope:"",scope_approved_at:null};
      if(method==="POST")submitted++;else saved++;
      return reply({record});
    }
    return reply({error:"Method not supported"},405);
  });
  const r=await page.goto(origin+"/onboarding.html",{waitUntil:"load"});
  assert.equal(r.status(),200);
  await page.locator("#onboarding-app").waitFor({state:"visible"});
  await page.locator('[data-goto="4"]').click();
  await page.locator("#submit-btn").waitFor({state:"visible"});
  await page.locator("#submit-btn").click();
  assert.equal(await page.locator("#step-indicator").textContent(),"STEP 1 OF 4",
    "Submission must return to the first incomplete step.");
  assert.equal(submitted,0);
  await page.locator("#business_name").fill("North Shore Plumbing QA");
  await page.locator("#industry").selectOption({label:"Home services"});
  await page.locator("#description").fill("Plumbing and maintenance by appointment.");
  await page.locator("#contact_name").fill("Morgan Tester");
  await page.locator("#contact_email").fill("morgan@example.com");
  await page.locator("#website").fill("http://example.com");
  await page.locator("#next-btn").click();
  assert.equal(await page.locator("#step-indicator").textContent(),"STEP 1 OF 4");
  await page.locator("#website").fill("https://example.com");
  await page.locator("#next-btn").click();
  await page.getByText("STEP 2 OF 4").waitFor();
  await page.locator("#services").fill("Drain repair, leak maintenance");
  await page.locator("#lead_sources").fill("Website enquiries");
  await page.locator("#business_hours").fill("Mon-Fri 9am-5pm");
  await page.locator("#lead_form_url").fill("https://example.com/contact");
  await page.locator("#next-btn").click();
  await page.getByText("STEP 3 OF 4").waitFor();
  assert.ok(saved>=2);
  await page.reload({waitUntil:"load"});
  await page.locator("#onboarding-app").waitFor({state:"visible"});
  assert.equal(await page.locator("#step-indicator").textContent(),"STEP 3 OF 4");
  assert.equal(record.form.business_name,"North Shore Plumbing QA");
  assert.match(await page.locator("#saved-indicator").textContent(),/Saved draft/);
  await page.locator("#handoff_email").fill("dispatch@example.com");
  await page.locator("#kickoff_requested").check();
  await page.locator("#kickoff_availability").fill("Thursday after 2 PM Pacific");
  await page.locator("#next-btn").click();
  await page.getByText("STEP 4 OF 4").waitFor();
  assert.match(await page.locator("#review-summary").textContent(),/dispatch@example.com/);
  await page.locator("#submit-btn").click();
  assert.equal(submitted,0,"Unchecked acknowledgement boxes must block submission.");
  await page.locator("#consent_data_handling").check();
  await page.locator("#approve_workflow_scope").check();
  await page.locator("#submit-btn").click();
  await page.locator("#submitted-panel").waitFor({state:"visible"});
  assert.equal(submitted,1);
  assert.equal(record.form.kickoff_requested,true);
  record={...record,status:"awaiting_approval",
    launch_scope:"After testing, send qualified enquiry acknowledgments and book approved availability."};
  await page.reload({waitUntil:"load"});
  await page.locator("#approval-panel").waitFor({state:"visible"});
  await page.locator("#launch-approval-btn").click();
  assert.match(await page.locator("#launch-approval-message").textContent(),/review and confirm/i);
  await page.locator("#launch-approval-check").check();
  await page.locator("#launch-approval-btn").click();
  await page.locator("#approval-panel").waitFor({state:"hidden"});
  assert.equal(approved,1);
  assert.equal(record.status,"approved");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<2,"Mobile onboarding must not overflow horizontally.");
  const guest=await context.newPage();
  await guest.route("https://esm.sh/**",script(false));
  await guest.route("**/api/onboarding*",route=>{unauthorizedApiCalls++;return route.abort();});
  await guest.goto(origin+"/onboarding.html",{waitUntil:"load"});
  await guest.locator("#auth-panel").waitFor({state:"visible"});
  assert.equal(await guest.locator("#onboarding-app").isVisible(),false);
  assert.equal(unauthorizedApiCalls,0,"Logged-out browser should not call private onboarding API.");
  const unpaid=await context.newPage();
  await unpaid.route("https://esm.sh/**",script(true));
  await unpaid.route("**/api/onboarding*",route=>route.fulfill({
    status:403,contentType:"application/json",
    body:JSON.stringify({error:"An active, linked Stripe subscription is required."})}));
  await unpaid.goto(origin+"/onboarding.html",{waitUntil:"load"});
  await unpaid.locator("#access-panel").waitFor({state:"visible"});
  assert.equal(await unpaid.locator("#onboarding-app").isVisible(),false);
  assert.match(await unpaid.locator("#access-message").textContent(),/subscription/i);
  assert.deepEqual(errors,[]);
  console.log("CALVREN_CUSTOMER_ONBOARDING_E2E_PASSED: guest/unpaid denial, validation, HTTPS, save/reload, approval and mobile.");
}finally{await browser.close();}
