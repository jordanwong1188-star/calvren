import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const homepage=read("public/index.html");
const styles=read("public/solutions.css");

test("solutions tell a clear benefit-led story instead of repeating generic feature labels",()=>{
  const section=homepage.match(/<section[^>]*id="solutions"[\s\S]*?<\/section>/)?.[0]||"";
  assert.ok(section.includes('aria-labelledby="solutions-title"'));
  assert.ok(section.includes('id="solutions-title"'));
  assert.ok(section.includes("From first enquiry"));
  assert.equal((section.match(/<article class="solution-card">/g)||[]).length,3);
  for(const name of ["Make the first reply easier.","Keep the conversation going.","Make booking less of a back-and-forth."])
    assert.ok(section.includes(name),"Missing concrete outcome: "+name);
  for(const term of ["Quote request","Details gathered","Pending enquiry","Planned follow-up","Booking request","Calendar or team"])
    assert.ok(section.includes(term),"Missing scannable workflow example: "+term);
  assert.ok(section.includes("team can review"),"Don't imply that humans are bypassed");
  assert.ok(section.includes("EXAMPLE FLOW"),"Illustrative flows need a disclosure");
  for(const banned of ["guaranteed", "100%","5-star","best rated","save 40 hours","clients served","24/7"])
    assert.ok(!section.toLowerCase().includes(banned.toLowerCase()),"Unsupported claim: "+banned);
});

test("solutions provide a clear next action with consent-friendly audit link and working demo link",()=>{
  const section=homepage.match(/<section[^>]*id="solutions"[\s\S]*?<\/section>/)?.[0]||"";
  assert.ok(section.includes('href="/contact.html?cta=solutions#project-form"'),"Audit should go to existing real contact form");
  assert.ok(section.includes('data-cta="audit-solutions"'));
  assert.ok(section.includes('href="/try-demo.html"'));
  assert.ok(section.includes("No payment or obligation."));
  const shared=read("public/shared.js");
  assert.ok(shared.includes('"solutions"'),"New CTA source must be kept in allowed attribution values");
  const contact=read("public/contact.html");
  assert.ok(contact.includes('id="project-form"'),"Audit destination form must exist");
  assert.ok(homepage.includes('/solutions.css?v=20261118-scroll-journey'),"Load versioned design stylesheet");
});

test("solutions styling stays scoped, responsive and keyboard accessible",()=>{
  assert.ok(styles.includes(".simple-home #solutions"),"Style only the homepage solutions");
  for(const width of ["940px","700px","390px"])
    assert.ok(styles.includes("@media(max-width:"+width+")"),"No responsive rules for "+width);
  assert.ok(styles.includes("grid-template-columns:1fr"),"Mobile should use one column");
  assert.ok(homepage.includes('class="solution-icon" aria-hidden="true"'),"Decorative icons should not be announced");
  assert.ok(styles.includes("min-width:0"),"Cards must shrink without horizontal overflow");
  assert.ok(styles.includes("prefers-reduced-motion"),"Reduced motion preference should be preserved");
  assert.ok(homepage.includes("Request my free audit"),"Prominent CTA text is missing");
});
