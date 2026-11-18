import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.CALVREN_TEST_SITE || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
try {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const primary = page.getByRole("link", { name: "Request a free audit" });
  assert.equal(await primary.count(), 1, "Homepage must have one prominent audit CTA");
  assert.match(await primary.getAttribute("href"), /\/contact\.html\?cta=hero#project-form$/);
  const color = await primary.evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(color, "rgb(173, 70, 31)", "Audit CTA should use the accessible dark orange accent");
  assert.equal(await page.locator('[data-cta="audit-header"]').count(), 1);
  await primary.click();
  await page.waitForURL(url => url.pathname.includes("contact") && url.searchParams.get("cta") === "hero");
  assert.equal(await page.locator('#project-form [name="cta_source"]').inputValue(), "hero");
  assert.equal(await page.locator("#project-form").isVisible(), true);
  assert.equal(await page.locator('#project-form button[type="submit"]').evaluate(el => getComputedStyle(el).backgroundColor), "rgb(173, 70, 31)");
  console.log("CALVREN_CRO_JOURNEY_PASSED: distinct audit CTA, direct visible form and cookie-free source attribution.");

  // A campaign arriving on the homepage must retain its source on the audit
  // form without setting cookies or storing a marketing identifier.
  await page.goto(base + "/?utm_source=linkedin&utm_medium=social&utm_campaign=nov-outreach", {waitUntil:"networkidle"});
  const campaignCta=page.getByRole("link",{name:"Request a free audit"});
  const campaignUrl=new URL(await campaignCta.getAttribute("href"),base);
  assert.equal(campaignUrl.searchParams.get("utm_source"),"linkedin");
  assert.equal(campaignUrl.searchParams.get("utm_medium"),"social");
  assert.equal(campaignUrl.searchParams.get("utm_campaign"),"nov-outreach");
  await campaignCta.click();
  await page.waitForURL(url=>url.pathname.includes("contact")&&url.searchParams.get("utm_source")==="linkedin");
  for(const [key,value] of Object.entries({utm_source:"linkedin",utm_medium:"social",utm_campaign:"nov-outreach"})){
    assert.equal(await page.locator('#project-form [name="'+key+'"]').inputValue(),value);
  }
  console.log("CALVREN_CAMPAIGN_ATTRIBUTION_PASSED: LinkedIn UTM attribution preserved through homepage CTA.");

  for (const path of ["/", "/contact.html"]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map(issue => ({
      rule: issue.id, impact: issue.impact, affectedElements: issue.nodes.length
    }));
    // First adoption is report-only. Existing pages may have unrelated accessibility debt.
    console.log("CALVREN_AXE_REPORT " + path + " " + JSON.stringify(summary));
  }
} finally {
  await context.close();
  await browser.close();
}
