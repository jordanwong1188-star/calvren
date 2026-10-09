import { readFile, writeFile, readdir } from "node:fs/promises";
const configured=process.env.CALVREN_SITE_URL;
if(configured){
  const url=new URL(configured);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("CALVREN_SITE_URL must be an HTTPS origin.");
  for(const file of await readdir(new URL("../public/",import.meta.url))){
    if(!file.endsWith(".html"))continue;
    const path=new URL("../public/"+file,import.meta.url);
    let html=await readFile(path,"utf8");
    html=html.replace(/https:\/\/calvren\.netlify\.app(?=[/"'])/g,url.origin);
    await writeFile(path,html);
  }
}
console.log("CALVREN_CLOUDFLARE_BUILD_PASSED: existing public pages ready; API routes use the Supabase proxy.");
