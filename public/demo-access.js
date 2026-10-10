// This is email capture for a public simulation, not authentication for client data.
const sessionKey="calvren-demo-access-v2",signupPath="/try-demo.html";
export function demoAccessSession(){
  let session;try{session=JSON.parse(sessionStorage.getItem(sessionKey)||"null");}catch{return null;}
  if(session?.version!==2||!Number.isFinite(session.expires_at)||session.expires_at<=Date.now()||session.expires_at>Date.now()+86400000||!/^[a-f0-9-]{36}$/.test(session.submission_id||"")){
    sessionStorage.removeItem(sessionKey);return null;
  }
  return session;
}
function makeDialog(){
  const dialog=document.createElement("dialog");dialog.className="demo-access-dialog";dialog.setAttribute("aria-labelledby","demo-access-title");
  dialog.innerHTML=`
    <button type="button" class="demo-access-close" aria-label="Close demo signup">×</button>
    <p class="eyebrow"><span class="tiny-dot"></span> YOUR FRONT-ROW SEAT</p>
    <div class="demo-access-symbol" aria-hidden="true">↗</div>
    <h2 id="demo-access-title">Serious about<br><em>fewer missed leads?</em></h2>
    <p class="demo-access-description">Put us to the test. Enter your email, then open the full lead-to-booking simulation right here.</p>
    <div class="demo-access-perks"><span>✓ Immediate access</span><span>✓ No password</span><span>✓ No card</span></div>
    <form id="demo-access-form">
      <label for="demo-access-email">Your email to unlock the demo</label>
      <input id="demo-access-email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="you@yourbusiness.com">
      <p hidden><label>Leave blank <input name="website" tabindex="-1" autocomplete="off"></label></p>
      <label class="demo-promo-choice" for="demo-promo-consent"><input id="demo-promo-consent" type="checkbox"><span>Also email me a one-time introduction to Calvren’s automation services. Optional; demo access works either way.</span></label>
      <button type="submit" class="button full-width">Unlock the demo <span aria-hidden="true">→</span></button>
    </form>
    <p class="demo-access-status" role="status" aria-live="polite"></p>
    <a id="demo-open-link" class="button full-width" href="/lead-demo.html" hidden>Open the demo <span aria-hidden="true">↗</span></a>
    <p class="demo-access-fine">We save your email and email preference privately. No account, password or email verification is required for this simulated demo. The optional introduction includes an unsubscribe link. <a href="/privacy.html">Privacy details</a>.</p>
    <a class="text-link" href="/#demo">Just browsing? Try the quick preview →</a>
    <p class="demo-access-help">Need a hand? <a href="mailto:Jordan.wong1177@gmail.com">Contact Jordan</a>.</p>`;
  document.body.append(dialog);dialog.querySelector(".demo-access-close").addEventListener("click",()=>dialog.close());
  const form=dialog.querySelector("form"),status=dialog.querySelector('[role="status"]'),button=form.querySelector("button"),link=dialog.querySelector("#demo-open-link");
  let waiting=false;
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(waiting||!form.reportValidity())return;
    waiting=true;button.disabled=true;button.setAttribute("aria-busy","true");status.textContent="Preparing your demo…";
    const consent=form.querySelector("#demo-promo-consent").checked;
    try{
      const response=await fetch("/api/demo-access",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:form.querySelector("#demo-access-email").value.trim(),promotional_consent:consent,website:form.elements.website.value}),signal:AbortSignal.timeout(20000),redirect:"error"});
      if(!response.ok)throw Error(response.status===429?"Please wait before trying again.":"We couldn’t save your email. Please try again or contact Jordan.");
      const result=await response.json();
      if(!result.ok||!/^[a-f0-9-]{36}$/.test(result.id||"")||result.demo_url!=="/lead-demo.html")throw Error("Please try again.");
      try{sessionStorage.setItem(sessionKey,JSON.stringify({version:2,submission_id:result.id,expires_at:Date.now()+86400000}));sessionStorage.removeItem("calvren-demo-session");}catch{throw Error("Allow browser storage for this website to open the demo.");}
      form.hidden=true;link.hidden=false;
      status.textContent="Your demo is ready. Click below to start.";
      if(consent&&["sent","sending"].includes(result.promotion))status.textContent+=" Your requested introduction has been queued for email.";
      else if(consent&&["failed","unavailable"].includes(result.promotion))status.textContent+=" The introductory email is temporarily unavailable; your demo access is ready.";
      else if(consent&&result.promotion==="unsubscribed")status.textContent+=" Your previous email opt-out is still respected.";
      link.focus();
    }catch(error){status.textContent=error.name==="TimeoutError"||error.name==="TypeError"?"The connection timed out. Please try again.":error.message;}
    finally{waiting=false;button.disabled=false;button.removeAttribute("aria-busy");}
  });
  return dialog;
}
let dialog;
export function openDemoAccess(){
  if(demoAccessSession()){location.assign("/lead-demo.html");return;}
  dialog ||= makeDialog();if(!dialog.open)dialog.showModal();
}
export async function requireDemoAccess(){
  const session=demoAccessSession();
  if(!session){location.replace(signupPath);await new Promise(()=>{});}
  setTimeout(()=>location.replace(signupPath),Math.max(0,session.expires_at-Date.now()));return session;
}
export function clearDemoAccess(){
  sessionStorage.removeItem(sessionKey);sessionStorage.removeItem("calvren-demo-session");location.replace(signupPath);
}
document.querySelectorAll("[data-demo-access]").forEach(link=>link.addEventListener("click",event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openDemoAccess();
}));
if(document.body.dataset.demoSignup==="true"){
  // Remove obsolete magic-link fragments without accepting them as demo access.
  if(location.hash)history.replaceState(null,"",signupPath);
  if(demoAccessSession())location.replace("/lead-demo.html");else openDemoAccess();
}
