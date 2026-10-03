import assert from "node:assert/strict";
import {mkdir,readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {chromium} from "playwright";
import {checkOwnerWorkspace} from "./admin-browser-check.mjs";

const site=process.env.CALVREN_TEST_SITE || "https://calvren.netlify.app";
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
      assert.ok(await page.locator('a[href="mailto:Jordan.wong1177@gmail.com"]').count()>0);
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
  assert.equal(await page.locator("[data-study]").count(),3);
  assert.match(await page.locator(".study-disclosure").textContent(),/illustrative/i);
  for(const industry of ["real-estate","local-services","professional"]){
    await page.locator('[data-study-filter="'+industry+'"]').click();
    assert.equal(await page.locator("[data-study]:not([hidden])").count(),1);
    assert.equal(await page.locator('[data-study-filter="'+industry+'"]').getAttribute("aria-pressed"),"true");
  }
  await page.locator('[data-study-filter="all"]').click();
  assert.equal(await page.locator("[data-study]:not([hidden])").count(),3);
  assert.equal(await page.locator("#publish-permission").isChecked(),false);
  assert.equal(await page.locator("#publish-permission").getAttribute("required"),null);
  assert.notEqual(await page.locator('[name="feedback-consent"]').getAttribute("required"),null);

  // Intercept every form POST. These are synthetic tests; no actual enquiry or review is stored.
  let postCount=0,postStatus=503,lastBody="";
  const intercept=route=>{
    if(route.request().method()==="POST"&&route.request().url()===site+"/"){
      postCount++;lastBody=route.request().postData()||"";
      return route.fulfill({status:postStatus,contentType:"text/plain",body:"Synthetic browser test"});
    }
    return route.continue();
  };
  await page.route("**/*",intercept);
  for(const config of [
    {path:"/",form:"#contact-form",name:"#contact-name",email:"#contact-email",message:"#contact-message",consent:'[name="consent"]',action:"/thanks.html",formName:"workflow-enquiry"},
    {path:"/contact.html",form:"#project-form",name:"#project-name",email:"#project-email",message:"#project-message",consent:'[name="consent"]',action:"/thanks.html",formName:"project-enquiry"},
    {path:"/case-studies.html",form:"#review-form",name:"#review-name",email:"#review-email",message:"#review-experience",consent:'[name="feedback-consent"]',action:"/review-thanks.html",formName:"client-insight"}
  ]){
    postStatus=503;postCount=0;
    await visit(config.path);
    const form=page.locator(config.form);
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
    assert.equal(postCount,1,config.formName+" must submit once");
    assert.equal(await page.locator(config.name).inputValue(),"Calvren QA");
    assert.equal(await form.locator('button[type="submit"]').isEnabled(),true);
    assert.match(await form.locator("[data-form-error]").textContent(),/Jordan.wong1177@gmail.com/);
    postStatus=200;
    await form.locator('button[type="submit"]').click();
    await page.waitForURL(url=>normalisePath(url.pathname)===normalisePath(config.action));
    assert.equal(postCount,2);
    const values=new URLSearchParams(lastBody);
    assert.equal(values.get("form-name"),config.formName);
    assert.equal(values.get("website"),"");
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
