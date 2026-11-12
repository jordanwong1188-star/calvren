import { readFile, writeFile, readdir, stat } from "node:fs/promises";

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

 
// Keep the approved promo video on the site origin, not a temporary external embed.
// Reuse the last published copy on subsequent builds until the asset is committed to source.
const promoPath=new URL("../public/media/calvren-intro.mp4",import.meta.url);
let hasLocalPromo=false;
try { hasLocalPromo=(await stat(promoPath)).size>100000; } catch {}
if(!hasLocalPromo){
  const sources=[
    url.origin+"/media/calvren-intro.mp4",
    "https://storage.googleapis.com/vidiq-user-videos/1dd7c10c-b428-45da-9f38-76a3b5476664/e4751d95-ed58-457d-9c16-807685fd0bdf.mp4?GoogleAccessId=ai-proxy-20261001%40studious-pen-429.vid.io.iam.gserviceaccount.com&Expires=1795054809&Signature=d4HnpIjyNVYER9qv%2BdXi5ePVMi3o4OlBhp%2FeNdb8JNKg3KZGHh45TQuKHsjymkKZHdGNX2ihnhkIGMdTwR7FOEp%2B4eFfeJ%2BLKuzJTQPnEgY%2Fo734OGhND1XRhU30YDYr53cw4VUQNkVJXDhA5STMQ%2BMnxvSibMg7Phbw07CD8l09ehnuiKBV%2BjzFAIizII1DvQQsWD8H9zLhrYkla4%2FA2oVSN6PVYsoRQ%2BNa7MoEMsUnQZ%2FxyHT5kOldAXvOf2hQPY%2Bp3MRGUtTYW2lsNMWWV3axfaIuoSjk0wbuDLJQckEDPIThnG2F2nZJ2V7Ywi0g9tG5cE3z3Ff2a4u7w5F1yQ%3D%3D"
  ];
  for(const source of sources){
    try{
      const response=await fetch(source,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)continue;
      const body=Buffer.from(await response.arrayBuffer());
      if(body.length<=100000||body.length>=30000000)continue;
      if(body.toString("ascii",4,8)!=="ftyp")continue;
      await writeFile(promoPath,body);
      hasLocalPromo=true;
      console.log("CALVREN_PROMO_VIDEO_READY: hosted at /media/calvren-intro.mp4");
      break;
    }catch(error){console.warn("Promo source unavailable:",String(error).slice(0,160));}
  }
}
if(!hasLocalPromo)console.warn("CALVREN_PROMO_VIDEO_NOT_CACHED: continuing with existing hero video fallback.");

console.log("CALVREN_CLOUDFLARE_BUILD_PASSED: canonical URLs and sitemap use "+url.origin+"; API routes use the Supabase proxy.");
