import assert from "node:assert/strict";
import {mkdir,readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {chromium} from "playwright";
import {checkOwnerWorkspace} from "./admin-browser-check.mjs";

const site=process.env.CALVREN_TEST_SITE || "https://calvren.pages.dev";
const sourcePreview=Boolean(process.env.CALVREN_TEST_SITE);
const version="conversion-v1";
const normalisePath=path=>path.endsWith(".html")?path.slice(0,-5):path.endsWith("/")?path.slice(0,-1):path;
await mkdir("artifacts",{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"],acceptDownloads:true});
const page=await context.newPage();
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
async function visit(path=""){
  const response=await page.goto(site+path,{waitUntil:"networkidle",timeout:30000});
  assert.equal(response.status(),200,path+" must load");
  await page.evaluate(()=>document.fonts.ready);
}
async function screenshot(name,target=page){
  const buffer=await target.screenshot({path:"artifacts/"+name.toLowerCase()+".jpeg",type:"jpeg",quality:65});
  console.log("CALVREN_IMAGE_"+name+":"+buffer.toString("base64"));
}
async function noOverflow(label,width){
  const layout=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
  assert.ok(layout.body<=width+1&&layout.document<=width+1,label+" overflow at "+width+"px: "+JSON.stringify(layout));
}
try{
  // GitHub and Netlify start independently. Check the new deployment, not the previous live site.
  let ready=false;
  for(let attempt=0;attempt<(sourcePreview?1:32);attempt++){
    const responses=await Promise.all(["/","/contact.html","/case-studies.html","/admin.html"].map(path=>context.request.get(site+path)));
    const html=await Promise.all(responses.map(response=>response.text()));
    if(responses.every(response=>response.status()===200)&&html.every(body=>body.includes('name="calvren-version" content="'+version+'"'))){ready=true;break;}
    if(!sourcePreview)await delay(15000);
  }
  assert.ok(ready,"New Netlify deployment was not published within eight minutes.");
  await visit();
  assert.match(await page.title(),/Calvren/);
  assert.equal(await page.locator("#demo-empty").isVisible(),true);
  await screenshot("DESKTOP");

  await page.locator("#run-demo").click();
  assert.match(await page.locator("#lead-intent").textContent(),/Buyer/);
  assert.match(await page.locator("#reply-draft").textContent(),/Hi Jamie/);
  await page.locator("#copy-reply").click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Hi Jamie/);
  const downloadEvent=page.waitForEvent("download");
  await page.locator("#download-result").click();
  const download=await downloadEvent;
  await download.saveAs("artifacts/example-record.json");
  assert.equal(JSON.parse(await readFile("artifacts/example-record.json","utf8")).mode,"example");
  for(const [scenario,intent] of [["local-services",/quote/i],["professional",/Professional/i],["real-estate",/Buyer/i]]){
    await page.locator('[data-scenario="'+scenario+'"]').click();
    assert.equal(await page.locator("#demo-results").isVisible(),false);
    await page.locator("#run-demo").click();
    assert.match(await page.locator("#lead-intent").textContent(),intent);
  }
  await page.locator("#enquiry").fill("I want to sell my property and arrange a valuation.");
  assert.equal(await page.locator("#demo-results").isVisible(),false);
  await page.locator("#run-demo").click();
  assert.match(await page.locator("#lead-intent").textContent(),/Seller/);
  await page.locator("#reset-example").click();
  assert.equal(await page.locator("#demo-results").isVisible(),false);
  await page.locator("#run-demo").click();
  await screenshot("DEMO",page.locator("#demo"));
  const oldHours=await page.locator("#hours-result").textContent();
  await page.locator("#monthly-tasks").focus();
  await page.locator("#monthly-tasks").press("ArrowRight");
  assert.notEqual(await page.locator("#hours-result").textContent(),oldHours);
  await visit("/?scenario=local-services#demo");
  assert.equal(await page.locator('[data-scenario="local-services"]').getAttribute("aria-pressed"),"true");
  await page.locator("#run-demo").click();
  assert.match(await page.locator("#lead-intent").textContent(),/quote/i);

  for(const path of ["/","/contact.html","/case-studies.html"]){
    for(const width of [320,375,768,1440]){
      await page.setViewportSize({width,height:1000});
      await visit(path);
      await noOverflow(path,width);
      assert.ok(await page.locator('a[href="mailto:calvrenautomation@gmail.com"]').count()>0);
      assert.ok(await page.locator('a[href="tel:+12369888283"]').count()>0);
      if(width<=860){
        const toggle=page.locator(".menu-toggle");
        assert.equal(await toggle.isVisible(),true);
        assert.equal(await toggle.getAttribute("aria-expanded"),"false");
        assert.equal(await page.locator("#site-navigation").isVisible(),false);
        await toggle.click();
        assert.equal(await toggle.getAttribute("aria-expanded"),"true");
        assert.equal(await page.locator("#site-navigation").isVisible(),true);
        await page.locator("#site-navigation a").first().focus();
        await page.keyboard.press("Escape");
        assert.equal(await toggle.getAttribute("aria-expanded"),"false");
        assert.equal(await toggle.evaluate(node=>node===document.activeElement),true);
      }else{
        assert.equal(await page.locator("#site-navigation").isVisible(),true);
        assert.equal(await page.locator(".menu-toggle").isVisible(),false);
      }
      if(path==="/"&&width===375)await screenshot("MOBILE");
    }
  }
  await page.setViewportSize({width:375,height:1000});
  await visit();
  await page.locator(".menu-toggle").click();
  const contactLink=page.locator("#site-navigation").getByRole("link",{name:"Contact",exact:true});
  console.log("CALVREN_CONTACT_NAV_HREF "+await contactLink.getAttribute("href"));
  await contactLink.click();
  await page.waitForURL(url=>normalisePath(url.pathname)==="/contact");
  assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"),"false");
  assert.equal(await page.locator('#site-navigation a[aria-current="page"]').textContent(),"Contact");

  await visit("/case-studies.html");
  await page.getByRole("link",{name:/Explore the studies/}).click();
  await page.waitForFunction(()=>{
    const target=document.getElementById("workflow-studies").getBoundingClientRect();
    return target.top>=document.querySelector(".header").getBoundingClientRect().bottom&&target.top<150;
  });
  await page.setViewportSize({width:1440,height:1000});
  await visit("/contact.html");
  await screenshot("CONTACT");
  await visit("/contact.html?workflow=real-estate");
  assert.equal(await page.locator("#project-industry").inputValue(),"Real estate");
  assert.match(await page.locator("#project-message").inputValue(),/property enquiries/i);
  assert.equal(await page.locator('#project-form [name="workflow"]').inputValue(),"real-estate");
  await visit("/case-studies.html");
  await screenshot("STUDIES");
  assert.equal(await page.locator("[data-study]").count(),2);
  assert.match(await page.locator(".study-disclosure").textContent(),/illustrative/i);
  for(const id of ["shine-bros","clear-craft"]){
    assert.match(await page.locator("#"+id+" .example-badge").textContent(),/illustrative workflow/i);
    assert.equal(await page.locator("#"+id+" a.button").getAttribute("href"),"/lead-demo.html");
  }
  for(const industry of ["window-cleaning","auto-detailing"]){
    await page.locator('[data-study-filter="'+industry+'"]').click();
    assert.equal(await page.locator("[data-study]:not([hidden])").count(),1);
    assert.equal(await page.locator('[data-study-filter="'+industry+'"]').getAttribute("aria-pressed"),"true");
  }
  await page.locator('[data-study-filter="all"]').click();
  assert.equal(await page.locator("[data-study]:not([hidden])").count(),2);
  assert.equal(await page.locator("#publish-permission").isChecked(),false);
  assert.equal(await page.locator("#publish-permission").getAttribute("required"),null);
  assert.notEqual(await page.locator('[name="feedback-consent"]').getAttribute("required"),null);

  // Intercept both providers: browser checks must never send test notifications.
  let notificationCount=0,archiveCount=0,providerStatus=503,lastProviderBody="",lastArchiveBody="";
  const endpoint="https://formspree.io/f/xrperqkk";
  const intercept=route=>{
    const request=route.request();
    if(request.method()==="POST"&&request.url()===endpoint){
      notificationCount++;lastProviderBody=request.postData()||"";
      return route.fulfill({status:providerStatus,
        headers:{"Access-Control-Allow-Origin":"*","Content-Type":"application/json"},
        body:JSON.stringify(providerStatus===200?{ok:true}:{error:"Synthetic provider failure"})});
    }
    if(request.method()==="POST"&&request.url()===site+"/"){
      archiveCount++;lastArchiveBody=request.postData()||"";
      return route.fulfill({status:201,contentType:"application/json",body:'{"ok":true}'});
    }
    return route.continue();
  };
  await page.route("**/*",intercept);
  for(const config of [
    {path:"/",form:"#contact-form",name:"#contact-name",email:"#contact-email",message:"#contact-message",consent:'[name="consent"]',action:"/thanks.html",formName:"workflow-enquiry"},
    {path:"/contact.html",form:"#project-form",name:"#project-name",email:"#project-email",message:"#project-message",consent:'[name="consent"]',action:"/thanks.html",formName:"project-enquiry"},
    {path:"/case-studies.html",form:"#review-form",name:"#review-name",email:"#review-email",message:"#review-experience",consent:'[name="feedback-consent"]',action:"/review-thanks.html",formName:"client-insight"}
  ]){
    providerStatus=503;notificationCount=0;archiveCount=0;
    await visit(config.path);
    const form=page.locator(config.form);
    assert.equal(await form.getAttribute("action"),endpoint);
    assert.equal(await form.getAttribute("data-success-url"),config.action);
    await page.locator(config.name).fill("Calvren QA");
    await page.locator(config.email).fill("qa@example.com");
    await page.locator(config.message).fill("Synthetic browser test for preserving feedback and enquiry fields.");
    if(config.formName==="client-insight"){
      await page.locator("#review-company").fill("Synthetic test company");
      await page.locator("#review-workflow").fill("Synthetic test workflow");
    }
    await form.locator(config.consent).check();
    await form.locator('button[type="submit"]').click();
    await form.locator("[data-form-error]").waitFor({state:"visible"});
    assert.equal(notificationCount,1,config.formName+" must submit once");
    assert.equal(archiveCount,0,"Failed Formspree delivery must not be acknowledged as saved.");
    assert.equal(await page.locator(config.name).inputValue(),"Calvren QA");
    assert.equal(await form.locator('button[type="submit"]').isEnabled(),true);
    assert.match(await form.locator("[data-form-error]").textContent(),/calvrenautomation@gmail.com/);
    providerStatus=200;
    await form.locator('button[type="submit"]').click();
    await page.waitForURL(url=>normalisePath(url.pathname)===normalisePath(config.action));
    assert.equal(notificationCount,2);
    assert.equal(archiveCount,1,"The private Calvren archive should receive a backup copy.");
    assert.ok(lastProviderBody.includes('name="form-name"')&&lastProviderBody.includes(config.formName),
      "Formspree must receive form source metadata.");
    assert.ok(lastProviderBody.includes('name="email"')&&lastProviderBody.includes("qa@example.com"),
      "Formspree must receive a reply-to address.");
    assert.ok(lastProviderBody.includes('name="subject"'),"Notifications must identify their form.");
    const values=new URLSearchParams(lastArchiveBody);
    assert.equal(values.get("form-name"),config.formName);
    assert.equal(values.get("formspree-archived"),"yes");
    assert.equal(values.get("website"),"");
    assert.equal(values.get("_gotcha"),"");
    if(config.formName==="client-insight")assert.equal(values.has("publication-permission"),false);
  }
  await page.unroute("**/*",intercept);

  const reduced=await browser.newContext({reducedMotion:"reduce",viewport:{width:375,height:1000}});
  const reducedPage=await reduced.newPage();
  await reducedPage.goto(site+"/case-studies.html",{waitUntil:"networkidle"});
  assert.equal(await reducedPage.locator("[data-reveal]").first().evaluate(node=>getComputedStyle(node).opacity),"1");
  await reduced.close();
  const native=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:1000}});
  const nativePage=await native.newPage();
  for(const path of ["/","/contact.html","/case-studies.html"]){
    await nativePage.goto(site+path,{waitUntil:"networkidle"});
    assert.equal(await nativePage.locator("#site-navigation").isVisible(),true);
    assert.equal(await nativePage.locator("[data-reveal]").first().evaluate(node=>getComputedStyle(node).opacity),"1");
    assert.equal(await nativePage.locator("[data-lead-form]").getAttribute("method"),"POST");
  }
  await native.close();

  // Regression: a signed-in but unpaid customer must be able to reach Stripe directly
  // from the client dashboard. Mock providers to avoid any actual payment or email.
  const unpaidContext=await browser.newContext();
  let checkoutRequests=0;
  await unpaidContext.route("https://esm.sh/@supabase/supabase-js@2.57.0",route=>route.fulfill({
    status:200,contentType:"text/javascript",
    headers:{"Access-Control-Allow-Origin":"*"},
    body:'export function createClient(){const user={email:"fixture@example.com"};return {auth:{getSession:async()=>({data:{session:{user,access_token:"fixture-auth-token"}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}'
  }));
  await unpaidContext.route("**/api/billing/*",route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/api/billing/public")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({ready:true,amount:9900,setup_amount:34900,first_payment:44800,currency:"cad",interval:"month",interval_count:1,test_mode:false})});
    if(url.pathname==="/api/billing/me")return route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({email:"fixture@example.com",paid:false,status:"none",activation:"pending"})});
    if(url.pathname==="/api/billing/checkout"){
      checkoutRequests++;
      assert.equal(route.request().headers().authorization,"Bearer fixture-auth-token");
      assert.equal(route.request().method(),"POST");
      return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({url:"https://checkout.stripe.com/c/pay/cs_test_synthetic_unpaid"})});
    }
    return route.abort();
  });
  await unpaidContext.route("https://checkout.stripe.com/**",route=>route.fulfill({status:200,
    contentType:"text/html",body:"<title>Synthetic Stripe Checkout</title>"}));
  const unpaidPage=await unpaidContext.newPage();
  await unpaidPage.goto(site+"/client.html",{waitUntil:"domcontentloaded"});
  await unpaidPage.locator("#client-checkout").waitFor({state:"visible"});
  assert.equal(await unpaidPage.locator("#client-checkout").isEnabled(),true);
  assert.equal(await unpaidPage.locator("#client-membership-status").textContent(),"No subscription yet");
  await unpaidPage.locator("#client-checkout").click();
  await unpaidPage.waitForURL(url=>url.hostname==="checkout.stripe.com");
  assert.equal(checkoutRequests,1,"The dashboard must open Stripe Checkout without a payment/dashboard loop");
  // The UI must never claim Checkout is live while the backend is missing its keys.
  await unpaidContext.route("**/api/billing/public",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify({ready:false,message:"Subscription checkout is being configured."})
  }));
  await unpaidPage.goto(site+"/payment.html",{waitUntil:"domcontentloaded"});
  await unpaidPage.waitForFunction(()=>
    document.getElementById("billing-price-note")?.textContent.includes("temporarily unavailable"));
  assert.match(await unpaidPage.locator("#billing-price-note").textContent(),/temporarily unavailable/);
  assert.doesNotMatch(await unpaidPage.locator("#billing-first-payment").textContent(),/not yet active/i);
  assert.equal(await unpaidPage.locator("#billing-checkout").isDisabled(),true);
  await unpaidContext.close();

  // Regression: password-first auth plus existing-user migration, all mocked.
  const accountContext=await browser.newContext();
  await accountContext.route("https://esm.sh/@supabase/supabase-js@2.57.0",route=>route.fulfill({
    status:200,contentType:"text/javascript",headers:{"Access-Control-Allow-Origin":"*"},
    body:`export function createClient(){
      globalThis.__calvrenAuthCalls=[];
      const record=(kind,payload)=>globalThis.__calvrenAuthCalls.push({kind,payload});
      return {auth:{
        getSession:async()=>({data:{session:null}}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
        signUp:async(payload)=>{record("signup",{email:payload.email,passwordLength:payload.password.length});return {data:{session:null},error:null};},
        signInWithPassword:async(payload)=>{record("password",{email:payload.email});return {error:{message:"Synthetic credentials are not valid"}};},
        resetPasswordForEmail:async(email,options)=>{record("reset",{email,redirectTo:options.redirectTo});return {error:null};},
        signInWithOtp:async(payload)=>{record("legacy",{email:payload.email,shouldCreateUser:payload.options.shouldCreateUser});return {error:null};}
      }};}`
  }));
  await accountContext.route("**/api/billing/public",route=>route.fulfill({
    status:200,contentType:"application/json",body:'{"ready":false}'
  }));
  const accountPage=await accountContext.newPage();
  await accountPage.goto(site+"/client.html",{waitUntil:"domcontentloaded"});
  await accountPage.locator("#client-login").waitFor({state:"visible"});
  assert.equal(await accountPage.locator("#client-signup").isVisible(),false);
  await accountPage.locator('[data-auth-view="signup"]').first().click();
  assert.equal(await accountPage.locator("#client-signup").isVisible(),true);
  await accountPage.locator("#signup-email").fill("new@example.com");
  assert.equal(await accountPage.locator("#signup-password").getAttribute("minlength"),"8");
  assert.equal(await accountPage.locator("#new-client-password").getAttribute("minlength"),"8");
  await accountPage.locator("#signup-password").fill("Seven77");
  await accountPage.locator("#signup-password-confirm").fill("Seven77");
  assert.equal(await accountPage.locator("#signup-password").evaluate(node=>node.checkValidity()),false,
    "Signup must reject 7 characters in the browser");
  await accountPage.locator("#signup-password").fill("Eight123");
  await accountPage.locator("#signup-password-confirm").fill("Eight123");
  await accountPage.locator("#client-signup button[type=submit]").click();
  await accountPage.waitForFunction(()=>globalThis.__calvrenAuthCalls?.some(x=>x.kind==="signup"));
  assert.match(await accountPage.locator("#client-notice").textContent(),/confirmation link/i);
  await accountPage.locator('[data-auth-view="reset"]').click();
  await accountPage.locator("#reset-email").fill("new@example.com");
  await accountPage.locator("#client-reset button[type=submit]").click();
  await accountPage.waitForFunction(()=>globalThis.__calvrenAuthCalls?.some(x=>x.kind==="reset"));
  await accountPage.locator('#client-reset [data-auth-view="signin"]').click();
  await accountPage.locator('#client-login [data-auth-view="legacy"]').click();
  await accountPage.locator("#legacy-email").fill("old@example.com");
  await accountPage.locator("#client-legacy button[type=submit]").click();
  await accountPage.waitForFunction(()=>globalThis.__calvrenAuthCalls?.some(x=>x.kind==="legacy"));
  const calls=await accountPage.evaluate(()=>globalThis.__calvrenAuthCalls);
  assert.equal(calls.find(x=>x.kind==="signup").payload.passwordLength,8);
  assert.equal(calls.find(x=>x.kind==="reset").payload.redirectTo,"https://calvren.pages.dev/client");
  assert.equal(calls.find(x=>x.kind==="legacy").payload.shouldCreateUser,false);
  await accountContext.close();

  // Simulate successful password sign-in with a fresh user session, and confirm
  // the success message remains visible outside the now-hidden sign-in panel.
  const signedInContext=await browser.newContext();
  await signedInContext.route("https://esm.sh/@supabase/supabase-js@2.57.0",route=>route.fulfill({
    status:200,contentType:"text/javascript",headers:{"Access-Control-Allow-Origin":"*"},
    body:`export function createClient(){
      let session=null;
      return {auth:{
        getSession:async()=>({data:{session}}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
        signInWithPassword:async({email,password})=>{
          if(email==="returning@example.com"&&password==="Eight123"){
            session={access_token:"fixture-auth-token",user:{email}};
            return {data:{session},error:null};
          }
          return {error:{message:"Invalid login credentials"}};
        },
        updateUser:async({password})=>({data:{user:session.user},error:password.length>=8?null:{message:"Too short"}})
      }};}`
  }));
  await signedInContext.route("**/api/billing/public",route=>route.fulfill({
    status:200,contentType:"application/json",body:'{"ready":true,"amount":9900,"setup_amount":34900,"first_payment":44800,"currency":"cad","interval":"month","test_mode":false}'
  }));
  await signedInContext.route("**/api/billing/me",route=>route.fulfill({
    status:200,contentType:"application/json",body:'{"paid":false,"status":"none","activation":"pending"}'
  }));
  const signedInPage=await signedInContext.newPage();
  await signedInPage.goto(site+"/client.html",{waitUntil:"domcontentloaded"});
  await signedInPage.locator("#client-email").fill("returning@example.com");
  await signedInPage.locator("#client-password").fill("Eight123");
  await signedInPage.locator("#client-login button[type=submit]").click();
  await signedInPage.locator("#signedin-account").waitFor({state:"visible"});
  await signedInPage.waitForFunction(()=>document.querySelector("#client-notice")?.textContent.includes("Signed in"));
  assert.equal(await signedInPage.locator("#auth-panel").isVisible(),false);
  assert.equal(await signedInPage.locator("#client-notice").isVisible(),true);
  assert.match(await signedInPage.locator("#client-notice").textContent(),/Signed in/i);
  assert.equal(await signedInPage.locator("#client-checkout").isEnabled(),true);
  await signedInPage.locator("#client-password-toggle").click();
  await signedInPage.locator("#new-client-password").fill("Eight123");
  await signedInPage.locator("#new-client-password-confirm").fill("Eight123");
  await signedInPage.locator("#client-new-password button[type=submit]").click();
  await signedInPage.waitForFunction(()=>document.querySelector("#client-notice")?.textContent.includes("Password saved"));
  assert.equal(await signedInPage.locator("#client-notice").isVisible(),true);
  await signedInContext.close();
  await visit("/onboarding.html");
  assert.equal(await page.locator("#signin").count(),0);
  assert.equal(await page.locator('#auth-panel a[href="/client.html?next=onboarding"]').count(),1);

  for(const path of ["/privacy.html","/thanks.html","/review-thanks.html","/404.html","/shared.js","/app.js","/styles.css","/sitemap.xml"]){
    const asset=await context.request.get(site+path);
    assert.equal(asset.status(),200,path+" must load");
  }
  const missing=await context.request.get(site+"/this-page-does-not-exist");
  assert.equal(missing.status(),404);
  if(!sourcePreview){
  for(const [path,method] of [["/api/status","GET"],["/api/leads","GET"],["/api/workflow","POST"]]){
    const api=await context.request.fetch(site+path,{method,...(method==="POST"?{data:{}}:{})});
    assert.ok([401,503].includes(api.status()),path+" must require configuration/authentication");
    const json=await api.json();
    assert.equal(typeof json.error,"string");
    assert.ok(!("leads" in json)&&!("lead" in json));
    console.log("CALVREN_API_CHECK "+path+" "+api.status());
  }
  const eventProbe=await context.request.post(site+"/.netlify/functions/submission-created",{data:{payload:{id:"qa-auth-boundary-check",form_name:"not-a-lead",data:{}}}});
  assert.ok([401,403,404].includes(eventProbe.status()),"Native form event must reject external HTTP invocation; received "+eventProbe.status());
  console.log("CALVREN_EVENT_BOUNDARY_CHECK "+eventProbe.status());
  await visit("/admin.html");
  assert.equal(await page.locator("#workspace").isVisible(),false);
  await page.locator("#admin-token").fill("x".repeat(64));
  await page.locator('#auth-form button[type="submit"]').click();
  await page.waitForFunction(()=>!/Connecting/.test(document.getElementById("auth-status").textContent));
  assert.equal(await page.locator("#workspace").isVisible(),false);
  }
  await checkOwnerWorkspace({page,site,screenshot});
  assert.deepEqual(errors,[]);
  console.log(sourcePreview ? "CALVREN_SOURCE_CHECKS_PASSED: existing marketing pages, forms, examples and protected inbox checked against current source." : "CALVREN_LIVE_CHECKS_PASSED: existing marketing pages, forms, examples and protected inbox checked on the published site.");
}finally{await browser.close();}
