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
  assert.ok(section.includes('href="/lead-demo.html"'), "Demo link should open the example directly.");
  assert.ok(section.includes("No payment or obligation."));
  const shared=read("public/shared.js");
  assert.ok(shared.includes('"solutions"'),"New CTA source must be kept in allowed attribution values");
  const contact=read("public/contact.html");
  assert.ok(contact.includes('id="project-form"'),"Audit destination form must exist");
  assert.ok(homepage.includes('/solutions.css?v=20261118-scroll-journey'),"Load versioned design stylesheet");
});

test("solutions retain a professional responsive layout without pictures",()=>{
  assert.ok(styles.includes(".simple-home #solutions"),"Keep styles scoped to the marketing page");
  for(const width of ["940px","700px","390px"])
    assert.ok(styles.includes("@media(max-width:"+width+")"),"Missing breakpoint "+width);
  assert.ok(styles.includes("grid-template-columns:1fr"),"Cards should stack on mobile");
  const solution=homepage.slice(homepage.indexOf('id="solutions"'),homepage.indexOf('id="demo"'));
  assert.equal((solution.match(/<article class="solution-card">/g)||[]).length,3);
  assert.ok(!solution.includes("<img")&&!solution.includes("solution-photo"),"No photographs in Solutions");
  assert.ok(!homepage.includes("images.unsplash.com"),"No external stock photos on homepage");
  assert.ok(!homepage.includes('class="solution-icon"'),"Keep decorative pictograms removed");
  assert.ok(styles.includes(".solution-card-top"),"Preserve card typography and structure");
  assert.ok(styles.includes("min-width:0"),"Cards must shrink without horizontal overflow");
  const receptionist=read("public/ai-receptionist.html");
  assert.ok(!receptionist.includes("<img")&&!receptionist.includes("images.unsplash.com"));
  assert.ok(receptionist.includes("receptionist-workday-note"),"Retain the editorial section without its photo");
  assert.ok(styles.includes("prefers-reduced-motion"),"Respect reduced-motion preferences");
  assert.ok(homepage.includes("Request my free audit"),"Retain primary conversion path");
});
