import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
const base=process.env.CALVREN_LIVE_URL||"https://calvren.pages.dev";
const origin=new URL(base);
if(origin.protocol!=="https:"||origin.hostname!=="calvren.pages.dev")
  throw Error("Audit restricted to official Calvren HTTPS hostname.");
async function request(path,options={}){
  let last;
  for(let i=0;i<3;i++){
    try{return await fetch(base+path,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(18000),...options});}
    catch(e){last=e;if(i<2)await delay(1200);}
  }
  throw last;
}
const pages=[
  ["/","calvren"],["/payment.html","data-select-plan"],
  ["/client.html","client-payment-success"],["/onboarding.html","onboarding-app"],
  ["/onboarding-preview.html","INTERACTIVE SAMPLE"],
  ["/case-studies.html","case"],["/contact.html","contact"],["/privacy.html","privacy"]
];
for(const [path,marker] of pages){
  const r=await request(path);
  assert.equal(r.status,200,"Public page should load: "+path);
  assert.match(r.headers.get("content-type")||"",/text\/html/i,path+" must return HTML");
  const html=await r.text();
  assert.ok(html.toLowerCase().includes(marker.toLowerCase()),"Missing UI marker "+path);
  if(path==="/client.html"){
    assert.ok(html.includes("Thank you for choosing Calvren."));
    assert.ok(html.includes("Complete your onboarding"));
    assert.ok(html.includes('id="client-payment-pending"'));
  }
  if(path==="/payment.html"){
    for(const label of ["CA$99","CA$249","CA$499"])
      assert.ok(html.includes(label),label+" is missing from checkout page");
    for(const tier of ["starter","growth","pro"])
      assert.ok(html.includes('data-select-plan="'+tier+'"'),"Missing "+tier+" option");
  }
  if(path==="/onboarding-preview.html")
    assert.ok(html.includes("NOT A LIVE ACCOUNT"),"Preview must state that it is not a live account");
  console.log("PUBLIC_PAGE_OK",path);
}
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
for(const [tier,amount] of [["starter",9900],["growth",24900],["pro",49900]]){
  assert.equal(config.plans?.[tier]?.ready,true,tier+" live Stripe price unavailable");
  assert.equal(config.plans[tier].amount,amount,tier+" has the wrong price");
}
console.log("LIVE_STRIPE_PRICES_CORRECT");
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
