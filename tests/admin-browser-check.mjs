import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export async function checkOwnerWorkspace({page,site,screenshot}){
  const ids=["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"];
  const automation={summary:"Synthetic enquiry summary for browser verification.",category:"sales",priority:"medium",nextAction:"Review and agree a discovery call.",replyDraft:"Hi QA, thanks for your enquiry. Which part of the process would you like to improve first?"};
  let records=ids.map((id,i)=>({
    id,name:i===0?"QA <img src=x onerror=alert(1)>":"Synthetic QA "+i,
    email:"qa"+i+"@example.com",business:"Browser test company",businessType:"professional",
    enquiry:"Synthetic browser check: we would like to organise incoming enquiries more clearly.",
    status:["new","draft","approved"][i],source:i===0?"website":"manual",
    processingError:i===0?"The provider was temporarily unavailable. Your enquiry remains saved.":null,
    automation:i===0?null:{...automation},createdAt:"2026-10-02T00:00:00.000Z",updatedAt:"2026-10-02T00:00:00.000Z"
  }));
  let allow=true,deleteCount=0,manualCount=0,retryCount=0;
  const intercept=async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    assert.match(request.headers().authorization||"",/^Bearer qa-workspace-token/);
    const respond=(body,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
    if(!allow)return respond({error:"Authentication required."},401);
    if(path==="/api/status")return respond({providerConfigured:true,persistentStorage:true,websiteIntake:true,environment:"production",model:"qa-model"});
    if(path==="/api/leads"&&request.method()==="GET")return respond({leads:records,limit:100});
    if(path==="/api/workflow"&&request.method()==="POST"){
      manualCount++;const payload=request.postDataJSON();
      assert.equal(payload.name,"Synthetic manual intake");
      const saved={...payload,id:"00000000-0000-4000-8000-000000000004",business:"",source:"manual",status:"new",processingError:"AI is not configured. The enquiry remains saved.",automation:null,createdAt:"2026-10-02T00:00:00.000Z",updatedAt:"2026-10-02T00:00:00.000Z"};
      records.unshift(saved);return respond({lead:saved,warning:saved.processingError},201);
    }
    const id=path.split("/")[3],record=records.find(row=>row.id===id);
    assert.ok(record,"Unexpected synthetic record route "+path);
    if(path.endsWith("/draft")){
      retryCount++;record.automation={...automation};record.processingError=null;record.status="draft";return respond({lead:record});
    }
    if(request.method()==="PATCH"){record.status=request.postDataJSON().status;return respond({lead:record});}
    if(request.method()==="DELETE"){deleteCount++;records=records.filter(row=>row.id!==id);return respond({deleted:true,id});}
    throw new Error("Unexpected mock API request "+path);
  };
  await page.route(site+"/api/**",intercept);
  try{
    await page.goto(site+"/admin.html",{waitUntil:"networkidle"});
    await page.locator("#admin-token").fill("qa-workspace-token-"+"x".repeat(40));
    await page.locator('#auth-form button[type="submit"]').click();
    await page.locator("#workspace").waitFor({state:"visible"});
    assert.equal(await page.locator("#admin-token").inputValue(),"");
    assert.equal(await page.locator(".service-check").count(),3);
    assert.equal(await page.locator(".lead-card").count(),3);
    assert.equal(await page.locator("#lead-list img").count(),0);
    assert.match(await page.locator(".lead-card").first().textContent(),/QA <img/);
    await page.locator("#lead-filter").selectOption("new");
    assert.equal(await page.locator(".lead-card").count(),1);
    await page.locator("#lead-filter").selectOption("all");
    await page.locator("#lead-search").fill("qa1@example.com");
    assert.equal(await page.locator(".lead-card").count(),1);
    await page.locator("#lead-search").fill("");
    for(const width of [320,375,768,1440]){
      await page.setViewportSize({width,height:1000});
      const layout=await page.evaluate(()=>({body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
      assert.ok(layout.body<=width+1&&layout.document<=width+1,"Owner workspace overflow at "+width+": "+JSON.stringify(layout));
    }
    await screenshot("OWNER_WORKSPACE");
    const first=page.locator('[data-lead-id="'+ids[0]+'"]');
    await first.getByRole("button",{name:"Prepare / retry draft",exact:true}).click();
    await first.getByRole("button",{name:"Mark reviewed",exact:true}).waitFor();
    assert.equal(retryCount,1);
    await first.getByRole("button",{name:"Mark reviewed",exact:true}).click();
    await first.getByRole("link",{name:"Open email draft",exact:true}).waitFor();
    const mailto=await first.getByRole("link",{name:"Open email draft",exact:true}).getAttribute("href");
    assert.match(mailto,/^mailto:qa0%40example.com\?subject=/);
    assert.match(decodeURIComponent(mailto),/body=Hi QA/);
    assert.match(await page.locator("#inbox-status").textContent(),/No message has been sent/);

    const downloadEvent=page.waitForEvent("download");
    await page.locator("#export-leads").click();
    const download=await downloadEvent;
    await download.saveAs("artifacts/owner-export-synthetic.json");
    assert.equal(JSON.parse(await readFile("artifacts/owner-export-synthetic.json","utf8")).length,3);

    await page.locator("#lead-name").fill("Synthetic manual intake");
    await page.locator("#lead-email").fill("manual@example.com");
    await page.locator("#lead-enquiry").fill("Synthetic enquiry used only to test saving before AI preparation.");
    await page.locator("#prepare-lead").click();
    await page.waitForFunction(()=>document.querySelectorAll(".lead-card").length===4);
    assert.equal(manualCount,1);
    assert.match(await page.locator("#workflow-status").textContent(),/remains saved/);
    assert.equal(await page.locator("#lead-name").inputValue(),"");

    const manual=page.locator('[data-lead-id="00000000-0000-4000-8000-000000000004"]');
    await manual.getByRole("button",{name:"Archive",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-lead-id="00000000-0000-4000-8000-000000000004"] .tag').textContent==="Archived");
    page.once("dialog",dialog=>dialog.accept());
    await manual.getByRole("button",{name:"Delete permanently",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll(".lead-card").length===3);
    assert.equal(deleteCount,1);

    await page.locator("#disconnect").click();
    assert.equal(await page.locator("#workspace").isVisible(),false);
    assert.equal(await page.locator(".lead-card").count(),0);
    assert.equal(await page.locator("#admin-token").inputValue(),"");
    allow=false;
    await page.locator("#admin-token").fill("qa-workspace-token-"+"x".repeat(40));
    await page.locator('#auth-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.getElementById("auth-status").textContent==="Authentication required.");
    assert.equal(await page.locator("#workspace").isVisible(),false);
    assert.equal(await page.locator("#admin-token").inputValue(),"");
    console.log("CALVREN_OWNER_UI_CHECKS_PASSED: synthetic mocked API only; readiness, safe text rendering, four widths, search/filter, retry/review, manual email handoff, export, retained provider failure, archive/delete and auth/disconnect.");
  }finally{await page.unroute(site+"/api/**",intercept);}
}
