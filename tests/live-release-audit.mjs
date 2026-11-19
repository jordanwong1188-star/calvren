import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
const base=process.env.CALVREN_LIVE_URL||"https://calvren.pages.dev";
const origin=new URL(base);
if(origin.protocol!=="https:"||!["calvren.pages.dev","calvren.ca"].includes(origin.hostname))
  throw Error("Audit restricted to official Calvren HTTPS hostname.");
async function request(path,options={}){
  let last;
  for(let i=0;i<3;i++){
    try{const response=await fetch(base+path,{redirect:"follow",cache:"no-store",signal:AbortSignal.timeout(18000),...options});
      assert.equal(new URL(response.url).origin,base,"Unexpected cross-origin redirect for "+path);
      return response;}
    catch(e){last=e;if(i<2)await delay(1200);}
  }
  throw last;
}
const pages=[
  ["/","calvren"],["/payment.html","data-select-plan"],["/ai-receptionist.html","Custom pricing"],
  ["/client.html","client-payment-success"],["/onboarding.html","onboarding-app"],
  ["/onboarding-preview.html","INTERACTIVE SAMPLE"],
  ["/contact.html","contact"],["/privacy.html","privacy"]
];
for(const [path,marker] of pages){
  const r=await request(path);
  assert.equal(r.status,200,"Public page should load: "+path);
  assert.match(r.headers.get("content-type")||"",/text\/html/i,path+" must return HTML");
  const html=await r.text();
  assert.ok(html.toLowerCase().includes(marker.toLowerCase()),"Missing UI marker "+path);
  if(["/","/contact.html","/ai-receptionist.html"].includes(path)){
    assert.ok(!html.includes("/case-studies"),"Retired client-story link remains on "+path);
    assert.ok(!html.includes("Client stories"),"Retired client-story navigation remains on "+path);
  }
  if(path==="/") {
    assert.ok(!html.includes("proof-preview")&&!html.includes("ShineBros")&&!html.includes("ClearCraft"),
      "Retired client stories remain on homepage");
    for(const section of ['id="solutions"','id="demo"','id="pricing"'])
      assert.ok(html.includes(section),"Required homepage section missing: "+section);
  }
  if(path==="/client.html"){
    assert.ok(html.includes("Thank you for choosing Calvren."));
    assert.ok(html.includes("Complete your onboarding"));
    assert.ok(html.includes('id="client-payment-pending"'));
  }
  if(path==="/payment.html"){
    for(const label of ["CA$275","CA$499","CA$775"])
      assert.ok(html.includes(label),label+" is missing from checkout page");
    for(const tier of ["starter","growth","pro"])
      assert.ok(html.includes('data-select-plan="'+tier+'"'),"Missing "+tier+" option");
  }
  if(["/","/ai-receptionist.html","/payment.html"].includes(path)){
    assert.ok(!html.includes("CA$425")&&!html.includes("CA$515")&&!html.includes("CA$940"),"Retired receptionist pricing must not be shown on "+path);
    assert.ok(!html.includes("/payment?plan=receptionist"),"Retired checkout link must be removed on "+path);
  }
  if(path==="/ai-receptionist.html")
    assert.ok(html.includes("/contact.html?workflow=ai-receptionist#project-form"),"Receptionist should request a custom quote");
  if(path==="/payment.html")
    assert.ok(!html.includes('data-select-plan="receptionist"'),"Receptionist is not a fixed-price checkout tier");
  if(path==="/onboarding-preview.html")
    assert.ok(html.includes("NOT A LIVE ACCOUNT"),"Preview must state that it is not a live account");
  console.log("PUBLIC_PAGE_OK",path);
}
for(const obsolete of ["/case-studies","/case-studies.html"]){
  const response=await request(obsolete,{redirect:"manual"});
  assert.equal(response.status,301,"Retired page must redirect permanently: "+obsolete);
  assert.equal(new URL(response.headers.get("location")||"",base).pathname,"/",
    "Retired story URLs must lead visitors to the homepage");
}
const sitemap=await request("/sitemap.xml");
assert.equal(sitemap.status,200);
assert.ok(!(await sitemap.text()).includes("case-studies"),"Sitemap should exclude removed stories");
for(const path of ["/favicon.svg","/client-portal.js","/onboarding.js","/billing.css"]){
  const r=await request(path);
  assert.equal(r.status,200,"Static asset unavailable: "+path);
  assert.ok((await r.arrayBuffer()).byteLength>100,"Static asset is empty: "+path);
  console.log("ASSET_OK",path);
}
const publicBilling=await request("/api/billing/public",{headers:{Accept:"application/json"}});
assert.equal(publicBilling.status,200,"Stripe billing public endpoint failed");
const config=await publicBilling.json();
assert.equal(config.ready,true,"Stripe setup is not ready");
assert.equal(config.test_mode,false,"Live checkout must not use Stripe test mode");
assert.equal(config.setup_amount,34900,"Unexpected setup fee");
for(const [tier,amount] of [["starter",27500],["growth",49900],["pro",77500]]){
  assert.equal(config.plans?.[tier]?.ready,true,tier+" live Stripe price unavailable");
  assert.equal(config.plans[tier].amount,amount,tier+" has the wrong price");
}
assert.equal(config.plans.receptionist.checkout,"quote","Receptionist must require a custom quote");
assert.equal(config.plans.receptionist.ready,false,"Receptionist cannot offer fixed-price checkout");
for(const key of ["amount","setup_amount","first_payment"])
  assert.equal(Object.hasOwn(config.plans.receptionist,key),false,"Do not expose fixed receptionist "+key);
console.log("LIVE_STRIPE_PRICES_CORRECT",origin.hostname,JSON.stringify(Object.fromEntries(["starter","growth","pro"].map(p=>[p,config.plans[p].amount]))));
const secured=[
 {path:"/api/billing/me",method:"GET"},
 {path:"/api/billing/checkout",method:"POST",body:'{"plan":"pro"}'},
 {path:"/api/billing/portal",method:"POST"},
 {path:"/api/billing/report",method:"GET"},
 {path:"/api/billing/hub/inbox",method:"GET"},
 {path:"/api/billing/hub/settings",method:"GET"},
 {path:"/api/onboarding",method:"GET"},
 {path:"/api/onboarding",method:"POST",body:'{"form":{}}'},
 {path:"/api/onboarding/approve",method:"POST",body:'{"approved":true}'},
 {path:"/api/onboarding/admin",method:"GET"},
 {path:"/api/ops/summary",method:"GET"},
 {path:"/api/internal/ops-health",method:"GET"},
 {path:"/api/internal/follow-ups",method:"POST"},
 {path:"/api/internal/hub-scheduler",method:"POST"},
 {path:"/api/internal/hub/integration",method:"POST",body:'{"enabled":true}'}
];
for(const {path,method,body} of secured){
  const r=await request(path,{method,headers:{Accept:"application/json",
    ...(body?{"Content-Type":"application/json"}:{})},...(body?{body}:{})});
  assert.ok([401,403].includes(r.status),
    "Unauthorized route failed access check: "+method+" "+path+" status "+r.status);
  assert.match(r.headers.get("content-type")||"",/application\/json/i,
    "Unauthorized endpoint should reject with JSON: "+path);
  const result=await r.json();
  assert.ok(typeof result.error==="string","Protected route should return an error: "+path);
  console.log("UNAUTHENTICATED_ACCESS_BLOCKED",method,path,r.status);
}
const fake=await request("/api/onboarding",{headers:{Authorization:"Bearer invalid-bearer-token"}});
assert.equal(fake.status,401,"Forged bearer token cannot access private onboarding");
console.log("FORGED_BEARER_REJECTED");
console.log("CALVREN_LIVE_READ_ONLY_AUDIT_PASSED");
