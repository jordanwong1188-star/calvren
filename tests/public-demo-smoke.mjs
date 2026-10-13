import assert from "node:assert/strict";
import { chromium } from "playwright";

const site=process.env.CALVREN_PUBLIC_SITE || "https://calvren.pages.dev";
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],privateRequests=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>{if(/\/api\/(conversion|operator|leads|demo-access)/.test(r.url()))privateRequests.push(r.url());});
const reply=async message=>{
  await page.locator("#demo-reply-message").fill(message);
  await page.locator("#demo-send").click();
  await page.waitForFunction(()=>document.querySelector("#demo-reply-message")?.value==="");
};
async function runExample(day,label){
  await page.goto(site+"/lead-demo.html",{waitUntil:"networkidle",timeout:30000});
  await page.locator("#demo-start").waitFor({state:"visible",timeout:10000});
  assert.equal(await page.locator("#demo-access-check").isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.calvrenDemoReady),"true");
  await page.locator("#demo-start").click();
  assert.match(await page.locator("#demo-conversation").innerText(),/ABC Plumbing/);
  assert.equal(await page.locator('[data-question-id="service"]').getAttribute("data-answer-status"),"answered");
  await reply("No, it can wait for a routine appointment.");
  await reply("Vancouver");
  await reply(day);
  assert.equal(await page.locator("#demo-lead-status").innerText(),"Booking");
  const offered=await page.locator("#demo-slots button").allTextContents();
  assert.ok(offered.length===3,day+" must have three demo appointments.");
  assert.ok(offered.every(s=>s.startsWith(label+", ")),day+" received incorrect weekday slots: "+offered.join("; "));
  await page.locator("#demo-slots button").first().click();
  assert.equal(await page.locator("#demo-lead-status").innerText(),"Booked");
  assert.match(await page.locator("#demo-appointment").innerText(),/Simulated appointment booked/);
  await page.locator("#demo-sign-out").click();
  assert.equal(await page.locator("#demo-lead-status").innerText(),"Not started");
  return offered.map(value=>value.match(/\\b\\d{1,2}:\\d{2}\\s*[AP]M\\b/)?.[0]||value);
}
try{
  const openings={};
  for(const [day,label] of [["Monday","Mon"],["Tuesday","Tue"],["Wednesday","Wed"],
    ["Thursday","Thu"],["Friday","Fri"],["Saturday","Sat"]]){
    openings[day]=await runExample(day,label);
  }
  assert.equal(new Set(Object.values(openings).map(times=>times.join(","))).size,6,
    "Each business day must offer a different set of times.");
  assert.deepEqual(openings.Friday,["9:00 AM","12:45 PM","3:15 PM"]);
  assert.deepEqual(openings.Thursday,["8:45 AM","12:15 PM","3:00 PM"]);
  await page.goto(site+"/case-studies.html",{waitUntil:"networkidle",timeout:30000});
  const studyText=await page.locator("#workflow-studies").innerText();
  for(const name of ["ShinerBros Window Cleaning","ClearCraft Automotive Detailing","Jacob","Dylan"]) {
    assert.ok(studyText.includes(name),"Missing example business: "+name);
  }
  assert.equal(await page.locator("[data-study]").count(),2);
  assert.deepEqual(errors,[],"No browser JavaScript exceptions.");
  assert.deepEqual(privateRequests,[],"Guest simulation must not use private APIs or even signup APIs.");
  console.log("CALVREN_PUBLIC_DEMO_SMOKE_PASSED: guest response, six distinct weekday slot sets, simulated booking, reset, named studies, no private API.");
}finally{
  await browser.close();
}
