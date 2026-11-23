import { setTimeout as delay } from "node:timers/promises";

const targets = ["https://calvren.pages.dev", "https://calvren.ca"];
const required = [
  { path: "/", fragments: ["https://calvren.ca/media/calvren-social-preview-2026.jpg", 'data-cta="audit-hero"', "/conversion-cta.css?v=20261117-dark-orange", "/receptionist.css?v=20261117-custom-quote", "/contact.html?cta=hero#project-form", "/ai-receptionist.html", "Custom quote", "Request a custom quote"] },
  { path: "/contact.html", fragments: ['name="cta_source"', 'button-intent'] },
  { path: "/conversion-cta.css?v=20261117-dark-orange", fragments: ["#ad461f", ".button.button-intent"] },
  { path: "/receptionist.css?v=20261117-custom-quote", fragments: ['content:"✓"', "list-style:none", ".receptionist-teaser-price li::before", ".receptionist-price-card li::before", ".receptionist-money.is-custom-quote"] },
  { path: "/ai-receptionist.html", fragments: ["https://calvren.ca/media/calvren-social-preview-2026.jpg", "/receptionist.css?v=20261117-custom-quote", "AI receptionist", "Custom pricing", "Fewer missed opportunities", "Capture booking requests", "Contact for pricing", "/contact.html?workflow=ai-receptionist#project-form", "https://calvren.ca/ai-receptionist"], forbidden: ["CA$425", "CA$515", "CA$940", "/payment?plan=receptionist"] },
  { path: "/payment.html", fragments: ["data-select-plan=\"starter\"", "data-select-plan=\"growth\"", "data-select-plan=\"pro\"", "CA$425 initially", "AI Receptionist is a separate, custom-quoted service", "Get a custom AI Receptionist quote"], forbidden: ["data-select-plan=\"receptionist\"", "AI receptionist at CA$425/month", "AI Receptionist CA$425/month"] },
  { path: "/shared.js?v=20261118-custom-quote", fragments: ["custom quote for Calvren’s AI receptionist", "AI receptionist custom quote request — Calvren"], forbidden: ["AI receptionist at CA$425/month"] },
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
      const img=await fetch(base+"/media/calvren-social-preview-2026.jpg",{signal:AbortSignal.timeout(15000)});
      if(!img.ok||!((img.headers.get("content-type")||"").includes("image/jpeg")))throw new Error("Branded share image not served as JPEG");
      const bytes=new Uint8Array(await img.arrayBuffer());
      if(bytes.byteLength<30000||bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error("Branded share JPEG is incomplete");
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
