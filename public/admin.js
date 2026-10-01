const $ = (id) => document.getElementById(id);
let token = "";
let busy = false;
async function api(path, method = "GET", payload) {
  const response = await fetch(path, {method,headers:{"Authorization":"Bearer " + token,...(payload ? {"Content-Type":"application/json"} : {})},...(payload ? {body:JSON.stringify(payload)} : {}),cache:"no-store"});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The workflow request could not be completed.");
  return body;
}
function textNode(tag, value, className) { const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node; }
function renderLeads(leads) {
  $("lead-list").replaceChildren();
  for (const lead of leads) {
    const card=document.createElement("article");card.className="lead-card";
    const statusLabel={draft:"Awaiting review",approved:"Reviewed · not sent",archived:"Archived"}[lead.status] || "Unknown status";
    card.append(textNode("h3",lead.name + " · " + lead.automation.category),textNode("span",statusLabel,"tag"),textNode("p",lead.email),textNode("p","Original enquiry\n" + lead.enquiry),textNode("p",lead.automation.summary),textNode("p","Priority: " + lead.automation.priority),textNode("p","Reply draft\n" + lead.automation.replyDraft),textNode("p","Next action\n" + lead.automation.nextAction));
    const actions=document.createElement("div");actions.className="admin-actions";
    const copy=document.createElement("button");copy.type="button";copy.className="button button-outline";copy.textContent="Copy draft";
    copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(lead.automation.replyDraft);copy.textContent="Copied";}catch{copy.textContent="Select draft text to copy";}});
    actions.append(copy);
    for (const [status,label] of [["approved","Mark reviewed"],["archived","Archive"]]) {
      if (lead.status === status || lead.status === "archived") continue;
      const button=document.createElement("button");button.type="button";button.className="button button-outline";button.textContent=label;
      button.addEventListener("click",async()=>{
        if(busy)return;busy=true;button.disabled=true;$("inbox-status").textContent="Updating record…";
        try{await api("/api/leads/" + encodeURIComponent(lead.id),"PATCH",{status});await loadLeads();$("inbox-status").textContent=status==="approved"?"Draft marked reviewed. Nothing has been sent.":"Record archived.";}
        catch(error){$("inbox-status").textContent=error.message;}
        finally{busy=false;button.disabled=false;}
      });actions.append(button);
    }
    card.append(actions);$("lead-list").append(card);
  }
  if(!leads.length)$("lead-list").append(textNode("p","No saved drafts yet. Prepare a lead to get started.","admin-note"));
}
async function loadLeads(){const body=await api("/api/leads");if(!Array.isArray(body.leads))throw new Error("Unexpected inbox response.");renderLeads(body.leads);}
$("auth-form").addEventListener("submit",async(event)=>{
  event.preventDefault();if(busy)return;busy=true;const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;
  token=$("admin-token").value.trim();$("auth-status").textContent="Connecting…";
  try{await loadLeads();$("admin-token").value="";$("workspace").hidden=false;$("disconnect").hidden=false;$("auth-status").textContent="Connected. AI results still need human review.";}
  catch(error){token="";$("workspace").hidden=true;$("lead-list").replaceChildren();$("auth-status").textContent=error.message;}
  finally{busy=false;button.disabled=false;}
});
$("disconnect").addEventListener("click",()=>{if(busy)return;token="";$("admin-token").value="";$("lead-list").replaceChildren();$("workspace").hidden=true;$("disconnect").hidden=true;$("auth-status").textContent="Disconnected.";$("workflow-form").reset();$("workflow-status").textContent="";});
$("workflow-form").addEventListener("submit",async(event)=>{
  event.preventDefault();const form=event.currentTarget;if(busy)return;busy=true;$("prepare-lead").disabled=true;$("workflow-status").textContent="Preparing the draft with AI…";
  const payload=Object.fromEntries(new FormData(form));
  try{const body=await api("/api/workflow","POST",payload);if(!body.lead)throw new Error("Unexpected workflow response.");$("workflow-status").textContent="Draft saved for review. No message sent.";form.reset();try{await loadLeads();}catch{$("inbox-status").textContent="Draft saved, but the inbox could not refresh. Use Refresh to reload it.";}}
  catch(error){$("workflow-status").textContent=error.message;}
  finally{busy=false;$("prepare-lead").disabled=false;}
});
$("refresh-leads").addEventListener("click",async()=>{if(busy)return;busy=true;$("inbox-status").textContent="Refreshing…";try{await loadLeads();$("inbox-status").textContent="Inbox refreshed.";}catch(error){$("inbox-status").textContent=error.message;}finally{busy=false;}});
window.addEventListener("pagehide",()=>{token="";$("lead-list").replaceChildren();$("workspace").hidden=true;$("disconnect").hidden=true;$("auth-status").textContent="Not connected.";$("admin-token").value="";});
