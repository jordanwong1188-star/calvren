// Stripe-hosted Payment Link uses a one-time setup fee and recurring monthly subscription.
// Client entitlements are NOT granted here; payment confirmation requires signed server webhooks.
const link="https://buy.stripe.com/5kQ9AV0toenQci40QKgbm00";
const button=document.getElementById("billing-apply-discount");
const input=document.getElementById("discount-code");
const feedback=document.getElementById("discount-status");
button?.addEventListener("click",()=>{
  const code=(input?.value||"").trim();
  if(!code){feedback.textContent="Enter a discount code, or use the main Stripe checkout button without a code.";return;}
  if(code.toLowerCase()!=="calvren15%"&&code.toLowerCase()!=="calvren15"){
    feedback.textContent="That code was not recognized. Contact Calvren if you received another code.";return;
  }
  const destination=new URL(link);
  destination.searchParams.set("prefilled_promo_code","CALVREN15");
  window.location.assign(destination.href);
});
