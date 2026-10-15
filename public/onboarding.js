import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const supabase=createClient("https://xjfsukhfmkgvlfpgjevg.supabase.co","sb_publishable_cCLJ_WnlgiBsHsU0BzWcvQ_ID03dhxw",{
  auth:{flowType:"implicit",detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}
});
const $=id=>document.getElementById(id);
const controls=[...document.querySelectorAll("#onboarding-form [name]")];
let step=1,busy=false,form={},session=null;
function show(name){
  ["auth-panel","access-panel","onboarding-app"].forEach(id=>$(id).hidden=id!==name);
}
function message(text,error=false){
  const target=$("form-message");
  target.textContent=text;target.dataset.error=error?"true":"false";
}
async function request(method="GET",body){
  const {data}=await supabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw Error("Please sign in again.");
  const response=await fetch("/api/onboarding",{
    method,headers:{Authorization:"Bearer "+token,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),credentials:"omit",cache:"no-store"
  });
  const result=await response.json().catch(()=>({error:"The server returned an unexpected response."}));
  if(!response.ok)throw Error(result.error||"Couldn't complete this request.");
  return result;
}
function collect(){
  for(const input of controls){
    if(input.type==="checkbox")form[input.name]=input.checked;
    else form[input.name]=input.value;
  }
}
function restore(){
  for(const input of controls){
    if(input.type==="checkbox")input.checked=form[input.name]===true;
    else if(form[input.name]!==undefined)input.value=form[input.name];
  }
}
function render(){
  for(const page of document.querySelectorAll(".ob-page"))page.hidden=Number(page.dataset.step)!==step;
  $("step-indicator").textContent="STEP "+step+" OF 4";
  $("progress-bar").style.width=step*25+"%";
  for(const btn of document.querySelectorAll("#step-nav button")){
    const selected=Number(btn.dataset.goto)===step;
    btn.setAttribute("aria-current",selected?"step":"false");
  }
  $("back-btn").hidden=step===1;
  $("next-btn").hidden=step===4;
  $("submit-btn").hidden=step!==4;
  if(step===4)review();
  message("");
}
function review(){
  const labels=[["Business",form.business_name],["Industry",form.industry],["Services",form.services],["Enquiries",form.lead_sources],["Hours",form.business_hours],["Handoff email",form.handoff_email],["Booking",form.booking_duration]];
  const container=$("review-summary");
  container.replaceChildren();
  for(const [title,value] of labels){
    const row=document.createElement("div"),label=document.createElement("dt"),data=document.createElement("dd");
    row.className="ob-review-item";label.textContent=title;data.textContent=value||"To be confirmed";
    row.append(label,data);container.append(row);
  }
}
function validateCurrent(){
  const page=document.querySelector('.ob-page[data-step="'+step+'"]');
  const fields=[...page.querySelectorAll("input[required],select[required],textarea[required],input[type=email],input[type=url]")];
  for(const field of fields){
    if(!field.checkValidity()||field.required&&!field.value.trim()){
      field.reportValidity();field.focus();return false;
    }
  }
  return true;
}
async function save(nextStep=step,submit=false){
  if(busy)return false;
  busy=true;
  const buttons=[$("save-btn"),$("next-btn"),$("back-btn"),$("submit-btn")];
  buttons.forEach(b=>b.disabled=true);
  message(submit?"Submitting your details…":"Saving your progress…");
  try{
    collect();
    const result=await request(submit?"POST":"PUT",{form,current_step:nextStep});
    if(submit){showSubmitted(result.record);return true}
    step=nextStep;render();
    $("saved-indicator").textContent="Progress saved securely";
    return true;
  }catch(error){message(error.message,true);return false}
  finally{busy=false;buttons.forEach(b=>b.disabled=false)}
}
function showSubmitted(record){
  $("wizard-container").hidden=true;
  $("submitted-panel").hidden=false;
  document.querySelectorAll("#step-nav button").forEach(btn=>btn.disabled=true);
  const stages=[
    ["submitted","Questionnaire received","Your details are safely on file."],
    ["reviewing","Implementation review","We review your services, workflow rules and next steps."],
    ["building","Connections and configuration","We arrange authorized integrations and set up your automation."],
    ["testing","Quality assurance","We test actual messaging, availability and handoff paths."],
    ["live","Launched","Your automation is connected to your business."],
  ];
  const timeline=$("review-timeline");timeline.replaceChildren();
  const position=record?.status==="needs_details"?1:record?.status==="draft"?0:Math.max(0,stages.findIndex(x=>x[0]===record?.status));
  for(let i=0;i<stages.length;i++){
    const row=document.createElement("div"),title=document.createElement("strong"),detail=document.createElement("p");
    row.className="ob-milestone";row.dataset.done=i<=position?"true":"false";
    title.textContent=stages[i][1];detail.textContent=stages[i][2];row.append(title,detail);timeline.append(row);
  }
  const note=$("owner-note");
  note.hidden=!record?.owner_note;
  note.textContent=record?.owner_note?"Note from Calvren: "+record.owner_note:"";
  if(record?.status==="needs_details"){
    $("wizard-container").hidden=false;
    $("submitted-panel").hidden=true;
    document.querySelectorAll("#step-nav button").forEach(btn=>btn.disabled=false);
    step=1;render();message("Calvren requested a few adjustments. Please revise and resubmit your questionnaire.",true);
  }
}
async function load(){
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session){
    show("auth-panel");
    return;
  }
  session=data.session;
  try{
    const result=await request();
    form=result.record?.form||{};
    if(!form.contact_email)form.contact_email=result.email||"";
    if(!form.handoff_email)form.handoff_email=result.email||"";
    step=Math.max(1,Math.min(4,result.record?.current_step||1));
    restore();show("onboarding-app");
    if(result.record&&!["draft","needs_details"].includes(result.record.status))showSubmitted(result.record);
    else {render();if(result.record?.status==="needs_details")message("Calvren requested a few adjustments. Please review and resubmit.",true)}
  }catch(error){
    $("access-message").textContent=error.message;
    show("access-panel");
  }
}
$("signin")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const btn=event.currentTarget.querySelector("button"),email=$("signin-email").value.trim();
  btn.disabled=true;btn.textContent="Sending your link…";
  try{
    const {error}=await supabase.auth.signInWithOtp({
      email,options:{emailRedirectTo:"https://calvren.pages.dev/client",shouldCreateUser:true}
    });
    if(error)throw error;
    btn.textContent="Check your email for a sign-in link ✓";
  }catch(e){btn.textContent=e.message;btn.disabled=false}
});
$("onboarding-form").addEventListener("submit",event=>event.preventDefault());
$("next-btn").addEventListener("click",async()=>{
  collect();if(!validateCurrent())return;
  await save(Math.min(4,step+1));
});
$("back-btn").addEventListener("click",async()=>{collect();await save(Math.max(1,step-1))});
$("save-btn").addEventListener("click",async()=>{await save(step);if(!$("form-message").dataset.error||$("form-message").dataset.error!=="true")message("Your progress was saved. Return using your client dashboard anytime.")});
$("submit-btn").addEventListener("click",async()=>{collect();if(!validateCurrent())return;await save(4,true)});
document.querySelectorAll("#step-nav button").forEach(btn=>btn.addEventListener("click",async()=>{collect();await save(Number(btn.dataset.goto))}));
load().catch(()=>show("auth-panel"));
