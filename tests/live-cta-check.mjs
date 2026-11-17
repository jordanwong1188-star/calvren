import { setTimeout as delay } from "node:timers/promises";

const targets = ["https://calvren.pages.dev", "https://calvren.ca"];
const required = [
  { path: "/", fragments: ['data-cta="audit-hero"', "/conversion-cta.css?v=20261117", "/contact.html?cta=hero#project-form"] },
  { path: "/contact.html", fragments: ['name="cta_source"', 'button-intent'] },
  { path: "/conversion-cta.css?v=20261117", fragments: ["#b94f30", ".button.button-intent"] }
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
      console.log("CALVREN_LIVE_CRO_VERIFIED " + base + " (homepage CTA, live CSS, contact form)");
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
