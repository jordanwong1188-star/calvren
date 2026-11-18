import test from "node:test";
import assert from "node:assert/strict";
import {safeWebsite,eligibleSeeds,evaluateWebsite} from "../scripts/prospect-qualification.mjs";

test("public HTTPS roots only: reject IPs, private hosts, map platforms, credentials and ports",()=>{
  for(const raw of ["http://127.0.0.1:4000/", "https://localhost/",
    "https://192.168.0.1","https://[::1]/","file:///etc/passwd",
    "https://username:secret@example.org/","https://example.org:8443/",
    "https://maps.google.com/","https://m.facebook.com/page","https://internal.local",
    "https://example.com.evil.local",""]){
      assert.equal(safeWebsite(raw),null,"Allowed unsafe URL: "+raw);
  }
  assert.equal(safeWebsite("https://example.org/booking?token=private"),"https://example.org/");
  assert.equal(safeWebsite("example.org"),"https://example.org/");
});
test("deduplicates and limits public company websites",()=>{
  const rows=eligibleSeeds(["example.org","https://example.org/contact","https://other.org/","https://third.org/"],2);
  assert.deepEqual(rows.map(x=>x.website),["https://example.org/","https://other.org/"]);
});
test("only evidence-based signals contribute; score is not a revenue or review claim",()=>{
  const result=evaluateWebsite({
    name:"Sample Service Co",website:"https://example.org/",sector:"plumber",
    text:"24/7 emergency plumbing service for commercial properties. Book an appointment, call us today. Service areas in the city.",
    links:[{href:"/contact",text:"Contact us"},{href:"/book",text:"Book online"}],
    sourceUrl:"https://example.org/"
  });
  assert.ok(result.score>=70,JSON.stringify(result));
  assert.equal(result.priority,"High research priority");
  assert.equal(result.affordability,"Not verified: website signals are not financial statements");
  assert.match(result.reviewEvidence,/not assessed/i);
  assert.ok(result.evidence.every(x=>x.source==="https://example.org/"));
  assert.match(result.draft,/HUMAN REVIEW REQUIRED/);
  assert.match(result.draft,/CASL consent basis/);
  assert.ok(!result.draft.includes("@"));
});
test("a website without evidence is not labeled qualified and creates no outreach draft",()=>{
  const row=evaluateWebsite({
    name:"Company",website:"https://example.org/",text:"Welcome to our website.",
    links:[{href:"https://other.org/contact",text:"Contact"}]
  });
  assert.equal(row.score,0);
  assert.equal(row.priority,"Needs more evidence");
  assert.equal(row.draft,null);
  assert.equal(row.status,"Review required; no outreach sent");
});
test("contact links must stay on same host",()=>{
  const row=evaluateWebsite({
    website:"https://sample.ca/",name:"Sample",
    text:"We accept appointments.",
    links:[{href:"https://evil.org/contact",text:"Contact"}]
  });
  assert.equal(row.contactUrl,null);
});
