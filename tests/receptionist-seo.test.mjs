import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=(file)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
test("AI receptionist offer is distinct, not a working checkout",()=>{
  const page=get("public/ai-receptionist.html"),home=get("public/index.html");
  for(const marker of ["CA$350","CA$515","Fewer missed opportunities","Capture booking requests","coming soon","not operational yet","/contact.html?workflow=ai-receptionist#project-form"]){
    assert.ok((page+" "+home).toLowerCase().includes(marker.toLowerCase()),"Missing "+marker);
  }
  assert.ok(!page.includes('href="/payment.html?plan=receptionist"'));
  for(const marketing of [home,page]){
    assert.ok(!marketing.includes("200 call minutes"),"Public marketing should focus on benefits, not minute quotas");
    assert.ok(!marketing.includes("CA$0.85"),"Public marketing should not display overage rates");
  }
  for(const existing of ["CA$249","CA$499","CA$775","CA$349"]){assert.ok(home.includes(existing),"Preserve existing pricing "+existing);}
  assert.equal((home.match(/class="calvren-tier(?: |")/g)||[]).length,3,"Keep exactly the existing three subscription cards");
});
test("indexed pages have canonical, OG and social preview, and sitemap includes receptionist",()=>{
  for(const path of ["","contact.html","case-studies.html","privacy.html","ai-receptionist.html"]){
    const filename=path||"index.html",content=get("public/"+filename);
    const canonical="https://calvren.ca/"+path;
    assert.ok(content.includes(canonical),"Canonical site URL missing "+path);
    assert.ok(content.includes("og:image"),"Missing social image "+path);
    assert.ok(content.includes("twitter:card"),"Missing Twitter metadata "+path);
  }
  assert.ok(get("public/sitemap.xml").includes("https://calvren.ca/ai-receptionist.html"));
  const ld=get("public/ai-receptionist.html").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld); assert.ok(JSON.parse(ld[1])["@graph"].some(x=>x["@type"]==="Service"));
});
test("receptionist enquiry uses existing validated Formspree lead form",()=>{
  const contact=get("public/contact.html"),shared=get("public/shared.js");
  assert.ok(contact.includes('id="project-form"'));
  assert.ok(contact.includes('action="https://formspree.io/f/xrperqkk"'));
  assert.ok(shared.includes('"ai-receptionist"'));
  assert.ok(shared.includes('AI receptionist enquiry — Calvren'));
});
