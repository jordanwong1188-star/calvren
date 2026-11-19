import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=(file)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
test("branded 1200×630 share preview is used consistently on public pages",()=>{
  const file="public/media/calvren-social-preview-2026.jpg";
  const jpg=readFileSync(new URL("../"+file,import.meta.url));
  assert.ok(jpg.byteLength>30000,"Preview image must not be an empty placeholder");
  assert.equal(jpg[0],0xff);assert.equal(jpg[1],0xd8);
  for(const page of ["index.html","ai-receptionist.html","contact.html","privacy.html"]){
    const html=get("public/"+page);
    const link="https://calvren.ca/media/calvren-social-preview-2026.jpg";
    assert.ok(html.includes('property="og:image" content="'+link+'"'),page+" needs share image");
    assert.ok(html.includes('name="twitter:image" content="'+link+'"'),page+" needs Twitter card");
    assert.ok(html.includes('property="og:image:width" content="1200"'),page+" needs 1200 width");
    assert.ok(html.includes('property="og:image:height" content="630"'),page+" needs 630 height");
    assert.ok(html.includes('property="og:image:alt"'),page+" needs alt text");
  }
});
test("AI receptionist is quote-only and never advertises the retired checkout",()=>{
  const page=get("public/ai-receptionist.html"),home=get("public/index.html"),
    billing=get("public/payment.html"),portal=get("public/client-portal.js");
  for(const marker of ["Custom pricing","Fewer missed opportunities","Capture booking requests","Request a custom quote","/contact.html?workflow=ai-receptionist#project-form"]){
    assert.ok((page+" "+home).toLowerCase().includes(marker.toLowerCase()),"Missing "+marker);
  }
  for(const content of [page,home,billing,portal]){
    for(const hidden of ["CA$515","CA$940","/payment?plan=receptionist"]){
      assert.ok(!content.includes(hidden),"Old public price or checkout remains: "+hidden);
    }
  }
  assert.ok(!page.includes("CA$425/month"),"Receptionist must be custom-quoted");
  assert.ok(!billing.includes('data-select-plan="receptionist"'));
  assert.ok(billing.includes("Get a custom AI Receptionist quote"));
  for(const existing of ["CA$275","CA$499","CA$775","CA$150","CA$200","CA$300"])
    assert.ok(home.includes(existing),"Preserve existing pricing "+existing);
  assert.equal((home.match(/class="calvren-tier(?: |")/g)||[]).length,3,"Keep exactly three standard subscriptions");
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
  for(const marketing of [home,page])assert.ok(marketing.includes("/receptionist.css?v=20261117-custom-quote"),"Load updated CSS without stale caching");
});
test("indexed pages have canonical, OG and social preview, and sitemap includes receptionist",()=>{
  for(const path of ["","contact.html","privacy.html","ai-receptionist.html"]){
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
    "Does requesting a quote activate the phone service?"])
    assert.ok(page.includes(question),"Missing FAQ: "+question);
  assert.ok(page.includes("Phone answering starts only after the agreed onboarding"));
  assert.ok(css.includes(".receptionist-faq summary:focus-visible"));
});

test("receptionist enquiry uses existing validated Formspree lead form",()=>{
  const contact=get("public/contact.html"),shared=get("public/shared.js");
  assert.ok(contact.includes('id="project-form"'));
  assert.ok(contact.includes('action="https://formspree.io/f/xrperqkk"'));
  assert.ok(shared.includes('"ai-receptionist"'));
  assert.ok(shared.includes('AI receptionist custom quote request — Calvren'));
  assert.ok(shared.includes('custom quote for Calvren’s AI receptionist'));
  assert.ok(shared.includes('I’m interested in a custom quote for Calvren’s AI receptionist. Please share the pricing and setup options for my business.'));
  assert.ok(!shared.includes('I’d like to discuss our expected call volume'));

  assert.ok(!shared.includes('AI receptionist at CA$425/month'));
  assert.ok(!shared.includes('plus CA$515 setup'));
});
