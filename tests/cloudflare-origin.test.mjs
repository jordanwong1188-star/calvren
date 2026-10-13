import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");

test("Cloudflare is the canonical production URL throughout public pages and SEO files", async () => {
  for (const file of [
    "public/index.html", "public/contact.html", "public/case-studies.html",
    "public/privacy.html", "public/sitemap.xml", "public/robots.txt"
  ]) {
    const content = await read(file);
    assert.ok(!content.includes("https://calvren.netlify.app"), file + " must not link to the outdated Netlify deployment.");
    assert.ok(content.includes("https://calvren.pages.dev"), file + " must point to Cloudflare.");
  }
  assert.match(await read("tests/site-check.mjs"), /CALVREN_TEST_SITE \|\| "https:\/\/calvren\.pages\.dev"/);
  assert.match(await read("scripts/build-cloudflare.mjs"), /CALVREN_SITE_URL \|\| "https:\/\/calvren\.pages\.dev"/);
});
test("Public demo and operator workspace stay separate, and demo JS revalidates on new deploys", async () => {
  const homepage = await read("public/index.html");
  assert.ok(!homepage.includes("/operator.html"), "Never link the private operator workspace on the public homepage.");
  assert.match(homepage, /data-demo-access href="\/try-demo\.html"/);
  const headers = await read("public/_headers");
  for (const rule of ["/conversion/*", "/lead-demo.js", "/demo-access.js"]) {
    assert.ok(headers.includes(rule + "\n  Cache-Control: no-cache, must-revalidate"), "Missing fresh asset policy for " + rule);
  }
});
