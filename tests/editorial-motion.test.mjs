import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(name)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");

test("editorial motion is scoped to public marketing pages only",()=>{
  const pages=["public/index.html","public/ai-receptionist.html","public/contact.html"];
  for(const page of pages){
    const html=read(page);
    assert.ok(html.includes('href="/motion.css?v=20261118-editorial-v1"'),page+" needs motion styles");
    assert.ok(html.includes('src="/motion.js?v=20261118-editorial-v1"'),page+" needs motion script");
    assert.ok(/<body class="[^"]*motion-site/.test(html),page+" must opt in explicitly");
  }
  for(const page of ["public/payment.html","public/client.html","public/onboarding.html"]){
    assert.ok(!read(page).includes('src="/motion.js'),"Keep checkout and client flows animation-free: "+page);
  }
});

test("scroll animation respects visitor controls and does not hide content without JavaScript",()=>{
  const css=read("public/motion.css");
  const js=read("public/motion.js");
  const shared=read("public/shared.js");
  assert.ok(css.includes("html.motion-enabled"),"Do not hide elements by default");
  assert.ok(js.includes('document.documentElement.classList.add("motion-enabled")'),"Opt-in after observer setup");
  assert.ok(js.includes("IntersectionObserver"),"Viewport-based entrance triggers");
  assert.ok(js.includes('prefers-reduced-motion: reduce'),"Respect reduced motion");
  assert.ok(css.includes("prefers-reduced-motion:reduce"),"Motion CSS must have reduced-motion fallback");
  assert.ok(js.includes('window.addEventListener("scroll",schedule,{passive:true})'),"Scroll listener should be passive");
  assert.ok(js.includes('document.addEventListener("focusin"'),"Keyboard navigation must reveal focus targets");
  assert.ok(js.includes('progress.setAttribute("aria-hidden","true")'),"Reading-progress cue is decorative");
  assert.ok(shared.includes('!document.body.classList.contains("motion-site")'),"Don't run two reveal systems");
  for(const fragment of ["scrollIntoView(","scrollTo(","preventDefault()","setInterval("])
    assert.ok(!js.includes(fragment),"Don't hijack scrolling or schedule continuous animation: "+fragment);
});

test("stock photography is realistic, accessible, traceable and not presented as testimonials",()=>{
  const home=read("public/index.html"),receptionist=read("public/ai-receptionist.html");
  assert.equal((home.match(/class="solution-photo"/g)||[]).length,3);
  assert.equal((home.match(/<img src="https:\/\/images\.unsplash\.com\/photo-/g)||[]).length,3);
  assert.ok(receptionist.includes('class="receptionist-workplace-photo section-wrap"'));
  assert.ok(receptionist.includes("images.unsplash.com/photo-1714079761488-e0c9b9ac4138"));
  assert.ok(!home.includes('class="solution-icon"'));
  const photoAlt=[...home.matchAll(/<img[^>]*alt="([^"]+)"[^>]*>/g)].map(x=>x[1]);
  assert.ok(photoAlt.length>=3&&photoAlt.every(x=>x.length>24));
  for(const phrase of ["not Calvren customers","Unsplash License"])
    assert.ok(read("docs/marketing-photo-sources.md").includes(phrase),"Photo source disclosure missing");
});

test("Getting Started process section is entirely retired, retaining real sales paths",()=>{
  const html=read("public/index.html");
  for(const retired of ['id="process"',"GETTING STARTED","Simple from<br/>","We configure your workflow, questions and handoff rules."])
    assert.ok(!html.includes(retired),"Retired process copy remains: "+retired);
  for(const target of ['id="solutions"','id="demo"','id="pricing"','id="ai-receptionist"','id="contact"'])
    assert.ok(html.includes(target),"Essential marketing section missing: "+target);
  assert.ok(html.indexOf('id="demo"')<html.indexOf('id="pricing"'));
});
