import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
const root = new URL("../",import.meta.url);
const out = new URL("supabase/functions/calvren/generated/",root);
await rm(out,{recursive:true,force:true});
const shared=(await readdir(new URL("src/conversion/",root))).filter(name=>name.endsWith(".mts")).map(name=>"src/conversion/"+name);
const files=[...shared,"netlify/lib/conversion-api.mts","netlify/lib/conversion-providers.mts","netlify/lib/conversion-repository.mts","netlify/lib/workflow-core.mts",
  "server/conversion-runtime.mts","server/private-storage.mts","server/forms.mts","server/demo-access.mts","server/router.mts"];
for(const path of files){
  let source=await readFile(new URL(path,root),"utf8");
  if(/Netlify\.env|@netlify\/blobs|@netlify\/functions/.test(source))throw new Error("A host-specific dependency escaped into "+path);
  source=source.replace(/(from\s+["']\.[^"']*)\.mjs(["'])/g,"$1.ts$2");
  if(/\bBuffer\b/.test(source)&&!source.includes('from "node:buffer"'))source='import { Buffer } from "node:buffer";\n'+source;
  const target=new URL(path.replace(/\.mts$/,".ts"),out);
  await mkdir(dirname(target.pathname),{recursive:true});await writeFile(target,source);
}
console.log("CALVREN_SUPABASE_BUILD_PASSED: portable source generated; no Netlify SDK or runtime globals.");
