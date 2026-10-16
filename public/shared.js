const root=document.documentElement;
const menuButton=document.querySelector(".menu-toggle");
const navigation=document.getElementById("site-navigation");
const mobile=matchMedia("(max-width:860px)");
let menuOpen=false;
if(menuButton&&navigation){
  root.classList.add("nav-enhanced");
  const setMenu=(open,returnFocus=false)=>{
    menuOpen=mobile.matches&&open;
    menuButton.setAttribute("aria-expanded",String(menuOpen));
    menuButton.querySelector(".menu-label").textContent=menuOpen?"Close":"Menu";
    navigation.hidden=mobile.matches&&!menuOpen;
    navigation.inert=mobile.matches&&!menuOpen;
    if(returnFocus)menuButton.focus();
  };
  setMenu(false);
  menuButton.addEventListener("click",()=>setMenu(!menuOpen));
  mobile.addEventListener("change",()=>setMenu(false));
  navigation.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>setMenu(false)));
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&menuOpen)setMenu(false,true);});
  document.addEventListener("click",event=>{if(menuOpen&&!event.target.closest(".header"))setMenu(false);});
}
document.querySelectorAll("#year").forEach(node=>node.textContent=String(new Date().getFullYear()));
const reducedMotion=matchMedia("(prefers-reduced-motion:reduce)");
if("IntersectionObserver" in window&&!reducedMotion.matches){
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add("is-revealed");observer.unobserve(entry.target);}
  },{threshold:.04});
  document.querySelectorAll("[data-reveal]").forEach(node=>{
    node.classList.add("reveal-ready");
    observer.observe(node);
  });
  reducedMotion.addEventListener("change",event=>{if(event.matches){document.querySelectorAll(".reveal-ready").forEach(node=>node.classList.add("is-revealed"));observer.disconnect();}});
}
// Campaign attribution is explicit URL metadata only (no cookies or cross-site referrers).
// Discard unexpected values rather than recording arbitrary query strings.
const campaignParams=new URLSearchParams(location.search);
const campaignValue=key=>{
  const value=(campaignParams.get(key)||"").trim();
  return /^[a-zA-Z0-9 _.-]{1,80}$/.test(value)?value:"";
};
document.querySelectorAll("[data-lead-form]").forEach(form=>{
  for(const key of ["utm_source","utm_medium","utm_campaign"]){
    const input=form.querySelector('[name="'+key+'"]');
    if(input)input.value=campaignValue(key);
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]'),error=form.querySelector("[data-form-error]");
    if(button.disabled)return;
    const original=button.innerHTML;
    form.dataset.submissionKey ||= crypto.randomUUID();
    const body=new URLSearchParams();
    body.set("submission-key",form.dataset.submissionKey);
    body.set("formspree-archived","yes");
    for(const [key,value]of new FormData(form))body.append(key,String(value));
    button.disabled=true;button.setAttribute("aria-busy","true");button.textContent="Sending…";
    error.hidden=true;
    try{
      // Formspree is the notification source of truth for public website forms.
      // A 2xx response confirms receipt by Formspree, not delivery to an inbox.
      const response=await fetch(form.action,{
        method:"POST",body:new FormData(form),headers:{"Accept":"application/json"}
      });
      if(!response.ok)throw new Error("Formspree did not accept the submission");
      // Retain the existing protected Calvren lead/feedback inbox as a secondary
      // copy. Its availability must not block a successfully notified visitor.
      try{
        const archive=await fetch("/",{method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded"},body,
          signal:AbortSignal.timeout(5000)});
        if(!archive.ok)console.warn("Calvren private copy could not be saved.");
      }catch{console.warn("Calvren private copy is temporarily unavailable.");}
      location.assign(form.dataset.successUrl||"/thanks.html");
    }catch{
      error.textContent="We couldn’t submit this right now. Please try again, or email calvrenautomation@gmail.com.";
      error.hidden=false;button.disabled=false;button.removeAttribute("aria-busy");button.innerHTML=original;
    }
  });
});
const workflow=new URLSearchParams(location.search).get("workflow");
const enquiry=document.getElementById("project-form");
const workflows={
  "real-estate":{industry:"Real estate",message:"I’d like help organising property enquiries and preparing replies for review."},
  "local-services":{industry:"Local services",message:"I’d like help organising quote requests and collecting the details needed before quoting."},
  professional:{industry:"Professional services",message:"I’d like help preparing client intake summaries and initial reply drafts."}
};
if(enquiry&&Object.hasOwn(workflows,workflow)){
  enquiry.querySelector('[name="workflow"]').value=workflow;
  enquiry.querySelector('[name="industry"]').value=workflows[workflow].industry;
  enquiry.querySelector('[name="message"]').value=workflows[workflow].message;
}
const filterButtons=[...document.querySelectorAll("[data-study-filter]")];
if(filterButtons.length){
  filterButtons.forEach(button=>button.addEventListener("click",()=>{
    const selected=button.dataset.studyFilter;
    filterButtons.forEach(node=>node.setAttribute("aria-pressed",String(node===button)));
    let count=0;
    document.querySelectorAll("[data-study]").forEach(study=>{
      study.hidden=selected!=="all"&&study.dataset.study!==selected;
      if(!study.hidden){count++;study.classList.add("is-revealed");}
    });
    document.getElementById("study-filter-status").textContent="Showing "+count+" illustrative "+(count===1?"example.":"examples.");
  }));
}
