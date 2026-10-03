import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";

const require=createRequire(import.meta.url);
const manifestPath=require.resolve("netlify-cli/package.json");
const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
const binary=typeof manifest.bin==="string"?manifest.bin:manifest.bin.netlify;
const token="ci-operator-"+ "x".repeat(64);
const environment={...process.env,CALVREN_ADMIN_TOKEN:token,CALVREN_AUTOMATION_MODE:"demo",CALVREN_PUBLIC_URL:"https://calvren.netlify.app"};
for(const key of ["SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY","OPENAI_API_KEY","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","GOOGLE_SERVICE_ACCOUNT_EMAIL","GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY","RESEND_API_KEY"])delete environment[key];
const child=spawn(process.execPath,[resolve(dirname(manifestPath),binary),"dev","--offline","--port","8888"],{env:environment,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
let output="";
child.stdout.on("data",chunk=>{output+=chunk.toString();});
child.stderr.on("data",chunk=>{output+=chunk.toString();});
const origin="http://127.0.0.1:8888";
const call=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(6000)});
try{
  let ready=false;
  for(let attempt=0;attempt<45;attempt++){
    if(child.exitCode!==null)throw new Error("Netlify Dev exited before serving requests.");
    try{if((await call("/lead-demo.html")).status===200){ready=true;break;}}catch{}
    await delay(1000);
  }
  assert.ok(ready,"Netlify Dev must serve the generated demo.");
  assert.equal((await call("/conversion/engine.mjs")).status,200);
  const unauthorized=await call("/api/conversion/status");
  assert.equal(unauthorized.status,401);
  const status=await call("/api/conversion/status",{headers:{Authorization:"Bearer "+token}});
  assert.equal(status.status,200);
  const data=await status.json();
  assert.equal(data.readiness.database,false);
  assert.equal(data.readiness.mode,"demo");
  assert.equal(data.readiness.production,false);
  assert.equal(data.readiness.browser_demo,true);
  for(const path of ["/api/leads","/api/conversion/leads"]){
    const result=await call(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:"abc-plumbing-demo",name:"Fake CI Lead",message:"A fake lead.",idempotency_key:"ci-route-probe"})});
    assert.equal(result.status,401,path+" must dispatch to authenticated intake.");
  }
  assert.equal((await call("/api/leads")).status,401,"Legacy inbox remains protected.");
  console.log("CALVREN_DEV_SERVER_PASSED: Netlify Dev serves built demo assets and actual functions; operator authentication, environment handling and both intake aliases work without real credentials.");
}catch(error){
  console.error(output.slice(-16000));
  throw error;
}finally{
  try{if(process.platform!=="win32")process.kill(-child.pid,"SIGTERM");else child.kill("SIGTERM");}catch{}
}
