import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { newDemoClient } from "../public/conversion/demo-config.mjs";

const baseUrl = process.env.CALVREN_PREVIEW_URL || "http://127.0.0.1:8080";
const fakeToken = "calvren-browser-fixture-token-no-real-secret-12345678";

const demoAccessId="12345678-1234-4123-8123-123456789abc";
const demoStorageKey="calvren-demo-access-v2";
async function mockDemoAccess(page, requests=[], state={failed:false,promotion:"not_requested"}){
  await page.route("**/api/demo-access",async route=>{
    const request=route.request();requests.push({body:request.postData(),path:new URL(request.url()).pathname});
    await route.fulfill({status:state.failed?503:201,contentType:"application/json",body:JSON.stringify(state.failed?{error:"Unavailable"}:{ok:true,id:demoAccessId,demo_url:"/lead-demo.html",promotion:state.promotion})});
  });
}
export async function checkDemoAccounts(page,url=baseUrl){
  const requests=[],state={failed:false,promotion:"not_requested"},authRequests=[];
  page.on("request",request=>{if(request.url().includes("/auth/v1/"))authRequests.push(request.url());});
  await mockDemoAccess(page,requests,state);
  await page.goto(url+"/lead-demo.html");await page.waitForURL(url=>/^\/try-demo(?:\.html)?\/?$/.test(url.pathname));
  await page.locator(".demo-access-dialog").waitFor({state:"visible"});
  await assertNoOverflow(page,375);await page.keyboard.press("Escape");
  assert.equal(await page.locator(".demo-access-dialog").isVisible(),false);
  await page.goto(url+"/");
  assert.equal(await page.locator(".hero-actions [data-demo-access]").getAttribute("href"),"/try-demo.html");
  assert.equal(await page.locator("#site-navigation [data-demo-access]").getAttribute("href"),"/try-demo.html");
  await page.locator(".hero-actions [data-demo-access]").click();
  assert.match(await page.locator("#demo-access-title").innerText(),/Serious about/);
  assert.equal(await page.locator("#demo-promo-consent").isChecked(),false);
  assert.equal(await page.locator("#demo-promo-consent").getAttribute("required"),null);
  await page.locator("#demo-access-email").fill("visitor@example.com");state.failed=true;
  await page.locator("#demo-access-form button").click();
  await page.waitForFunction(()=>document.querySelector(".demo-access-status").textContent.includes("couldn’t save"));
  assert.equal(await page.locator("#demo-open-link").isVisible(),false);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),demoStorageKey),null);
  state.failed=false;await page.locator("#demo-access-form button").click();
  await page.locator("#demo-open-link").waitFor({state:"visible"});
  assert.equal(new URL(page.url()).pathname,"/","The visitor chooses the on-page demo link.");
  assert.equal(JSON.parse(requests.at(-1).body).email,"visitor@example.com");
  assert.equal(JSON.parse(requests.at(-1).body).promotional_consent,false);
  await page.locator("#demo-open-link").click();await page.waitForURL(url=>/^\/lead-demo(?:\.html)?\/?$/.test(url.pathname));
  await page.locator("#demo-start").waitFor({state:"visible"});
  assert.equal(await page.locator("#demo-access-check").isVisible(),false);
  await page.locator("#demo-sign-out").click();await page.waitForURL(url=>/^\/try-demo(?:\.html)?\/?$/.test(url.pathname));
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),demoStorageKey),null);
  await page.locator("#demo-access-email").fill("visitor@example.com");
  await page.locator("#demo-promo-consent").check();state.promotion="unavailable";
  await page.locator("#demo-access-form button").click();await page.locator("#demo-open-link").waitFor({state:"visible"});
  assert.equal(JSON.parse(requests.at(-1).body).promotional_consent,true);
  assert.match(await page.locator(".demo-access-status").innerText(),/temporarily unavailable/);
  await page.locator("#demo-open-link").click();await page.waitForURL(url=>/^\/lead-demo(?:\.html)?\/?$/.test(url.pathname));
  await page.locator("#demo-sign-out").click();await page.waitForURL(url=>/^\/try-demo(?:\.html)?\/?$/.test(url.pathname));
  await page.goto(url+"/try-demo.html#access_token=obsolete-link&expires_in=3600");
  await page.locator(".demo-access-dialog").waitFor({state:"visible"});
  assert.equal(await page.evaluate(()=>location.hash),"");
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),demoStorageKey),null);
  assert.deepEqual(authRequests,[],"Instant demo access must never use email authentication.");
  console.log("Demo email capture passed: immediate on-page link, optional consent, failed-submit retry, promo failure fallback, local access clearing and no Auth requests.");
}

const responses = {service:"Leak repair",emergency:"No, it can wait for a routine appointment.",area:"Vancouver",timing:"Tomorrow, please."};
async function reply(page, message) {
  await page.locator("#demo-reply-message").fill(message);
  await page.locator("#demo-send").click();
  await page.waitForFunction(() => document.getElementById("demo-action-status").textContent.includes("Saved in this demo") ||
    document.getElementById("demo-action-status").textContent.includes("Automation is paused") ||
    document.getElementById("demo-action-status").textContent.includes("customer opted out"));
  await page.locator("#demo-send").waitFor({state:"visible"});
  assert.equal(await page.locator("#demo-send").isEnabled(), true);
}
async function startLead(page) {
  await page.locator("#demo-start").click();
  await page.waitForFunction(() => document.querySelectorAll("#demo-conversation .conversation-message").length >= 2 &&
    document.getElementById("demo-intake-status").textContent.includes("Saved in this demo"));
}
async function assertNoOverflow(page, width) {
  await page.setViewportSize({width,height:880});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
    "The conversion page should fit the mobile viewport.");
}
export async function checkLeadDemo(page, url = baseUrl) {
  const failures = [];
  const providerRequests = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("request", request => {
    if (/api\.openai\.com|api\.twilio\.com|www\.googleapis\.com\/calendar|oauth2\.googleapis\.com|\/api\/conversion/.test(request.url())) {
      providerRequests.push(request.url());
    }
  });
  await mockDemoAccess(page);
  await page.addInitScript(id => sessionStorage.setItem("calvren-demo-access-v2", JSON.stringify({
    version:2,submission_id:id,expires_at:Date.now()+86400000
  })), demoAccessId);
  await page.goto(url + "/lead-demo.html", {waitUntil:"networkidle"});
  await page.locator("#demo-config").waitFor({state:"attached"});
  assert.match(await page.locator(".simulation-banner").innerText(), /rules-based demo responder/);
  await startLead(page);
  assert.match(await page.locator("#demo-conversation").innerText(), /ABC Plumbing/);
  assert.equal(await page.locator('[data-question-id="service"]').getAttribute("data-answer-status"), "answered");
  for (let attempt = 0; attempt < 5; attempt++) {
    const missing = await page.locator('#demo-qualification [data-answer-status="missing"]').evaluateAll(nodes =>
      nodes.map(node => node.dataset.questionId));
    if (!missing.length) break;
    assert.ok(responses[missing[0]], "The demo asks configured required questions.");
    await reply(page, responses[missing[0]]);
  }
  assert.equal(await page.locator("#demo-qualification-status").innerText(), "Qualified");
  assert.equal(await page.locator("#demo-lead-status").innerText(), "Booking");
  assert.ok(await page.locator("#demo-slots button").count() > 0, "The qualified lead receives actual stored mock slots.");
  await page.locator("#demo-slots button").first().click();
  await page.waitForFunction(() => document.getElementById("demo-lead-status").textContent === "Booked");
  assert.match(await page.locator("#demo-appointment").innerText(), /Simulated appointment booked/);
  assert.equal(await page.locator('#demo-notifications [data-event="booked"]').count(), 1);
  assert.equal(await page.locator('#demo-notifications [data-event="qualified"]').count(), 1);
  assert.ok(await page.locator("#demo-conversation .conversation-message").count() >= 10, "The entire conversation remains visible.");
  assert.equal(await page.locator("#demo-export").isEnabled(), true);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#demo-export").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "calvren-fake-lead-example.json");
  await page.locator("#demo-reset").click();
  await startLead(page);
  const assistantBeforeStop = await page.locator("#demo-conversation .assistant").count();
  await reply(page, "STOP");
  assert.equal(await page.locator("#demo-automation-status").innerText(), "Opted out");
  assert.equal(await page.locator("#demo-conversation .assistant").count(), assistantBeforeStop,
    "An opt-out must not cause another autonomous reply.");
  assert.equal(await page.locator("#demo-resume-panel").isVisible(), false);
  assert.equal(await page.locator("#demo-followup").isVisible(), false);
  await reply(page, "I still have a question");
  assert.equal(await page.locator("#demo-conversation .assistant").count(), assistantBeforeStop);
  await page.locator("#demo-reset").click();
  await startLead(page);
  await page.locator("#demo-handoff").click();
  await page.waitForFunction(() => document.getElementById("demo-automation-status").textContent === "Paused for a person");
  assert.equal(await page.locator("#demo-resume-panel").isVisible(), true);
  assert.equal(await page.locator("#demo-resume").isEnabled(), false);
  await page.locator("#demo-resume-consent").check();
  await page.locator("#demo-resume").click();
  await page.waitForFunction(() => document.getElementById("demo-automation-status").textContent === "Active");
  // Dynamic configuration changes the company and qualifying questions without changing the engine.
  await page.locator("#demo-config-form").evaluate(form => form.closest("details").open = true);
  const config = JSON.parse(await page.locator("#demo-config").inputValue());
  config.business_name = "Maple Property Advisory";
  config.services = ["Property consultation"];
  config.qualifying_questions = [
    {id:"service",prompt:"What property service do you need?",required:true},
    {id:"goal",prompt:"What is your property goal?",required:true}
  ];
  await page.locator("#demo-config").fill(JSON.stringify(config));
  await page.locator("#demo-config-form button").click();
  await page.locator("#demo-message").fill("I would like a property consultation.");
  await startLead(page);
  assert.match(await page.locator("#demo-conversation").innerText(), /Maple Property Advisory/);
  assert.equal(await page.locator('[data-question-id="goal"]').count(), 1);
  await page.locator("#demo-config").fill(JSON.stringify(newDemoClient()));
  await page.locator("#demo-config-form button").click();
  await page.locator("#demo-message").fill("Hi, my kitchen sink is leaking and I need someone to look at it.");
  await startLead(page);
  for (const id of ["emergency","area","timing"]) await reply(page, responses[id]);
  await page.locator("#demo-slots button").first().click();
  await page.waitForFunction(() => document.getElementById("demo-lead-status").textContent === "Booked");
  await assertNoOverflow(page, 320);
  await assertNoOverflow(page, 375);
  assert.deepEqual(providerRequests, [], "The browser demo cannot contact any live provider or server automation endpoint.");
  assert.deepEqual(failures, []);
}
function makeBundle(client) {
  const stamp = "2026-10-03T00:00:00.000Z";
  const lead = {id:"fixture-lead-1",client_id:client.id,name:"<img src=x onerror=alert(1)>",
    phone:"+15555550101",email:"alex@example.com",original_message:"My sink is leaking.",source:"fixture",created_at:stamp,updated_at:stamp,
    status:"responding",qualification_status:"pending",appointment_status:"none",last_contacted_at:stamp,last_inbound_at:stamp,
    next_follow_up_at:stamp,follow_up_attempts:0,answers:{service:"Leak repair"},offered_slots:[],
    automation_active:true,consent_sms:true,opted_out:false,mode:"demo",channel:"website",version:1,handoff_reason:null};
  return {lead,messages:[
    {id:"fixture-message-1",lead_id:lead.id,client_id:client.id,sender:"lead",message:"<script>alert('unsafe')</script>",
      channel:"website",timestamp:stamp,ai:false,status:"received",provider_id:null,idempotency_key:"fixture-message-1"},
    {id:"fixture-message-2",lead_id:lead.id,client_id:client.id,sender:"assistant",message:"Is this an emergency?",
      channel:"website",timestamp:stamp,ai:true,status:"sent",provider_id:"demo-fixture",idempotency_key:"fixture-message-2"}
  ],appointments:[],notifications:[]};
}
export async function checkConversionOperator(page, url = baseUrl) {
  const failures = [];
  const requests = [];
  let client = newDemoClient();
  let bundle = makeBundle(client);
  let rejectAccess = false;
  let keyRequestCount = 0;
  let releaseKeyResponse;
  let resolveKeySeen;
  const keySeen = new Promise(resolve => { resolveKeySeen = resolve; });
  page.on("pageerror", error => failures.push(error.message));
  await page.route("**/api/conversion/**", async route => {
    const request = route.request();
    requests.push({url:request.url(),method:request.method(),authorization:request.headers().authorization});
    const path = new URL(request.url()).pathname.replace("/api/conversion", "");
    const method = request.method();
    let data = {ok:true};
    let responseStatus = 200;
    if (rejectAccess || request.headers().authorization !== "Bearer " + fakeToken) {
      data = {ok:false,error:"Operator access was refused."};
      responseStatus = 401;
    } else if (path === "/status") {
      data = {ok:true,readiness:{database:true,admin:true,mode:"demo",production:false,
        providers:{openai:false,twilio:false,google:false,notifications:false},server_demo:true,browser_demo:true,issues:["Demo mode."]}};
    } else if (path === "/clients" && method === "GET") data = {ok:true,clients:[client]};
    else if (path === "/clients" && method === "POST") {client = request.postDataJSON();data = {ok:true,client};}
    else if (path === "/clients/" + client.id && method === "PUT") {client = request.postDataJSON();data = {ok:true,client};}
    else if (path === "/clients/" + client.id + "/key") {
      keyRequestCount++;
      await new Promise(resolve => { releaseKeyResponse = resolve; resolveKeySeen(); });
      data = {ok:true,key:"fixture-intake-key-show-once-only",client_id:client.id};
    }
    else if (path === "/leads" && method === "GET") data = {ok:true,leads:[bundle]};
    else if (path === "/leads/" + bundle.lead.id && method === "GET") data = {ok:true,bundle};
    else if (path === "/leads/" + bundle.lead.id + "/handoff") {
      bundle.lead.automation_active = false;bundle.lead.status = "needs_human";bundle.lead.handoff_reason = "Operator review";
      data = {ok:true,bundle};
    } else if (path === "/leads/" + bundle.lead.id + "/resume") {
      bundle.lead.automation_active = true;bundle.lead.status = "responding";bundle.lead.handoff_reason = null;
      data = {ok:true,bundle};
    } else if (path === "/leads/" + bundle.lead.id + "/reply") {
      const body = request.postDataJSON();
      bundle.messages.push({id:"fixture-reply-3",lead_id:bundle.lead.id,client_id:client.id,sender:"lead",
        message:body.message,channel:"website",timestamp:new Date().toISOString(),ai:false,status:"received",
        provider_id:null,idempotency_key:body.event_key});
      data = {ok:true,bundle};
    } else {data = {ok:false,error:"Unexpected fixture route: " + method + " " + path};responseStatus = 404;}
    await route.fulfill({status:responseStatus,contentType:"application/json",body:JSON.stringify(data)});
  });
  await page.goto(url + "/operator.html", {waitUntil:"networkidle"});
  assert.equal(await page.locator("#operator-workspace").isVisible(), false);
  await page.locator("#operator-token").fill(fakeToken);
  await page.locator("#operator-auth button[type=submit]").click();
  await page.locator(".operator-lead-button").waitFor();
  assert.equal(await page.locator("#operator-token").inputValue(), "");
  assert.equal(await page.evaluate(token => [...Object.values(localStorage),...Object.values(sessionStorage)].some(value => value.includes(token)), fakeToken), false);
  await page.locator(".operator-lead-button").first().click();
  await page.locator("#operator-detail-content").waitFor({state:"visible"});
  assert.equal(await page.locator("#operator-detail-name").innerText(), "<img src=x onerror=alert(1)>");
  assert.equal(await page.locator("#operator-detail-name img").count(), 0);
  assert.equal(await page.locator("#operator-conversation script").count(), 0);
  assert.match(await page.locator("#operator-conversation").innerText(), /<script>alert\('unsafe'\)<\/script>/);
  await page.locator("#operator-handoff").click();
  await page.waitForFunction(() => document.getElementById("operator-detail-status").textContent === "Needs human");
  assert.equal(await page.locator("#operator-resume").isEnabled(), false);
  await page.locator("#operator-resume-confirm").check();
  await page.locator("#operator-resume").click();
  await page.waitForFunction(() => document.getElementById("operator-detail-automation").textContent === "Active");
  await page.locator("#operator-reply-message").fill("No, it can wait.");
  await page.locator("#operator-reply button").click();
  await page.waitForFunction(() => document.getElementById("operator-action-status").textContent.includes("Demo reply saved"));
  assert.match(await page.locator("#operator-conversation").innerText(), /No, it can wait/);
  await page.locator("#operator-client-editor-select").selectOption(client.id);
  const config = JSON.parse(await page.locator("#operator-client-config").inputValue());
  config.business_name = "ABC Plumbing Fixture Updated";
  await page.locator("#operator-client-config").fill(JSON.stringify(config));
  await page.locator("#operator-save-client").click();
  await page.waitForFunction(() => document.getElementById("operator-client-status").textContent === "Business configuration saved.");
  assert.match(await page.locator("#operator-client-filter").innerText(), /Fixture Updated/);
  await page.locator("#operator-key-controls").evaluate(node => node.open = true);
  await page.locator("#operator-key-confirm").check();
  await page.locator("#operator-key-rotate").click();
  await keySeen;
  assert.equal(await page.locator("#operator-key-rotate").isEnabled(), false);
  await page.locator("#operator-key-rotate").evaluate(button => button.dispatchEvent(new MouseEvent("click", {bubbles:true})));
  assert.equal(keyRequestCount, 1, "A repeated key-rotation click cannot invalidate the key that is still being returned.");
  releaseKeyResponse();
  await page.locator("#operator-key-box").waitFor({state:"visible"});
  assert.equal(await page.locator("#operator-key-value").innerText(), "fixture-intake-key-show-once-only");
  assert.equal(await page.locator("#operator-key-rotate").isEnabled(), true);
  await page.locator("#operator-key-hide").click();
  assert.equal(await page.locator("#operator-key-value").innerText(), "");
  await assertNoOverflow(page,320);
  await assertNoOverflow(page,375);
  await page.locator("#operator-disconnect").click();
  assert.equal(await page.locator("#operator-workspace").isVisible(), false);
  assert.equal(await page.locator("#operator-conversation").innerText(), "");
  assert.equal(await page.locator("#operator-detail-name").innerText(), "");
  assert.equal(await page.locator("#operator-client-config").inputValue(), "");
  rejectAccess = true;
  await page.locator("#operator-token").fill(fakeToken);
  await page.locator("#operator-auth button[type=submit]").click();
  await page.waitForFunction(() => document.getElementById("operator-auth-status").textContent.includes("Access") ||
    document.getElementById("operator-auth-status").textContent.includes("access"));
  assert.equal(await page.locator("#operator-workspace").isVisible(), false);
  assert.equal(await page.locator("#operator-token").inputValue(), "");
  assert.ok(requests.length >= 10);
  assert.equal(requests.every(request => request.authorization === "Bearer " + fakeToken), true);
  assert.deepEqual(failures, []);
}
async function main() {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1360,height:960},reducedMotion:"reduce"});
  try {
    const accountPage = await context.newPage();
    await checkDemoAccounts(accountPage);
    await accountPage.close();
    const demoPage = await context.newPage();
    await checkLeadDemo(demoPage);
    await mkdir("artifacts", {recursive:true});
    await demoPage.setViewportSize({width:1360,height:960});
    const desktop = await demoPage.screenshot({path:"artifacts/conversion-demo-desktop.jpg",fullPage:true,type:"jpeg",quality:68});
    console.log("CALVREN_IMAGE_CONVERSION_DESKTOP=" + desktop.toString("base64"));
    await demoPage.setViewportSize({width:375,height:880});
    const mobile = await demoPage.screenshot({path:"artifacts/conversion-demo-mobile.jpg",fullPage:true,type:"jpeg",quality:64});
    console.log("CALVREN_IMAGE_CONVERSION_MOBILE=" + mobile.toString("base64"));
    const operatorPage = await context.newPage();
    await checkConversionOperator(operatorPage);
    console.log("Conversion browser checks passed: reusable demo qualification and booking, history and notifications, STOP/handoff/resume, protected operator fixtures, escaped client content, memory-only tokens, and 320/375px layouts.");
  } finally {
    await context.close();
    await browser.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
