// Privacy-first, aggregate-only marketing metrics. Never persist visitor identifiers,
// cookies, IP addresses, messages, referrers or full URLs.
export interface MetricDeps {
  env:(name:string)=>string|undefined;
  authorized?:boolean;
  fetch?:typeof fetch;
}
const supportedEvents=new Set(["page_view","audit_click","audit_submitted","demo_open","demo_started","demo_booked","estimator_used","pricing_view","plan_click"]);
const supportedPages=new Set(["/","/contact","/lead-demo","/try-demo","/ai-receptionist","/payment"]);
const acceptedOrigins=new Set(["https://calvren.ca","https://calvren.pages.dev"]);
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function connection(env:MetricDeps["env"]){
  const host=env("SUPABASE_URL"),key=env("SUPABASE_SECRET_KEY")||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!host||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(host)||!key)throw Error("Analytics storage unavailable.");
  const headers:Record<string,string>={apikey:key,"Content-Type":"application/json","Accept":"application/json"};
  if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
  return {base:host.replace(/\/$/,""),headers};
}
export async function handleSiteMetrics(request:Request,deps:MetricDeps):Promise<Response>{
  const path=new URL(request.url).pathname;
  const fetcher=deps.fetch||fetch;
  if(path==="/api/metrics/event"&&request.method==="POST"){
    if(!acceptedOrigins.has(request.headers.get("origin")||""))return json({error:"Not allowed."},403);
    const site=request.headers.get("sec-fetch-site");
    if(site&&site!=="same-origin")return json({error:"Not allowed."},403);
    if(!(request.headers.get("content-type")||"").startsWith("application/json"))return json({error:"Expected JSON."},415);
    if(Number(request.headers.get("content-length")||0)>256)return json({error:"Request too large."},413);
    const raw=await request.text();
    if(raw.length>256)return json({error:"Request too large."},413);
    let entry:unknown;
    try{entry=JSON.parse(raw);}catch{return json({error:"Invalid event."},400);}
    if(!entry||typeof entry!=="object"||Array.isArray(entry)||
       Object.keys(entry).sort().join(",")!=="event,page")return json({error:"Invalid event."},400);
    const {event,page}=entry as {event:unknown,page:unknown};
    if(typeof event!=="string"||typeof page!=="string"||!supportedEvents.has(event)||!supportedPages.has(page))
      return json({error:"Unknown event."},400);
    try{
      const {base,headers}=connection(deps.env);
      const response=await fetcher(base+"/rest/v1/rpc/calvren_record_site_metric",{
        method:"POST",headers,body:JSON.stringify({p_event:event,p_page:page})
      });
      if(!response.ok)throw Error("Aggregate store unavailable.");
      return json({ok:true},202);
    }catch{return json({error:"Activity counter unavailable."},503);}
  }
  if(path==="/api/metrics/summary"&&request.method==="GET"){
    if(!deps.authorized)return json({error:"Owner authentication required."},401);
    try{
      const {base,headers}=connection(deps.env);
      const since=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
      const params=new URLSearchParams({select:"day,event_name,page_path,hits",day:"gte."+since,order:"day.asc",limit:"3000"});
      const response=await fetcher(base+"/rest/v1/calvren_site_metrics_daily?"+params.toString(),{headers,cache:"no-store"});
      if(!response.ok)throw Error("Aggregate read unavailable.");
      const rows:unknown=await response.json();
      if(!Array.isArray(rows))throw Error("Invalid aggregate response.");
      const counts:Record<string,number>=Object.fromEntries([...supportedEvents].map(event=>[event,0]));
      const byDay=new Map<string,{day:string;page_loads:number;audit_submitted:number;demo_started:number}>();
      for(const row of rows){
        if(!row||typeof row!=="object")continue;
        const r=row as {day?:unknown,event_name?:unknown;page_path?:unknown;hits?:unknown};
        if(typeof r.day!=="string"||!supportedEvents.has(String(r.event_name))||!supportedPages.has(String(r.page_path)))continue;
        const n=Number(r.hits);
        if(!Number.isSafeInteger(n)||n<0)continue;
        counts[String(r.event_name)]+=n;
        const day=byDay.get(r.day)||{day:r.day,page_loads:0,audit_submitted:0,demo_started:0};
        if(r.event_name==="page_view")day.page_loads+=n;
        if(r.event_name==="audit_submitted")day.audit_submitted+=n;
        if(r.event_name==="demo_started")day.demo_started+=n;
        byDay.set(r.day,day);
      }
      return json({window_days:30,counts,daily:[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)),
        note:"Aggregate observed events, not unique visitors or verified customers. No identifiers are stored."});
    }catch{return json({error:"Website insights are temporarily unavailable."},503);}
  }
  return json({error:"Endpoint not found."},404);
}
