import { readFile, writeFile, readdir } from "node:fs/promises";

// Cloudflare Pages is Calvren's single public production origin.
// A custom HTTPS domain can replace it using CALVREN_SITE_URL in the Cloudflare build.
const configured=process.env.CALVREN_SITE_URL || "https://calvren.pages.dev";
const url=new URL(configured);
if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("CALVREN_SITE_URL must be an HTTPS origin.");
for(const file of await readdir(new URL("../public/",import.meta.url))){
  if(!/\.(?:html|xml|txt)$/.test(file))continue;
  const path=new URL("../public/"+file,import.meta.url);
  const previous=await readFile(path,"utf8");
  const updated=previous.replace(/https:\/\/(?:calvren\.netlify\.app|calvren\.pages\.dev)(?=[/"'])/g,url.origin);
  if(updated!==previous)await writeFile(path,updated);
}
console.log("CALVREN_CLOUDFLARE_BUILD_PASSED: canonical URLs and sitemap use "+url.origin+"; API routes use the Supabase proxy.");
