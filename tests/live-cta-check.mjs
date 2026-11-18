import { setTimeout as delay } from "node:timers/promises";

const targets = ["https://calvren.pages.dev", "https://calvren.ca"];
const required = [
  { path: "/", fragments: ['data-cta="audit-hero"', "/conversion-cta.css?v=20261117-dark-orange", "/receptionist.css?v=20261117-custom-quote", "/contact.html?cta=hero#project-form", "/ai-receptionist.html", "Custom quote", "Request a custom quote"] },
  { path: "/contact.html", fragments: ['name="cta_source"', 'button-intent'] },
  { path: "/conversion-cta.css?v=20261117-dark-orange", fragments: ["#ad461f", ".button.button-intent"] },
  { path: "/receptionist.css?v=20261117-custom-quote", fragments: ['content:"✓"', "list-style:none", ".receptionist-teaser-price li::before", ".receptionist-price-card li::before", ".receptionist-money.is-custom-quote"] },
  { path: "/ai-receptionist.html", fragments: ["/receptionist.css?v=20261117-custom-quote", "AI receptionist", "Custom pricing", "Fewer missed opportunities", "Capture booking requests", "Contact for pricing", "/contact.html?workflow=ai-receptionist#project-form", "https://calvren.ca/ai-receptionist"], forbidden: ["CA$425", "CA$515", "CA$940", "/payment?plan=receptionist"] },
  { path: "/payment.html", fragments: ["data-select-plan=\"starter\"", "data-select-plan=\"growth\"", "data-select-plan=\"pro\"", "Get a custom AI Receptionist quote"], forbidden: ["CA$425", "data-select-plan=\"receptionist\""] },
  { path: "/sitemap.xml", fragments: ["https://calvren.ca/ai-receptionist"] }
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
        for (const forbidden of item.forbidden || []) {
          if (body.includes(forbidden)) throw new Error(item.path + " still exposes " + forbidden);
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
