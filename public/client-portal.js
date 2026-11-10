import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";

const supabase=createClient("https://xjfsukhfmkgvlfpgjevg.supabase.co","sb_publishable_cCLJ_WnlgiBsHsU0BzWcvQ_ID03dhxw",{
  auth:{flowType:"implicit",detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}
});
const $=id=>document.getElementById(id);
// Must match an explicitly allowed Supabase Auth Redirect URL.
const clientRedirectUrl="https://calvren.pages.dev/client";
const isBilling=!!$("billing-checkout");
const checkoutReturn=!isBilling&&new URLSearchParams(location.search).get("checkout")==="success";
let checkoutVerificationPending=checkoutReturn,checkoutVerificationRunning=false;
const captchaSiteKey=document.querySelector('meta[name="calvren-turnstile-site-key"]')?.content?.trim()||"";
let captchaToken="",captchaWidget=null,recovery=false,passwordPanelOpen=false;
function selectAuthView(view){
  for(const [id,form] of [["signin","client-login"],["signup","client-signup"],["reset","client-reset"],["legacy","client-legacy"],["verify","client-verify"]]){
    if($(form))$(form).hidden=view!==id;
  }
  document.querySelectorAll(".auth-tab").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.authView===view)));
  notice("");
}
function captchaOptions(){if(!captchaSiteKey)return {};if(!captchaToken)throw Error("Complete the security check.");return {captchaToken};}
function resetCaptcha(){captchaToken="";if(captchaWidget!==null&&window.turnstile)window.turnstile.reset(captchaWidget);}
function showVerification(email){
  if($("verify-email"))$("verify-email").value=email;
  selectAuthView("verify");
  notice("Check your inbox for your Calvren confirmation email. If you already have an account, sign in or reset your password.");
}
function friendlyAuthError(error){
  const message=error?.message||"Please try again.";
  if(error?.status===429||/rate limit|only request this after|too many requests/i.test(message))
    return "Too many emails requested. Wait a minute before trying again.";
  if(/invalid login credentials/i.test(message))
    return "Email or password isn't correct. If you've already registered, try Forgot password instead of creating another account.";
  return message;
}
function setupCaptcha(){
  if(!captchaSiteKey||!$("client-captcha"))return;
  $("client-captcha").hidden=false;
  const script=document.createElement("script");
  script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;
  script.onload=()=>{if(window.turnstile)captchaWidget=window.turnstile.render("#client-captcha",{
    sitekey:captchaSiteKey,callback:token=>captchaToken=token,"expired-callback":()=>captchaToken="",
    "error-callback":()=>captchaToken=""
  });};
  script.onerror=()=>notice("Human verification could not load. Refresh the page.",true);
  document.head.append(script);
}
const notice=(message,error=false)=>{const node=$("client-notice");if(node){node.textContent=message;node.classList.toggle("form-error",error);}};
let ready=false;
const chosen=new URLSearchParams(location.search).get("plan");
let selectedPlan=["starter","growth","pro"].includes(chosen)?chosen:"starter";
let planAvailability={starter:false,growth:false,pro:false};
const planLabels={starter:"Starter",growth:"Growth",pro:"Pro"};
const planAmounts={starter:9900,growth:24900,pro:49900};
function selectBillingPlan(plan){
  if(!Object.hasOwn(planLabels,plan))return;
  selectedPlan=plan;
  for(const button of document.querySelectorAll("[data-select-plan]"))
    button.setAttribute("aria-pressed",String(button.dataset.selectPlan===plan));
  if($("billing-selected-tier"))$("billing-selected-tier").textContent=planLabels[plan]+" automation";
  if($("billing-price"))$("billing-price").textContent=money(planAmounts[plan],"cad")+" / month";
  if($("billing-first-payment"))$("billing-first-payment").textContent=money(planAmounts[plan]+34900,"cad")+" due initially";
  if($("billing-price-note"))$("billing-price-note").textContent=planAvailability[plan]?
    "First payment includes CA$349 one-time setup. Renewals charge the monthly plan only, before applicable taxes. Setup and activation require your approved onboarding scope.":
    "Secure online checkout for this plan is temporarily unavailable. Please contact Calvren for assistance.";
  if($("billing-checkout"))$("billing-checkout").textContent="Continue with "+planLabels[plan]+" on Stripe ↗";
}
document.querySelectorAll("[data-select-plan]").forEach(button=>
  button.addEventListener("click",()=>{selectBillingPlan(button.dataset.selectPlan);check().catch(()=>{});}));

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
    ...(options.body?{body:JSON.stringify(options.body)}:{}),
    headers:{"Authorization":"Bearer "+access,"Accept":"application/json",...(options.body?{"Content-Type":"application/json"}:{})},
  });
  const dataJson=await response.json().catch(()=>({error:"The server returned an invalid response."}));
  if(!response.ok)throw Error(dataJson.error||"This request could not complete.");
  return dataJson;
}
async function check(){
  const state=await supabase.auth.getSession();
  session=state.data.session||null;
  user=session?.user||null;
  if($("auth-panel"))$("auth-panel").hidden=!!user;
  if($("signedin-account"))$("signedin-account").hidden=!user;
  if($("client-new-password"))$("client-new-password").hidden=!user||(!recovery&&!passwordPanelOpen);
  if($("password-form-title"))$("password-form-title").textContent=recovery?"Set your new password":"Set or change your password";
  if($("billing-account-link"))$("billing-account-link").hidden=!!user;
  if($("billing-signedin-panel"))$("billing-signedin-panel").hidden=!user;
  const identity=$("client-identity");
  if(identity){identity.hidden=!user;if(user)identity.textContent="Signed in as "+user.email;}
  if($("client-signout"))$("client-signout").hidden=!user;
  if(isBilling){
    if($("billing-stripe-link")){
      $("billing-checkout").hidden=true;
      if(user)notice("Signed in. Complete payment using the secure Stripe checkout button.");
      return;
    }
    const button=$("billing-checkout");
    button.hidden=!user;
    button.disabled=!user||!planAvailability[selectedPlan];
    if(user&&planAvailability[selectedPlan])notice("You're signed in. Continue to Stripe's secure checkout.");
    else if(user&&!planAvailability[selectedPlan])notice(
      "Secure checkout for this plan is temporarily unavailable. Please contact Calvren.");
  }else if(user){
    try{
      const info=await api("me");
      $("client-membership").hidden=false;
      $("client-membership-status").textContent=info.paid?
        (info.plan?planLabels[info.plan]+" · Active subscription":"Active subscription"):
        checkoutVerificationPending?"Confirming Stripe payment…":
        info.status==="none"?"No subscription yet":info.status;
      renderModuleEntitlements(info);
      $("client-activation").textContent=info.paid?(info.activation==="connected"?
        "Your automation workspace is connected.":"Payment confirmed. Calvren will connect your business's tools before live automation starts.")
        :checkoutVerificationPending?"Your payment confirmation is processing. Please do not submit another payment.":
          "Choose a subscription to activate a client workspace.";
      const startArea=$("client-start-area"),startButton=$("client-checkout"),startNote=$("client-checkout-note");
      if(startArea)startArea.hidden=!!info.paid||checkoutVerificationPending;
      if(startButton)startButton.disabled=!ready||checkoutVerificationPending;
      if(info.paid&&checkoutVerificationPending){
        checkoutVerificationPending=false;
        notice("Payment confirmed. Your onboarding workspace is ready.");
      }
      if(startNote)startNote.textContent=ready?
        "Stripe will show the exact total before you confirm. Opening Checkout will not charge you.":"Secure checkout is temporarily unavailable. Please contact Calvren support.";
      $("client-manage").hidden=info.status==="none";
      $("client-automation").hidden=!info.paid;
      if($("client-onboarding-link"))$("client-onboarding-link").hidden=!info.paid;
      if($("client-monthly-report"))$("client-monthly-report").hidden=!(
        info.paid&&Array.isArray(info.included_features)&&info.included_features.includes("monthly_reports"));
      if(info.paid){
        if(new URLSearchParams(location.search).get("next")==="onboarding"){
          location.assign("/onboarding.html");return;
        }
        await loadAutomation();
        if(info.included_features?.includes("monthly_reports"))await loadMonthlyReport();
        if(["growth","pro"].includes(info.plan)){
          try{const hub=await import("/automation-hub.js?v=hub-20261110");await hub.renderHub(info,api);}
          catch(error){console.warn("Calvren hub unavailable.");}
        }
      }
    }catch(error){notice(error.message,true);}
  }else if($("client-membership")){$("client-membership").hidden=true;}
}
function renderModuleEntitlements(info){
  const list=$("client-module-list");
  if(!list)return;
  list.replaceChildren();
  const featureLabels=[
    ["lead_response","AI lead response"],["booking","Appointment scheduling"],
    ["follow_ups","Lead follow-up sequences"],["review_requests","Review requests"],
    ["monthly_reports","Monthly performance reports"],["custom_integrations","Custom integrations"],
    ["advanced_workflows","Advanced workflows"],["unified_inbox","Unified inbox"],
    ["priority_support","Additional support"]
  ];
  for(const [key,label] of featureLabels){
    const li=document.createElement("li");
    const included=info.paid&&Array.isArray(info.included_features)&&info.included_features.includes(key);
    li.textContent=label+" — "+(included?"Included in plan; activation subject to onboarding":"Not included");
    list.append(li);
  }
}
async function loadMonthlyReport(){
  const target=$("client-monthly-report-results");
  if(!target)return;
  try{
    const data=await api("report");
    if(data.status!=="connected"){
      target.textContent=data.message||"Your report will be available after your business is connected.";
      return;
    }
    const label=new Date(data.month+"-01T12:00:00Z").toLocaleDateString("en-CA",{month:"long",year:"numeric",timeZone:"UTC"});
    target.textContent=label+": "+data.metrics.leads+" new leads · "+data.metrics.qualified+
      " qualified or booked leads · "+data.metrics.booked_appointments+" booked appointments"+
      (data.partial?" (partial data; ask Calvren for the full report)":"")+".";
  }catch(error){target.textContent="Your report is currently unavailable. Please contact Calvren.";}
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
// A single secure client-account entry point for billing, dashboard and onboarding.
document.querySelectorAll("[data-auth-view]").forEach(b=>b.addEventListener("click",()=>selectAuthView(b.dataset.authView)));
$("client-login")?.addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const {error}=await supabase.auth.signInWithPassword({
      email:$("client-email").value.trim().toLowerCase(),password:$("client-password").value,
      ...(captchaSiteKey?{options:captchaOptions()}:{})
    });
    if(error)throw error;
    form.reset();await check();
    if(checkoutVerificationPending)void confirmCheckout();
    else notice("Signed in. Continue to your subscription below.");
  }catch(e){
    if(e?.code==="email_not_confirmed"||/email not confirmed/i.test(e?.message||"")){
      showVerification($("client-email").value.trim().toLowerCase());
      notice("Your email isn't confirmed yet. Use the link in your inbox or request another one below.");
    }else notice(friendlyAuthError(e),true);
  }
  finally{button.disabled=false;resetCaptcha();}
});
$("client-signup")?.addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const email=$("signup-email").value.trim().toLowerCase();
    const password=$("signup-password").value;
    if(password.length<8)throw Error("Use at least 8 characters for your password.");
    if(password!==$("signup-password-confirm").value)throw Error("The passwords don't match.");
    const {data,error}=await supabase.auth.signUp({
      email,password,
      options:{emailRedirectTo:clientRedirectUrl,...captchaOptions()}
    });
    if(error)throw error;
    form.reset();
    if(data?.session){await check();notice("Your account is ready. Continue to your subscription.");}
    else showVerification(email);
  }catch(e){notice(friendlyAuthError(e),true);}
  finally{button.disabled=false;resetCaptcha();}
});
$("client-verify")?.addEventListener("submit",async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
  try{
    const email=$("verify-email").value.trim().toLowerCase();
    const {error}=await supabase.auth.resend({
      type:"signup",email,options:{emailRedirectTo:clientRedirectUrl,...captchaOptions()}
    });
    if(error)throw error;
    notice("Verification email requested. Check your inbox and spam folder. If your account is already confirmed, sign in instead.");
  }catch(e){notice(friendlyAuthError(e),true);}
  finally{button.disabled=false;resetCaptcha();}
});
$("client-reset")?.addEventListener("submit",async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
  try{
    const {error}=await supabase.auth.resetPasswordForEmail($("reset-email").value.trim().toLowerCase(),
      {redirectTo:clientRedirectUrl,...captchaOptions()});
    if(error)throw error;
    notice("If an account exists for that address, a secure password reset link will arrive shortly.");
  }catch(e){notice(e.message||"Unable to request a reset.",true);}
  finally{button.disabled=false;resetCaptcha();}
});
$("client-legacy")?.addEventListener("submit",async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
  try{
    const {error}=await supabase.auth.signInWithOtp({
      email:$("legacy-email").value.trim().toLowerCase(),
      options:{emailRedirectTo:clientRedirectUrl,shouldCreateUser:false,...captchaOptions()}
    });
    if(error)throw error;
    notice("If your existing account is eligible, your one-time sign-in link will arrive. Set a password after signing in.");
  }catch(e){notice(e.message||"Unable to request your existing-account link.",true);}
  finally{button.disabled=false;resetCaptcha();}
});
$("client-password-toggle")?.addEventListener("click",()=>{
  passwordPanelOpen=!passwordPanelOpen;
  if($("client-new-password"))$("client-new-password").hidden=!passwordPanelOpen&&!recovery;
});
$("client-new-password")?.addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const password=$("new-client-password").value;
    if(password.length<8)throw Error("Use at least 8 characters.");
    if(password!==$("new-client-password-confirm").value)throw Error("The passwords don't match.");
    const {error}=await supabase.auth.updateUser({password});
    if(error)throw error;
    recovery=false;passwordPanelOpen=false;form.reset();form.hidden=true;
    notice("Password saved. Use it the next time you sign in.");
  }catch(e){notice(e.message||"Unable to update password.",true);}
  finally{button.disabled=false;}
});
$("client-signout")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.assign("/client.html");});
async function startCheckout(button){
  if(!button||!ready)return;
  button.disabled=true;
  notice("Opening Stripe checkout…");
  try{
    const result=await api("checkout",{method:"POST",body:{plan:isBilling?selectedPlan:"starter"}});
    const url=new URL(result.url);
    if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("Invalid checkout destination.");
    location.assign(url.href);
  }catch(error){notice(error.message,true);button.disabled=false;}
}
for(const id of ["billing-checkout","client-checkout"]){
  $(id)?.addEventListener("click",event=>startCheckout(event.currentTarget));
}
$("client-manage")?.addEventListener("click",async()=>{
  const button=$("client-manage");button.disabled=true;
  try{
    const result=await api("portal",{method:"POST"});
    const url=new URL(result.url);
    if(url.protocol!=="https:"||url.hostname!=="billing.stripe.com")throw Error("Invalid billing portal destination.");
    location.assign(url.href);
  }catch(error){notice(error.message,true);button.disabled=false;}
});
async function confirmCheckout(){
  if(!checkoutVerificationPending||checkoutVerificationRunning||!user)return;
  checkoutVerificationRunning=true;
  const until=Date.now()+30_000;
  try{
    while(checkoutVerificationPending&&Date.now()<until){
      try{
        const info=await api("me");
        if(info.paid){
          checkoutVerificationPending=false;
          await check();
          notice("Payment confirmed. Continue to your secure onboarding workspace.");
          return;
        }
      }catch{/* Stripe webhook and membership update may still be processing. */}
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
    if(checkoutVerificationPending)
      notice("Your payment has not been confirmed yet. Please don't pay again. Refresh this dashboard shortly or contact Calvren support if the status doesn't update.",true);
  }finally{checkoutVerificationRunning=false;}
}
async function init(){
  // Supabase may return auth errors in URL fragments or query parameters.
  const authQuery=new URLSearchParams(location.search);
  const authHash=new URLSearchParams(location.hash.replace(/^#/,""));
  const returnedError=authQuery.get("error_description")||authHash.get("error_description")||authQuery.get("error")||authHash.get("error");
  if(isBilling){
    try{
      const response=await fetch("/api/billing/public",{headers:{"Accept":"application/json"}});
      const data=await response.json();
      ready=response.ok&&!!data.ready;
      planAvailability={
        starter:ready&&((data.plans?.starter?.ready)??true),
        growth:!!data.plans?.growth?.ready,
        pro:ready&&!!data.plans?.pro?.ready
      };
      if($("billing-stripe-link"))planAvailability={starter:false,growth:false,pro:false};
      selectBillingPlan(selectedPlan);
    }catch{
      planAvailability={starter:false,growth:false,pro:false};
      selectBillingPlan(selectedPlan);
    }
  }
  if(!isBilling){
    try{
      const response=await fetch("/api/billing/public",{headers:{"Accept":"application/json"}});
      const data=await response.json();
      ready=response.ok&&!!data.ready;
    }catch{ready=false;}
  }
  if((authHash.get("type")||authQuery.get("type"))==="recovery")recovery=true;
  if(!isBilling)setupCaptcha();
  if(checkoutReturn)
    notice("Checking your payment with Stripe. Please don't start another checkout.");
  await check();
  if(checkoutVerificationPending){
    if(user)void confirmCheckout();
    else notice("Sign in with your Calvren account to confirm your payment and continue onboarding.");
  }
  if(returnedError)notice("Your account link could not be used: "+returnedError.replaceAll("+"," ")+". Request a fresh link.",true);
  else if(recovery&&user)notice("Choose a new password below to finish resetting your account.");
}
supabase.auth.onAuthStateChange(event=>{
  if(event==="PASSWORD_RECOVERY"){recovery=true;passwordPanelOpen=true;}
  setTimeout(()=>check().catch(()=>{}),0);
});
init().catch(error=>notice(error.message||"Unable to initialize client access.",true));
