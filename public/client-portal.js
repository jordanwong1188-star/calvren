import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";

const supabase=createClient("https://xjfsukhfmkgvlfpgjevg.supabase.co","sb_publishable_cCLJ_WnlgiBsHsU0BzWcvQ_ID03dhxw",{
  auth:{flowType:"implicit",detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}
});
const $=id=>document.getElementById(id);
// Must match an explicitly allowed Supabase Auth Redirect URL.
const clientRedirectUrl="https://calvren.pages.dev/client";
const isBilling=!!$("billing-checkout");
const captchaSiteKey=document.querySelector('meta[name="calvren-turnstile-site-key"]')?.content?.trim()||"";
let captchaToken="",captchaWidget=null,recovery=false,passwordPanelOpen=false;
function selectAuthView(view){
  for(const [id,form] of [["signin","client-login"],["signup","client-signup"],["reset","client-reset"],["legacy","client-legacy"]]){
    if($(form))$(form).hidden=view!==id;
  }
  document.querySelectorAll(".auth-tab").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.authView===view)));
  notice("");
}
function captchaOptions(){if(!captchaSiteKey)return {};if(!captchaToken)throw Error("Complete the security check.");return {captchaToken};}
function resetCaptcha(){captchaToken="";if(captchaWidget!==null&&window.turnstile)window.turnstile.reset(captchaWidget);}
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
    button.disabled=!user||!ready;
    if(user&&ready)notice("You're signed in. Continue to Stripe's secure checkout.");
    else if(user&&!ready)notice("Secure online checkout is temporarily unavailable. Please contact the Calvren team to get started.");
  }else if(user){
    try{
      const info=await api("me");
      $("client-membership").hidden=false;
      $("client-membership-status").textContent=info.paid?"Active subscription":info.status==="none"?"No subscription yet":info.status;
      $("client-activation").textContent=info.paid?(info.activation==="connected"?
        "Your automation workspace is connected.":"Payment confirmed. Calvren will connect your business's tools before live automation starts.")
        :"Choose a subscription to activate a client workspace.";
      const startArea=$("client-start-area"),startButton=$("client-checkout"),startNote=$("client-checkout-note");
      if(startArea)startArea.hidden=!!info.paid;
      if(startButton)startButton.disabled=!ready;
      if(startNote)startNote.textContent=ready?
        "Stripe will show the exact total before you confirm. Opening Checkout will not charge you.":"Secure checkout is temporarily unavailable. Please contact Calvren support.";
      $("client-manage").hidden=info.status==="none";
      $("client-automation").hidden=!info.paid;
      if($("client-onboarding-link"))$("client-onboarding-link").hidden=!info.paid;
      if(info.paid)await loadAutomation();
    }catch(error){notice(error.message,true);}
  }else if($("client-membership")){$("client-membership").hidden=true;}
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
    form.reset();await check();notice("Signed in. Continue to your subscription below.");
  }catch(e){notice(e.message||"Sign-in failed. Please check your details.",true);}
  finally{button.disabled=false;resetCaptcha();}
});
$("client-signup")?.addEventListener("submit",async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const password=$("signup-password").value;
    if(password.length<12)throw Error("Use at least 12 characters for your password.");
    if(password!==$("signup-password-confirm").value)throw Error("The passwords don't match.");
    const {data,error}=await supabase.auth.signUp({
      email:$("signup-email").value.trim().toLowerCase(),password,
      options:{emailRedirectTo:clientRedirectUrl,...captchaOptions()}
    });
    if(error)throw error;
    form.reset();
    if(data?.session){await check();notice("Your account is ready. Continue to your subscription.");}
    else{selectAuthView("signin");notice("Check your inbox for a confirmation link, then sign in using your password.");}
  }catch(e){notice(e.message||"Unable to create account.",true);}
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
    if(password.length<12)throw Error("Use at least 12 characters.");
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
    const result=await api("checkout",{method:"POST"});
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
async function init(){
  // Supabase may return auth errors in URL fragments or query parameters.
  const authQuery=new URLSearchParams(location.search);
  const authHash=new URLSearchParams(location.hash.replace(/^#/,""));
  const returnedError=authQuery.get("error_description")||authHash.get("error_description")||authQuery.get("error")||authHash.get("error");
  if(isBilling){
    try{
      const response=await fetch("/api/billing/public",{headers:{"Accept":"application/json"}});
      const data=await response.json();
      if($("billing-stripe-link")){
        $("billing-price").textContent="CA$99 / month";
        $("billing-first-payment").textContent="CA$448 due initially";
        $("billing-price-note").textContent="CA$349 setup once, then CA$99 monthly. Applicable taxes and the final total appear in Stripe checkout.";
        ready=false;
        await check();
        return;
      }
      ready=!!data.ready;
      $("billing-price").textContent=ready?
        money(data.amount,data.currency)+" / "+(data.interval_count===1?data.interval:data.interval_count+" "+data.interval+"s"):
        "Custom onboarding";
      $("billing-first-payment").textContent=ready?money(data.first_payment,data.currency)+" due initially":"CA$448 standard initial payment";
      $("billing-price-note").textContent=ready?(data.test_mode?
        "Stripe TEST MODE — no real charge will be made.":"Amount and taxes are confirmed by Stripe before you pay."):
        "Secure online checkout is temporarily unavailable. Contact the Calvren team to arrange your subscription.";
    }catch{$("billing-price-note").textContent="Payment details are temporarily unavailable.";}
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
  if(new URLSearchParams(location.search).get("checkout")==="success")
    notice("Thanks. Stripe is confirming your subscription; your access will appear once its signed payment event arrives.");
  await check();
  if(returnedError)notice("Your sign-in link could not be used: "+returnedError.replaceAll("+"," ")+". Request a fresh link.",true);
}
supabase.auth.onAuthStateChange(event=>{
  if(event==="PASSWORD_RECOVERY"){recovery=true;passwordPanelOpen=true;}
  setTimeout(()=>check().catch(()=>{}),0);
});
init().catch(error=>notice(error.message||"Unable to initialize client access.",true));
