import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium} from "playwright";
import {checkOwnerWorkspace} from "./admin-browser-check.mjs";

await mkdir("artifacts",{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,permissions:["clipboard-read","clipboard-write"]});
const page=await context.newPage(),errors=[];
page.on("pageerror",error=>errors.push(error.message));
try{
  await checkOwnerWorkspace({page,site:"http://127.0.0.1:8080",screenshot:async()=>{
    const buffer=await page.screenshot({path:"artifacts/owner-preview.jpeg",type:"jpeg",quality:65});
    console.log("CALVREN_IMAGE_OWNER_PREVIEW:"+buffer.toString("base64"));
  }});
  assert.deepEqual(errors,[]);
  console.log("CALVREN_OWNER_PREVIEW_PASSED: current GitHub source served locally; synthetic API fixtures only.");
}finally{await browser.close();}
