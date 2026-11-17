import { setTimeout as delay } from "node:timers/promises";

const targets = ["https://calvren.pages.dev", "https://calvren.ca"];
const required = [
  { path: "/", fragments: ['data-cta="audit-hero"', "/conversion-cta.css?v=20261117-violet", "/contact.html?cta=hero#project-form", "/ai-receptionist.html", "CA$350", "CA$515"] },
  { path: "/contact.html", fragments: ['name="cta_source"', 'button-intent'] },
  { path: "/conversion-cta.css?v=20261117-violet", fragments: ["#7446d6", ".button.button-intent"] },
  { path: "/ai-receptionist.html", fragments: ["AI receptionist", "CA$350", "CA$515", "200 call minutes", "CA$0.85/minute", "coming soon", "not operational yet", "/contact.html?workflow=ai-receptionist#project-form", "https://calvren.ca/ai-receptionist.html"] },
  { path: "/sitemap.xml", fragments: ["https://calvren.ca/ai-receptionist.html"] }
];

async function verify(base) {
  let lastProblem = "not checked";
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      for (const item of required) {
        const response = await fetch(base + item.path, { signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (!response.ok) throw new Error(item.path + " returned HTTP " + response.status);
        const body = await response.text();
        for (const fragment of item.fragments) {
          if (!body.includes(fragment)) throw new Error(item.path + " is missing " + fragment);
        }
      }
      console.log("CALVREN_LIVE_CRO_AND_RECEPTIONIST_VERIFIED " + base + " (homepage CTA, live CSS, receptionist offer, sitemap and contact form)");
      return true;
    } catch (error) {
      lastProblem = error.message;
      console.log("CALVREN_LIVE_CRO_RETRY " + base + " " + attempt + "/12: " + lastProblem);
      if (attempt < 12) await delay(10000);
    }
  }
  console.error("CALVREN_LIVE_CRO_NOT_VERIFIED " + base + ": " + lastProblem);
  return false;
}

const results = await Promise.all(targets.map(verify));
if (results.some(result => !result)) process.exitCode = 1;
