import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const home=read("public/index.html");
const receptionist=read("public/ai-receptionist.html");
const contact=read("public/contact.html");
const motionJs=read("public/motion.js");
const motionCss=read("public/motion.css");

test("the Getting Started three-step section has been completely removed",()=>{
  assert.ok(!home.includes('id="process"'));
  assert.ok(!home.includes("GETTING STARTED"));
  assert.ok(!home.includes("Simple from<br"));
  assert.ok(!home.includes("We help you choose, set up and test your first workflow."));
  assert.ok(!home.includes('class="process-grid"'));
  const demo=home.indexOf('id="demo"');
  const pricing=home.indexOf('id="pricing"');
  assert.ok(demo>0&&pricing>demo,"Keep the surrounding demo and pricing sections");
  const between=home.slice(demo,pricing);
  assert.ok(!between.includes('id="process"'));
});

test("editorial motion is active only on public marketing pages",()=>{
  for(const [name,markup] of [["home",home],["receptionist",receptionist],["contact",contact]]){
    assert.ok(markup.includes('motion-site'),name+" requires marketing motion opt-in");
    assert.ok(markup.includes('/motion.css?v='),name+" must load motion styles");
    assert.ok(markup.includes('/motion.js?v='),name+" must load editorial scroll behavior");
  }
  assert.ok(motionJs.includes("IntersectionObserver"),"Use passive in-view reveals");
  assert.ok(motionJs.includes("requestAnimationFrame"),"Progress updates should be animation-frame scheduled");
  assert.ok(motionJs.includes('addEventListener("scroll",schedule,{passive:true})'),"Scroll listener must be passive");
  assert.ok(motionJs.includes("prefers-reduced-motion"),"Respect user motion preferences");
  assert.ok(motionJs.includes("window.removeEventListener"),"Motion must clean up when disabled");
  assert.ok(motionCss.includes("motion-enabled"),"Don't hide content without a running script");
  assert.ok(motionCss.includes("prefers-reduced-motion:reduce"),"Reduced-motion CSS fallback is required");
  assert.ok(!motionJs.includes("innerHTML"),"Don't split or replace SEO or screen-reader text");
});

test("picture-free marketing keeps cards, text-led panel, and audit CTA",()=>{
  const solutions=home.slice(home.indexOf('id="solutions"'),home.indexOf('id="demo"'));
  assert.equal((solutions.match(/<article class="solution-card">/g)||[]).length,3);
  assert.ok(!solutions.includes("<img"),"All stock photos must be removed");
  assert.ok(!receptionist.includes("<img"),"Receptionist must be photo-free too");
  assert.ok(!solutions.includes("solution-photo"));
  assert.ok(!solutions.includes('class="solution-icon"'));
  assert.ok(receptionist.includes("receptionist-workday-note"));
  assert.ok(!receptionist.includes("receptionist-workplace-photo"));
  assert.ok(solutions.includes("Request my free audit"));
});
