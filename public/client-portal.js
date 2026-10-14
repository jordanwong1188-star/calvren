import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";

const supabase=createClient("https://xjfsukhfmkgvlfpgjevg.supabase.co","sb_publishable_cCLJ_WnlgiBsHsU0BzWcvQ_ID03dhxw",{
  auth:{flowType:"implicit",detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}
});
const $=id=>document.getElementById(id);
const isBilling=!!$("billing-checkout");
const notice=(message,error=false)=>{const node=$("client-notice");if(node){node.textContent=message;node.classList.toggle("form-error",error);}};
let ready=false;
let user=null;
let session=null;
function money(amount,currency){
  try{return new Intl.NumberFormat("en-CA",{style:"currency",currency:currency.toUpperCase()}).format(amount/100);}
  catch{return (amount/100).toFixed(2)+" "+currency.toUpperCase();}
}
async function api(path,options={}){
  const {data}=await supabase.auth.getSession();
  const access=data.session?.access_token;
  if(!access)throw Error("Sign in first.");
  const response=await fetch("/api/billing/"+path,{
    method:options.method||"GET",credentials:"omit",
    headers:{"Authorization":"Bearer "+access,"Accept":"application/json"},
  });
  const dataJson=await response.json().catch(()=>({error:"The server returned an invalid response."}));
  if(!response.ok)throw Error(dataJson.error||"This request could not complete.");
  return dataJson;
}
async function check(){
  const state=await supabase.auth.getSession();
  session=state.data.session||null;
  user=session?.user||null;
  const login=$("client-login");
  if(login)login.hidden=!!user;
  const identity=$("client-identity");
  if(identity){identity.hidden=!user;if(user)identity.textContent="Signed in as "+user.email;}
  if($("client-signout"))$("client-signout").hidden=!user;
  if(isBilling){
    const button=$("billing-checkout");
    button.hidden=!user;
    button.disabled=!user||!ready;
    if(user&&ready)notice("You're signed in. Continue to Stripe's secure checkout.");
    else if(user&&!ready)notice("Stripe subscription checkout is not active yet. Contact Calvren for an onboarding quote.");
  }else if(user){
    try{
      const info=await api("me");
      $("client-membership").hidden=false;
      $("client-membership-status").textContent=info.paid?"Active subscription":info.status==="none"?"No subscription":info.status;
      $("client-activation").textContent=info.paid?(info.activation==="connected"?
        "Your automation workspace is connected.":"Payment confirmed. Calvren will connect your business's tools before live automation starts.")
        :"Choose a subscription to activate a client workspace.";
      $("client-manage").hidden=info.status==="none";
      $("client-automation").hidden=!info.paid;
      if(info.paid)await loadAutomation();
    }catch(error){notice(error.message,true);}
  }else{$("client-membership").hidden=true;}
}
async function loadAutomation(){
  try{
    const data=await api("automation");
    const target=$("client-leads");
    target.replaceChildren();
    if(data.status!=="connected"){
      target.textContent=data.message||"Onboarding is in progress. Your services will appear here after setup.";
      return;
    }
    if(!data.leads.length){target.textContent="No automation activity has been recorded for your business yet.";return;}
    for(const lead of data.leads){
      const row=document.createElement("li");
      row.textContent="Enquiry "+String(lead.id).slice(0,8)+" — "+String(lead.status).replaceAll("_"," ");
      target.append(row);
    }
  }catch(error){notice(error.message,true);}
}
const login=$("client-login");
if(login)login.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=login.querySelector("button[type=submit]"),email=login.querySelector("input[type=email]").value.trim();
  button.disabled=true;
  try{
    const {error}=await supabase.auth.signInWithOtp({
      email,options:{emailRedirectTo:location.origin+"/client.html",shouldCreateUser:true}
    });
    if(error)throw error;
    notice("Check your inbox for the Calvren sign-in link. It may take a moment.");
  }catch(error){notice(error.message||"Could not send sign-in email.",true);}
  finally{button.disabled=false;}
});
$("client-signout")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.assign("/payment");});
$("billing-checkout")?.addEventListener("click",async()=>{
  const button=$("billing-checkout");button.disabled=true;
  notice("Opening Stripe checkout…");
  try{
    const result=await api("checkout",{method:"POST"});
    const url=new URL(result.url);
    if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("Invalid checkout destination.");
    location.assign(url.href);
  }catch(error){notice(error.message,true);button.disabled=false;}
});
$("client-manage")?.addEventListener("click",async()=>{
  const button=$("client-manage");button.disabled=true;
  try{
    const result=await api("portal",{method:"POST"});
    const url=new URL(result.url);
    if(url.protocol!=="https:"||url.hostname!=="billing.stripe.com")throw Error("Invalid billing portal destination.");
    location.assign(url.href);
  }catch(error){notice(error.message,true);button.disabled=false;}
});
async function init(){
  if(isBilling){
    try{
      const response=await fetch("/api/billing/public",{headers:{"Accept":"application/json"}});
      const data=await response.json();
      ready=!!data.ready;
      $("billing-price").textContent=ready?
        money(data.amount,data.currency)+" / "+(data.interval_count===1?data.interval:data.interval_count+" "+data.interval+"s"):
        "Custom onboarding";
      $("billing-price-note").textContent=ready?(data.test_mode?
        "Stripe TEST MODE — no real charge will be made.":"Amount and taxes are confirmed by Stripe before you pay."):
        "Recurring service pricing is agreed in your proposal. Online checkout is being configured.";
    }catch{$("billing-price-note").textContent="Payment details are temporarily unavailable.";}
  }
  if(new URLSearchParams(location.search).get("checkout")==="success")
    notice("Thanks. Stripe is confirming your subscription; your access will appear once its signed payment event arrives.");
  await check();
}
supabase.auth.onAuthStateChange(()=>{setTimeout(()=>check().catch(()=>{}),0);});
init().catch(error=>notice(error.message||"Unable to initialize client access.",true));
