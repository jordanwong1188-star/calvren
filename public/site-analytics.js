// First-party aggregate counters: no cookies, IDs, IPs, referrers, query strings or message content.
// This script is for public marketing pages only. Respect browser privacy opt-outs.
(() => {
  "use strict";
  const routes=new Set(["/","/contact","/lead-demo","/try-demo","/ai-receptionist","/payment"]);
  const normalize=path=>path==="/index.html"?"/":path.replace(/\.html$/,"").replace(/\/$/,"")||"/";
  const page=normalize(location.pathname);
  if(!routes.has(page))return;
  const events=new Set(["page_view","audit_click","audit_submitted","demo_open","demo_started","demo_booked","estimator_used","pricing_view","plan_click"]);
  const optedOut=navigator.doNotTrack==="1"||window.doNotTrack==="1"||navigator.globalPrivacyControl===true;
  const track=event=>{
    if(optedOut||!events.has(event))return Promise.resolve(false);
    return fetch("/api/metrics/event",{
      method:"POST",mode:"same-origin",credentials:"omit",cache:"no-store",keepalive:true,
      headers:{"Content-Type":"application/json"},body:JSON.stringify({event,page})
    }).then(response=>response.ok).catch(()=>false);
  };
  window.calvrenTrackEvent=track;
  window.addEventListener("pageshow",()=>{track("page_view");},{once:true});
  document.addEventListener("click",e=>{
    const a=e.target.closest("a[href]");
    if(!a)return;
    let url;
    try{url=new URL(a.getAttribute("href"),location.href);}catch{return;}
    if(url.origin!==location.origin)return;
    const dest=normalize(url.pathname);
    if(dest==="/try-demo"||dest==="/lead-demo")track("demo_open");
    else if(dest==="/payment")track("plan_click");
    else if(dest==="/contact"&&url.searchParams.get("workflow")!=="ai-receptionist")track("audit_click");
  });
  const pricing=document.getElementById("pricing");
  if(pricing&&"IntersectionObserver" in window){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){track("pricing_view");observer.disconnect();}
    },{threshold:0.25});
    observer.observe(pricing);
  }
})();
