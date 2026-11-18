import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const file=(p)=>new URL("../public/"+p,import.meta.url);
const read=(p)=>readFileSync(file(p),"utf8");

test("retired client stories are absent from the site and sitemap",()=>{
  assert.equal(existsSync(file("case-studies.html")),false,"Do not serve the retired story page");
  assert.equal(existsSync(file("review-thanks.html")),false,"Do not serve the retired public review form");
  for(const page of ["index.html","contact.html","ai-receptionist.html","404.html"]){
    const html=read(page);
    assert.ok(!html.includes("/case-studies"),"Retired story link on "+page);
    assert.ok(!html.includes("Client stories"),"Retired story menu on "+page);
  }
  const home=read("index.html");
  for(const phrase of ["proof-preview","proof-grid","ShineBros","ClearCraft"]){
    assert.ok(!home.includes(phrase),"Retired social-proof block remains: "+phrase);
  }
  for(const id of ["solutions","demo","process","pricing"])
    assert.ok(home.includes('id="'+id+'"'),"Useful homepage section missing: "+id);
  assert.ok(!read("sitemap.xml").includes("case-studies"),"Remove story URL from search sitemap");
});

test("old public story and feedback URLs permanently redirect to live pages",()=>{
  const redirect=read("_redirects");
  for(const rule of ["/case-studies / 301","/case-studies.html / 301",
    "/review-thanks /thanks.html 301","/review-thanks.html /thanks.html 301"])
    assert.ok(redirect.split("\n").includes(rule),"Required redirect missing: "+rule);
  assert.ok(existsSync(file("thanks.html")),"Retain standard enquiry confirmation page");
});
