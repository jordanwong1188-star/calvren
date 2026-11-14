// Legacy payment-link redirect intentionally retired: all subscriptions use
// authenticated server-verified Checkout Sessions linked to the chosen tier.
// Stripe promotion codes are entered on the hosted Checkout page.
const button=document.getElementById("billing-apply-discount");
const feedback=document.getElementById("discount-status");
button?.addEventListener("click",()=>{
  if(feedback)feedback.textContent="Select your plan and enter any eligible promotion code in secure Stripe Checkout.";
});
