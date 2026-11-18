/*
 * Calvren editorial scroll system.
 * One-shot viewport reveals, subtle progress cue, no external libraries.
 * Content stays readable when JS is unavailable or motion is reduced.
 */
const body=document.body;
const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
if(body.classList.contains("motion-site")&&!reducedMotion.matches&&"IntersectionObserver" in window){
  const items=[];
  const seen=new WeakSet();
  const add=(node,kind,delay=0)=>{
    if(!(node instanceof Element)||seen.has(node))return;
    if(node.closest("form")||node.closest("details:not([open])"))return;
    seen.add(node);
    node.setAttribute("data-motion",kind);
    node.style.setProperty("--motion-delay",Math.min(270,Math.max(0,delay))+"ms");
    items.push(node);
  };
  const sections=document.querySelectorAll("main > section");
  for(const section of sections){
    const isHero=section.matches(".hero,.contact-hero,.receptionist-hero");
    const headings=section.querySelectorAll("h1,h2");
    // Main sections share an editorial rhythm: kicker, headline, supporting copy.
    const kicker=section.querySelector(".section-heading .eyebrow, .hero-copy .eyebrow, .receptionist-hero-copy .eyebrow, .eyebrow");
    add(kicker,"kicker",0);
    headings.forEach((heading,index)=>{
      if(heading.closest("details")||heading.closest("form"))return;
      add(heading,"headline",index?65:45);
    });
    const leads=section.querySelectorAll(
      ".hero-description,.hero-reassurance,.page-intro,"+
      ".solutions-intro,.section-heading>p,.section-heading>div:last-child>p:not(.eyebrow),"+
      ".receptionist-hero-copy>p:not(.eyebrow),.receptionist-next>div>p:not(.eyebrow)"
    );
    leads.forEach((node,i)=>add(node,"copy",100+i*60));
    const cards=section.querySelectorAll(
      ".solution-card,.calvren-tier,.receptionist-feature-grid article,"+
      ".faq-list details,.receptionist-faq details,.receptionist-teaser-price"
    );
    cards.forEach((node,i)=>add(node,"card",Math.min(i*105,260)));
    if(isHero){
      add(section.querySelector(".hero-film"),"media",120);
      add(section.querySelector(".receptionist-price-card"),"panel",140);
      add(section.querySelector(".direct-contact-panel"),"panel",140);
    }
  }
  // Chosen focal points add visual variety without animating forms or whole sections.
  const highlights=[
    [".receptionist-workday-note-inner","panel",70],
    [".solutions-action","panel",80],
    [".demo-section .preview-details","panel",70],
    [".receptionist-next .button","copy",180],
    [".receptionist-teaser-copy .button","copy",140]
  ];
  for(const [selector,kind,delay]of highlights)add(document.querySelector(selector),kind,delay);
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      entry.target.classList.add("is-inview");
      observer.unobserve(entry.target);
    }
  },{threshold:.07,rootMargin:"0px 0px -4% 0px"});
  for(const node of items)observer.observe(node);
  document.documentElement.classList.add("motion-enabled");
  // Keyboard navigation must never land on visually hidden content.
  document.addEventListener("focusin",event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    const animated=target.closest("[data-motion]");
    if(animated) animated.classList.add("is-inview");
  });
  const progress=document.createElement("div");
  progress.className="calvren-reading-progress";
  progress.setAttribute("aria-hidden","true");
  body.prepend(progress);
  let framePending=false;
  const updateProgress=()=>{
    framePending=false;
    const scrollable=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    const fraction=Math.min(1,Math.max(0,window.scrollY/scrollable));
    progress.style.transform="scaleX("+fraction+")";
  };
  const schedule=()=>{
    if(framePending)return;
    framePending=true;
    window.requestAnimationFrame(updateProgress);
  };
  window.addEventListener("scroll",schedule,{passive:true});
  window.addEventListener("resize",schedule,{passive:true});
  updateProgress();
  reducedMotion.addEventListener("change",event=>{
    if(!event.matches)return;
    observer.disconnect();
    document.documentElement.classList.remove("motion-enabled");
    progress.remove();
    window.removeEventListener("scroll",schedule);
    window.removeEventListener("resize",schedule);
    for(const node of items)node.classList.add("is-inview");
  },{once:true});
}
