import {mkdir,readdir,readFile,writeFile,rm} from "node:fs/promises";
import {resolve,join} from "node:path";
import ts from "typescript";

const source=resolve("src/conversion"),destination=resolve("public/conversion");
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
for(const filename of (await readdir(source)).filter(name=>name.endsWith(".mts")).sort()){
  const input=await readFile(join(source,filename),"utf8");
  if(/(?:node:|@netlify\/|SUPABASE_SECRET_KEY|TWILIO_AUTH_TOKEN|OPENAI_API_KEY|GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY|RESEND_API_KEY)/.test(input)){
    throw new Error("Server-only code cannot enter the browser demo: "+filename);
  }
  const compiled=ts.transpileModule(input,{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
  const errors=(compiled.diagnostics??[]).filter(item=>item.category===ts.DiagnosticCategory.Error);
  if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=>"\n"}));
  await writeFile(join(destination,filename.replace(/\.mts$/,".mjs")),compiled.outputText,"utf8");
}
console.log("CALVREN_DEMO_BUILD_PASSED: browser-safe shared engine generated in public/conversion.");
