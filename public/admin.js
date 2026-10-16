const $=id=>document.getElementById(id);
let token="",busy=false,leads=[],readiness=null;
async function api(path,method="GET",payload){
  const response=await fetch(path,{method,headers:{"Authorization":"Bearer "+token,...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data.error==="string"?data.error:"The request could not be completed. Please try again.");
  return data;
}
function textNode(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function download(name,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function clearWorkspace(){
  token="";leads=[];readiness=null;$("admin-token").value="";$("lead-list").replaceChildren();$("service-state").replaceChildren();
  $("workspace").hidden=true;$("disconnect").hidden=true;$("auth-status").textContent="Not connected.";
  $("workflow-form").reset();$("workflow-status").textContent="";$("inbox-status").textContent="";$("lead-search").value="";$("lead-filter").value="all";$("sales-filter").value="all";
}
function renderStatus(data){
  readiness=data;$("service-state").replaceChildren();
  for(const [label,ready,yes,no]of[
    ["AI draft provider",data.providerConfigured,"Key configured","Needs an API key"],
    ["Persistent private storage",data.persistentStorage,"Configured","Needs production setup"],
    ["Website enquiry intake",data.websiteIntake,"Event handler available","Needs setup"]
  ]){
    const card=textNode("div","","service-check"+(ready?"":" pending"));
    card.append(textNode("span",label),textNode("strong",ready?yes:no));$("service-state").append(card);
  }
  $("setup-status").textContent=!data.persistentStorage
    ?"Complete production storage setup before using the AI inbox for real client data. Older Netlify enquiries remain in Netlify; new website enquiries appear here after the hosting migration."
    :!data.providerConfigured
    ?"Enquiries can be retained for review. Add the OpenAI API key and redeploy to enable draft preparation."
    :"Configuration is present. Verify a synthetic enquiry before processing real client data; provider billing and permissions still need to work.";
}
async function loadStatus(){renderStatus(await api("/api/status"));}
async function loadLeads(){const data=await api("/api/leads");if(!Array.isArray(data.leads))throw new Error("Unexpected inbox response.");leads=data.leads;renderLeads();}
function renderLeads(){
  const query=$("lead-search").value.trim().toLowerCase(),filter=$("lead-filter").value,salesFilter=$("sales-filter").value;
  const visible=leads.filter(lead=>(filter==="all"||lead.status===filter)&&
    (salesFilter==="all"||(lead.salesStage||"new")===salesFilter)&&
    (!query||[lead.name,lead.email,lead.phone||"",lead.business||"",lead.challenge||"",lead.enquiry,lead.utmCampaign||""].join(" ").toLowerCase().includes(query)));
  // Overdue callbacks rise to the top without changing the stored records.
  visible.sort((a,b)=>{
    const due=x=>x.nextFollowUpAt&&new Date(x.nextFollowUpAt).getTime()<=Date.now()&&
      !["won","lost"].includes(x.salesStage||"new")?1:0;
    return due(b)-due(a)||b.createdAt.localeCompare(a.createdAt);
  });
  $("lead-count").textContent=visible.length+" of "+leads.length+" loaded enquiries · up to 100 per view";
  $("lead-list").replaceChildren();
  for(const lead of visible){
    const card=document.createElement("article");card.className="lead-card";card.dataset.leadId=lead.id;
    const label={new:"Needs a draft",draft:"Awaiting review",approved:"Reviewed · not sent",archived:"Archived"}[lead.status]||"Needs review";
    card.append(textNode("h3",lead.name+(lead.automation?" · "+lead.automation.category:"")),textNode("span",label,"tag"));
    const received=new Date(lead.createdAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
    card.append(textNode("p",lead.email+"\n"+(lead.business?lead.business+" · ":"")+lead.businessType+" · "+(lead.source==="website"?"Website enquiry":"Manual intake")+"\nReceived "+received,"lead-meta"));
    if(lead.phone&&lead.callbackConsent){
      card.append(textNode("p","Callback: "+lead.phone+" · "+(lead.preferredCallTime||"Anytime"),"lead-meta"));
    }
    if(lead.challenge)card.append(textNode("p","Main challenge: "+lead.challenge,"lead-summary"));
    if(lead.utmSource||lead.utmMedium||lead.utmCampaign)
      card.append(textNode("p","Campaign: "+[lead.utmSource,lead.utmMedium,lead.utmCampaign].filter(Boolean).join(" / "),"lead-meta"));
    const original=document.createElement("details");original.append(textNode("summary","Original enquiry"),textNode("p",lead.enquiry));card.append(original);
    if(lead.automation){
      card.append(textNode("p",lead.automation.summary,"lead-summary"),textNode("p","Priority: "+lead.automation.priority),textNode("p",lead.automation.replyDraft,"reply-copy"),textNode("p","Next action: "+lead.automation.nextAction,"lead-summary"));
    }else card.append(textNode("p","This enquiry is saved. Prepare an AI draft when the provider is ready, or review the original enquiry and respond manually.","lead-summary"));
    if(lead.processingError)card.append(textNode("p",lead.processingError,"processing-note"));
    const pipeline=document.createElement("div");pipeline.className="sales-followup";
    const stageLabel=textNode("label","Sales follow-up status"),stage=document.createElement("select");
    const stages=[["new","Not contacted"],["contacted","Contacted"],["call_scheduled","Call scheduled"],
      ["proposal_sent","Proposal sent"],["won","Won client"],["lost","Lost"]];
    for(const [value,title] of stages){const item=document.createElement("option");item.value=value;item.textContent=title;stage.append(item);}
    stage.value=lead.salesStage||"new";
    const noteLabel=textNode("label","Call notes"),notes=document.createElement("textarea");
    notes.maxLength=1000;notes.rows=2;notes.placeholder="What did the owner say? What happens next?";
    notes.value=lead.salesNote||"";
    const dateLabel=textNode("label","Next callback (optional)"),date=document.createElement("input");
    date.type="datetime-local";
    if(lead.nextFollowUpAt){const stamp=new Date(lead.nextFollowUpAt);
      if(Number.isFinite(stamp.getTime()))date.value=new Date(stamp.getTime()-stamp.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    if(lead.nextFollowUpAt&&new Date(lead.nextFollowUpAt).getTime()<=Date.now()&&
      !["won","lost"].includes(lead.salesStage||"new"))
      pipeline.append(textNode("strong","Callback due — follow up with this lead.","sales-due"));
    const save=textNode("button","Save sales follow-up","button button-outline");save.type="button";
    save.disabled=lead.status==="archived";
    save.addEventListener("click",async()=>{
      if(busy)return;busy=true;save.disabled=true;$("inbox-status").textContent="Saving sales follow-up…";
      try{
        const when=date.value?new Date(date.value):null;
        if(when&&!Number.isFinite(when.getTime()))throw Error("Select a valid callback date.");
        await api("/api/leads/"+encodeURIComponent(lead.id),"PATCH",{
          salesStage:stage.value,salesNote:notes.value,nextFollowUpAt:when?when.toISOString():null
        });
        await loadLeads();$("inbox-status").textContent="Sales follow-up saved privately. No customer message sent.";
      }catch(error){$("inbox-status").textContent=error.message;}
      finally{busy=false;save.disabled=false;}
    });
    pipeline.append(stageLabel,stage,noteLabel,notes,dateLabel,date,save);
    card.append(pipeline);
    const actions=document.createElement("div");actions.className="admin-actions";
    function action(label,task,className=""){
      const button=textNode("button",label,"button button-outline "+className);button.type="button";
      button.addEventListener("click",async()=>{
        if(busy)return;busy=true;button.disabled=true;$("inbox-status").textContent="Updating enquiry…";
        try{await task();}catch(error){$("inbox-status").textContent=error.message;}
        finally{busy=false;button.disabled=false;}
      });actions.append(button);
    }
    if(lead.phone&&lead.callbackConsent){
      const dial=lead.phone.replace(/[^\d+]/g,"");
      if(/^\\+?\d{7,16}$/.test(dial)){
        const call=textNode("a","Call lead","button button-outline");
        call.href="tel:"+dial;call.title="Open the phone dialer to call this prospect";actions.append(call);
      }
    }
    if(!lead.automation&&lead.status!=="archived")action("Prepare / retry draft",async()=>{
      const data=await api("/api/leads/"+encodeURIComponent(lead.id)+"/draft","POST",{});
      await loadLeads();$("inbox-status").textContent=data.warning||data.lead?.processingError||"Draft prepared and saved for review.";
    });
    if(lead.automation){
      action("Copy draft",async()=>{await navigator.clipboard.writeText(lead.automation.replyDraft);$("inbox-status").textContent="Draft copied. Review and send it manually when ready.";});
      if(lead.status==="draft")action("Mark reviewed",async()=>{
        await api("/api/leads/"+encodeURIComponent(lead.id),"PATCH",{status:"approved"});await loadLeads();$("inbox-status").textContent="Draft marked reviewed. No message has been sent.";
      });
      if(lead.status==="approved"){
        const email=textNode("a","Open email draft","button email-action");
        email.href="mailto:"+encodeURIComponent(lead.email)+"?subject="+encodeURIComponent("Your enquiry to Calvren")+"&body="+encodeURIComponent(lead.automation.replyDraft);
        email.title="Open your email application to edit and send manually";actions.append(email);
      }
    }
    if(lead.status!=="archived")action("Archive",async()=>{
      await api("/api/leads/"+encodeURIComponent(lead.id),"PATCH",{status:"archived"});await loadLeads();$("inbox-status").textContent="Enquiry archived. It remains stored until deleted.";
    });
    action("Export record",async()=>{download("calvren-enquiry-"+lead.id+".json",lead);$("inbox-status").textContent="Record exported to this device.";});
    action("Delete permanently",async()=>{
      if(!confirm("Permanently delete this enquiry from the AI inbox? Its original Netlify Forms submission is a separate copy and must be deleted there too when appropriate.")){$("inbox-status").textContent="Deletion cancelled.";return;}
      await api("/api/leads/"+encodeURIComponent(lead.id),"DELETE");await loadLeads();$("inbox-status").textContent="Inbox record permanently deleted. Check Netlify Forms for any original submission.";
    },"danger-button");
    card.append(actions);$("lead-list").append(card);
  }
  if(!visible.length)$("lead-list").append(textNode("p",leads.length?"No enquiries match your search.":"No saved enquiries yet. Website submissions will appear here when intake and persistent storage are configured.","admin-note lead-empty"));
}
$("auth-form").addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;busy=true;const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;
  token=$("admin-token").value.trim();$("auth-status").textContent="Connecting…";
  try{
    await loadStatus();await loadLeads();$("admin-token").value="";$("workspace").hidden=false;$("disconnect").hidden=false;
    $("auth-status").textContent="Connected. Your enquiries remain private; drafts need your review.";
  }catch(error){clearWorkspace();$("auth-status").textContent=error.message;}
  finally{busy=false;button.disabled=false;}
});
$("disconnect").addEventListener("click",()=>{if(!busy)clearWorkspace();});
$("workflow-form").addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;busy=true;const form=event.currentTarget;$("prepare-lead").disabled=true;
  $("workflow-status").textContent="Saving the enquiry and preparing its draft…";
  try{
    const data=await api("/api/workflow","POST",Object.fromEntries(new FormData(form)));
    if(!data.lead)throw new Error("Unexpected workflow response.");
    $("workflow-status").textContent=data.warning||data.lead.processingError||"Enquiry and draft saved for review. No message sent.";
    form.reset();try{await loadLeads();}catch{$("inbox-status").textContent="The enquiry was saved, but the inbox could not refresh. Use Refresh to reload it.";}
  }catch(error){$("workflow-status").textContent=error.message;}
  finally{busy=false;$("prepare-lead").disabled=false;}
});
async function refresh(task,element,success){
  if(busy)return;busy=true;$(element).textContent="Checking…";
  try{await task();$(element).textContent=success;}catch(error){$(element).textContent=error.message;}finally{busy=false;}
}
$("refresh-leads").addEventListener("click",()=>refresh(loadLeads,"inbox-status","Inbox refreshed."));
$("refresh-status").addEventListener("click",()=>refresh(loadStatus,"auth-status","Service configuration checked."));
$("lead-search").addEventListener("input",renderLeads);
$("lead-filter").addEventListener("change",renderLeads);
$("sales-filter").addEventListener("change",renderLeads);
$("export-leads").addEventListener("click",()=>{
  if(busy||!leads.length)return;download("calvren-enquiries-"+new Date().toISOString().slice(0,10)+".json",leads);
  $("inbox-status").textContent=leads.length+" loaded records exported. This export does not include separate Netlify Forms submissions.";
});
window.addEventListener("pagehide",clearWorkspace);
