// Calvren Growth/Pro hub. A verified Supabase session is supplied by client-portal.js.
// No client ID or subscription tier from the browser is used as authorization.
const el=(tag,cls,text)=>{
  const node=document.createElement(tag);if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);return node;
};
const status=(node,message,isError=false)=>{node.textContent=message;node.style.color=isError?"#a32d28":"";};
export async function renderHub(info,api){
  const root=document.getElementById("client-hub");
  if(!root)return;
  root.hidden=!info.paid||!["growth","pro"].includes(info.plan);
  if(root.hidden)return;
  root.replaceChildren();
  const heading=el("div","hub-head");
  heading.append(el("p","eyebrow",info.plan.toUpperCase()+" AUTOMATION WORKSPACE"),
    el("h2",null,"Manage your automations"),
    el("p","billing-small","Live actions run only after your business is linked and the approved workflow is marked live. Outbound communication requires explicit customer consent."));
  root.append(heading);
  const feedback=el("p","billing-notice");feedback.setAttribute("role","status");root.append(feedback);
  let config;
  try{config=await api("hub/settings");}catch(error){status(feedback,error.message,true);return;}
  if(config.status!=="live"){
    status(feedback,config.message||"Complete onboarding and launch approval before activating customer-facing workflows.");
    return;
  }
  const setting=config.settings||{};
  const settingsBox=el("section","hub-panel");
  settingsBox.append(el("h3",null,"Growth automations"));
  const form=el("form","hub-settings");
  const linkLabel=el("label",null,"Google Business review link");
  const link=el("input");link.type="url";link.placeholder="https://g.page/r/your-business/review";
  link.maxLength=500;link.value=setting.review_url||"";linkLabel.append(link);
  const toggles=[
    ["review_enabled","Send one review invitation 24 hours after I confirm a completed service"],
    ["report_enabled","Email my business a monthly performance report"],
    ...(info.plan==="pro"?[["pro_alert_enabled","Email a human-handoff alert when a lead needs attention"]]:[])
  ];
  form.append(linkLabel);
  const switches={};
  for(const [field,label] of toggles){
    const box=el("label","hub-toggle"),check=el("input");
    check.type="checkbox";check.checked=!!setting[field];switches[field]=check;
    box.append(check,el("span",null,label));form.append(box);
  }
  form.append(el("p","billing-small","Review emails are neutral, not filtered by rating, and are sent only to customers who explicitly opted in. Reports contain aggregate counts, not customer contact details."));
  const save=el("button","button","Save automation settings");save.type="submit";
  form.append(save);settingsBox.append(form);root.append(settingsBox);
  form.addEventListener("submit",async event=>{
    event.preventDefault();save.disabled=true;
    try{
      const body={review_url:link.value.trim(),review_enabled:switches.review_enabled.checked,
        report_enabled:switches.report_enabled.checked,
        pro_alert_enabled:!!switches.pro_alert_enabled?.checked};
      await api("hub/settings",{method:"PUT",body});
      status(feedback,"Your preferences are saved. The daily scheduler handles eligible events after consent and onboarding checks.");
    }catch(error){status(feedback,error.message,true);}
    finally{save.disabled=false;}
  });
  const completeBox=el("section","hub-panel");
  completeBox.append(el("h3",null,"Completed appointments"),el("p","billing-small",
    "Confirm only services that actually took place. An invitation will be considered after 24 hours only when the customer separately opted into review emails."));
  const completedList=el("div","hub-stack");completeBox.append(completedList);root.append(completeBox);
  async function loadCompletions(){
    completedList.replaceChildren(el("p","billing-small","Loading appointments…"));
    try{
      const data=await api("hub/completions");
      completedList.replaceChildren();
      if(!data.appointments?.length){completedList.append(el("p","billing-small","No past booked appointments yet."));return;}
      for(const appointment of data.appointments){
        const row=el("div","hub-appointment");
        row.append(el("span",null,new Date(appointment.ends_at).toLocaleString("en-CA")));
        const btn=el("button","button button-outline",appointment.confirmed?"Completion confirmed":"Confirm completed");
        btn.type="button";btn.disabled=appointment.confirmed;
        btn.addEventListener("click",async()=>{
          btn.disabled=true;
          try{
            await api("hub/completions",{method:"POST",body:{appointment_id:appointment.id,confirmed:true}});
            status(feedback,"Service completion recorded. Review invitation eligibility will be checked on the daily scheduler.");
            await loadCompletions();
          }catch(error){btn.disabled=false;status(feedback,error.message,true);}
        });
        row.append(btn);completedList.append(row);
      }
    }catch(error){completedList.replaceChildren(el("p","billing-small",error.message));}
  }
  await loadCompletions();
  if(info.plan!=="pro")return;
  const inbox=el("section","hub-panel");
  inbox.append(el("h3",null,"Pro unified inbox"),el("p","billing-small",
    "View website, SMS and other recorded lead activity in one tenant-private workspace. Notes are internal. Manual SMS replies require active Twilio integration and customer SMS consent."));
  const inLayout=el("div","hub-inbox");
  const threads=el("div","hub-threads"),conversation=el("div","hub-thread");
  inLayout.append(threads,conversation);inbox.append(inLayout);
  root.append(inbox);
  const integration=el("p","billing-small",
    "Advanced workflows: signed booking/handoff webhooks can be connected to approved automation platforms by Calvren. "+(setting.integration_enabled?"An integration endpoint is configured.":"No outbound integration endpoint is approved yet."));
  inbox.append(integration);
  async function loadThread(id){
    conversation.replaceChildren(el("p","billing-small","Loading conversation…"));
    try{
      const data=await api("hub/inbox/"+id);
      conversation.replaceChildren(el("h4",null,data.lead?.name||"Conversation"));
      const contact=el("p","billing-small",
        (data.lead?.channel||"website")+" · "+(data.lead?.email||"No email")+" · "+(data.lead?.phone||"No phone"));
      conversation.append(contact);
      const stream=el("div","hub-messages");
      const messages=(data.messages||[]).slice().sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")));
      for(const message of messages){
        const item=el("div","hub-message");
        item.append(el("strong",null,(message.sender||"message")+" · "+(message.channel||"website")),
          el("p",null,message.message||""),el("small",null,(message.timestamp||"")+" · "+(message.status||"")));
        stream.append(item);
      }
      if(!messages.length)stream.append(el("p","billing-small","No conversation messages yet."));
      conversation.append(stream);
      const notes=el("div","hub-notes");notes.append(el("h4",null,"Internal notes"));
      for(const n of data.notes||[])notes.append(el("p","billing-small",(n.created_at||"")+": "+(n.body||"")));
      const noteForm=el("form","hub-note-form"),field=el("textarea");
      field.maxLength=2000;field.placeholder="Private note for your team";field.required=true;
      const button=el("button","button button-outline","Add private note");button.type="submit";
      noteForm.append(field,button);notes.append(noteForm);conversation.append(notes);
      noteForm.addEventListener("submit",async e=>{
        e.preventDefault();button.disabled=true;
        try{await api("hub/inbox/"+id+"/notes",{method:"POST",body:{body:field.value.trim()}});
          status(feedback,"Private note saved.");await loadThread(id);
        }catch(error){button.disabled=false;status(feedback,error.message,true);}
      });
      if(data.lead?.channel==="sms"&&!data.lead?.opted_out){
        const reply=el("form","hub-reply-form"),field=el("textarea");
        field.maxLength=800;field.placeholder="Human-reviewed SMS reply (800 characters maximum)";
        field.required=true;
        const confirm=el("label","hub-toggle"),box=el("input");
        box.type="checkbox";box.required=true;
        confirm.append(box,el("span",null,"I confirm this customer consented to SMS and approve sending this message."));
        const send=el("button","button","Send SMS via Twilio");send.type="submit";
        reply.append(field,confirm,send);conversation.append(reply);
        reply.addEventListener("submit",async event=>{
          event.preventDefault();send.disabled=true;
          try{
            await api("hub/inbox/"+id+"/reply",{method:"POST",
              body:{message:field.value.trim(),nonce:crypto.randomUUID(),confirmed:true}});
            status(feedback,"Twilio accepted the SMS request. Delivery status may update later.");
            await loadThread(id);
          }catch(error){send.disabled=false;status(feedback,error.message,true);}
        });
      }else if(data.lead?.email){
        const link=el("a","text-link","Reply in your email app");
        link.href="mailto:"+encodeURIComponent(data.lead.email).replace(/%40/g,"@");
        conversation.append(link);
      }
    }catch(error){conversation.replaceChildren(el("p","billing-small",error.message));}
  }
  async function loadInbox(){
    threads.replaceChildren(el("p","billing-small","Loading client conversations…"));
    try{
      const data=await api("hub/inbox");
      threads.replaceChildren();
      const all=(data.threads||[]).slice().sort((a,b)=>String(b.last_activity||"").localeCompare(String(a.last_activity||"")));
      if(!all.length){threads.append(el("p","billing-small","No client messages yet."));return;}
      for(const thread of all){
        const b=el("button","hub-thread-button",thread.name+" · "+thread.channel+" · "+thread.status);
        b.type="button";b.append(el("small",null,thread.last_message||"No message preview"));
        b.addEventListener("click",()=>loadThread(thread.id));threads.append(b);
      }
      await loadThread(all[0].id);
    }catch(error){threads.replaceChildren(el("p","billing-small",error.message));}
  }
  await loadInbox();
}
