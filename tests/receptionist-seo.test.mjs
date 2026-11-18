import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=(file)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
test("AI receptionist offer separates paid setup from call activation",()=>{
  const page=get("public/ai-receptionist.html"),home=get("public/index.html");
  for(const marker of ["CA$425","CA$515","Fewer missed opportunities","Capture booking requests","Subscribe &amp; start setup","Phone answering starts after","/contact.html?workflow=ai-receptionist#project-form"]){
    assert.ok((page+" "+home).toLowerCase().includes(marker.toLowerCase()),"Missing "+marker);
  }
  assert.ok(page.includes('href="/payment?plan=receptionist"'));
  for(const marketing of [home,page]){
    assert.ok(!marketing.includes("200 call minutes"),"Public marketing should focus on benefits, not minute quotas");
    assert.ok(!marketing.includes("CA$0.85"),"Public marketing should not display overage rates");
  }
  for(const existing of ["CA$249","CA$499","CA$775","CA$349"]){assert.ok(home.includes(existing),"Preserve existing pricing "+existing);}
  assert.equal((home.match(/class="calvren-tier(?: |")/g)||[]).length,3,"Keep exactly the existing three subscription cards");
});
test("AI receptionist benefit lists match subscription checkmark styling",()=>{
  const css=get("public/receptionist.css"),home=get("public/index.html"),page=get("public/ai-receptionist.html");
  for(const name of ["receptionist-teaser-price","receptionist-price-card"]){
    assert.ok(css.includes("."+name+" li::before"),"Missing checkmark selector for "+name);
    assert.ok(css.includes("."+name+" ul"),"Missing list selector for "+name);
  }
  assert.ok(css.includes('content:"✓"'),"Use the same checkmark as subscription cards");
  assert.ok(css.includes("color:#326248"),"Match the subscription checkmark colour");
  assert.ok(css.includes("list-style:none"),"Prevent default bullet markers");
  for(const marketing of [home,page])assert.ok(marketing.includes("/receptionist.css?v=20261117-checkmarks"),"Load updated CSS without stale caching");
});
test("indexed pages have canonical, OG and social preview, and sitemap includes receptionist",()=>{
  for(const path of ["","contact.html","case-studies.html","privacy.html","ai-receptionist.html"]){
    const filename=path||"index.html",content=get("public/"+filename);
    const canonical="https://calvren.ca/"+path.replace(/\.html$/, "");
    assert.ok(content.includes(canonical),"Canonical site URL missing "+path);
    assert.ok(content.includes("og:image"),"Missing social image "+path);
    assert.ok(content.includes("twitter:card"),"Missing Twitter metadata "+path);
  }
  assert.ok(get("public/sitemap.xml").includes("https://calvren.ca/ai-receptionist"));
  const ld=get("public/ai-receptionist.html").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld); assert.ok(JSON.parse(ld[1])["@graph"].some(x=>x["@type"]==="Service"));
});
test("receptionist FAQ answers common objections without promising instant voice activation",()=>{
  const page=get("public/ai-receptionist.html"),css=get("public/receptionist.css");
  for(const question of ["Can I keep my existing business phone number?",
    "Will the receptionist automatically book appointments?",
    "What happens when someone needs a person?",
    "Does subscribing activate the phone service immediately?"])
    assert.ok(page.includes(question),"Missing FAQ: "+question);
  assert.ok(page.includes("Phone answering starts only after onboarding"));
  assert.ok(css.includes(".receptionist-faq summary:focus-visible"));
});

test("receptionist enquiry uses existing validated Formspree lead form",()=>{
  const contact=get("public/contact.html"),shared=get("public/shared.js");
  assert.ok(contact.includes('id="project-form"'));
  assert.ok(contact.includes('action="https://formspree.io/f/xrperqkk"'));
  assert.ok(shared.includes('"ai-receptionist"'));
  assert.ok(shared.includes('AI receptionist enquiry — Calvren'));
});
