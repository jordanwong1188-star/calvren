import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=path=>readFileSync(new URL("../public/"+path,import.meta.url),"utf8");

test("public site spells ShineBros consistently and preserves original story links",()=>{
  for(const path of ["index.html","case-studies.html"]){
    const html=page(path);
    assert.ok(html.includes("ShineBros"),"ShineBros name missing from "+path);
    assert.ok(!html.includes("ShinerBros"),"Obsolete brand spelling in "+path);
  }
  assert.ok(page("case-studies.html").includes('id="shine-bros"'));
  assert.ok(page("index.html").includes('/case-studies.html#shine-bros'));
});

test("earlier client experience is not represented as a fabricated quotation or metric",()=>{
  const html=page("case-studies.html");
  assert.ok(html.includes("before this website was built"));
  assert.ok(html.includes("not verbatim customer reviews"));
  assert.ok(html.includes("ClearCraft"));
  assert.ok(!html.includes("ratingValue"));
});
