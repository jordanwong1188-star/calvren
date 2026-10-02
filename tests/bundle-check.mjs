import assert from "node:assert/strict";
import {mkdtemp,rm,stat} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const require=createRequire(import.meta.url);
const cliRequire=createRequire(require.resolve("netlify-cli/package.json"));
const {zipFunctions}=await import(pathToFileURL(cliRequire.resolve("@netlify/zip-it-and-ship-it")).href);
const destination=await mkdtemp(join(tmpdir(),"calvren-bundles-"));
try{
  const results=await zipFunctions(resolve("netlify/functions"),destination,{
    archiveFormat:"zip",basePath:process.cwd(),config:{"*":{nodeBundler:"esbuild",nodeVersion:"22"}}
  });
  assert.deepEqual(results.map(result=>result.name).sort(),["submission-created","workflow"]);
  for(const result of results){
    assert.equal(result.runtimeAPIVersion,2);
    assert.equal(result.bundler,"esbuild");
    assert.equal(result.bundlerErrors?.length??0,0);
    assert.ok((await stat(result.path)).size>0);
  }
  console.log("CALVREN_BUNDLE_CHECK_PASSED: both Netlify functions bundled with esbuild for Node22.");
}finally{await rm(destination,{recursive:true,force:true});}
