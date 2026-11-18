// Weekly/manual prospect research using @crawlee/cheerio (apify/crawlee).
// Public business homepages only. No Google reviews, contact-email harvesting,
// automated messages, social account crawling or invented revenue estimates.
import { CheerioCrawler } from "@crawlee/cheerio";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { eligibleSeeds, evaluateWebsite } from "./prospect-qualification.mjs";

const MAX = Math.max(1,Math.min(15,Number.parseInt(process.env.CALVREN_PROSPECT_LIMIT||"10",10)||10));
const requested=String(process.env.CALVREN_PROSPECT_WEBSITES||"")
  .split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
const outputDir=new URL("../artifacts/prospects/",import.meta.url);
const failures=[];

async function discoverFromOsm(){
  // One modest OpenStreetMap Overpass request, once a week or when manually run.
  // Public OSM tags are ODbL data; report credits OSM contributors.
  const bbox="49.20,-123.28,49.34,-122.95";
  const query=[
    "[out:json][timeout:25];(",
    'nwr["craft"~"^(plumber|electrician|hvac|cleaning)$"]["website"]('+bbox+');',
    'nwr["craft"~"^(plumber|electrician|hvac|cleaning)$"]["contact:website"]('+bbox+');',
    'nwr["shop"~"^(car_repair|car_detailing)$"]["website"]('+bbox+');',
    'nwr["office"="estate_agent"]["website"]('+bbox+');',
    ");out tags 80;"
  ].join("\n");
  const r=await fetch("https://overpass-api.de/api/interpreter",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",
      "User-Agent":"CalvrenProspectResearch/1.0 (https://calvren.ca)"},
    body:new URLSearchParams({data:query}),
    signal:AbortSignal.timeout(32000),
    redirect:"error"
  });
  if(!r.ok)throw Error("OpenStreetMap discovery unavailable (HTTP "+r.status+").");
  const raw=await r.text();
  if(raw.length>750000)throw Error("Discovery response exceeded the safety limit.");
  const data=JSON.parse(raw);
  const entries=(data.elements||[]).map(e=>({
    website:e.tags?.website||e.tags?.["contact:website"]||"",
    name:e.tags?.name||"",
    sector:e.tags?.craft||e.tags?.shop||e.tags?.office||""
  }));
  return eligibleSeeds(entries,MAX);
}

let seeds=eligibleSeeds(requested,MAX);
let discovery="User-provided website roots";
if(!requested.length){
  if(process.env.CALVREN_PROSPECT_DISCOVERY==="osm"){
    discovery="OpenStreetMap website tags in Metro Vancouver";
    try { seeds=await discoverFromOsm(); }
    catch(e){failures.push("OSM discovery unavailable; using curated starter sites: "+String(e?.message||e).slice(0,140));}
  }
  if(!seeds.length){
    const seedFile=JSON.parse(await readFile(new URL("../data/prospect-starter-sites.json",import.meta.url),"utf8"));
    seeds=eligibleSeeds(seedFile.companies||[],MAX);
    discovery="Public Vancouver-area business website starter list (fallback; owner review required)";
  }
}
const records=new Map();
if(seeds.length){
  const crawler=new CheerioCrawler({
    minConcurrency:1,maxConcurrency:2,maxRequestsPerMinute:8,
    maxRequestsPerCrawl:seeds.length,maxRequestRetries:0,
    requestHandlerTimeoutSecs:20,navigationTimeoutSecs:17,
    respectRobotsTxtFile:true,
    requestHandler:async({request,$})=>{
      const page=request.loadedUrl||request.url;
      const expected=new URL(request.url).hostname.replace(/^www\./i,"");
      const arrived=new URL(page).hostname.replace(/^www\./i,"");
      if(arrived!==expected){failures.push("Cross-domain redirect excluded: "+request.url);return;}
      const body=$("body").clone();
      body.find("script,style,svg,noscript,nav,footer").remove();
      const text=body.text().replace(/\s+/g," ").trim().slice(0,10000);
      const links=$("a[href]").map((_,el)=>({
        href:$(el).attr("href")||"",text:$(el).text().replace(/\s+/g," ").trim().slice(0,90)
      })).get();
      const title=($('meta[property="og:site_name"]').attr("content") ||
        $("title").first().text().split(/\s[|–—-]\s/)[0] ||
        request.userData.name ||"").trim().slice(0,90);
      const candidate=evaluateWebsite({
        name:request.userData.name||title, website:request.url,
        sector:request.userData.sector||"",text,links,sourceUrl:page
      });
      records.set(request.url,candidate);
    },
    failedRequestHandler:async({request})=>{
      failures.push("Website unavailable or robots-restricted: "+request.url);
    }
  });
  await crawler.run(seeds.map(s=>({url:s.website,userData:s})));
}

const ranked=[...records.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
await mkdir(outputDir,{recursive:true});
const safe=v=>String(v||"").replace(/[\r\n\t|<>]/g," ").replace(/\s+/g," ").trim().slice(0,260);
const csv=v=>{
  let s=safe(v);
  if(/^[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
};
const header=["research_priority","company","website","sector","score_out_of_100",
  "contact_page","business_evidence","affordability","review_evidence","manual_casl_review","outreach_status"];
const csvRows=[header.join(",")];
for(const row of ranked)csvRows.push([
 row.priority,row.name,row.website,row.sector,row.score,row.contactUrl||"",
 row.evidence.map(e=>e.observation).join("; "),
 row.affordability,row.reviewEvidence,"Required; do not send automatically",row.status
].map(csv).join(","));
await writeFile(new URL("candidates.csv",outputDir),csvRows.join("\n")+"\n");
await writeFile(new URL("candidates.json",outputDir),JSON.stringify({
 generatedAt:new Date().toISOString(),discovery,sourceAttribution:"OpenStreetMap contributors (ODbL) where OSM discovery used",
 googleReviewsUsed:false,emailsSent:0,ranked,failures
},null,2)+"\n");
const md=[
"# Calvren prospect research — human review required",
"",
"Generated (UTC): "+new Date().toISOString(),
"Discovery: "+discovery,
"Businesses inspected: "+ranked.length+" / "+seeds.length+" selected. **Outreach sent: 0.**",
"",
"Scores reflect visible website signals only, not confirmed missed calls, monthly revenue, profit or purchasing budget.",
"Google Maps/Google reviews were not scraped or imported. A score does not establish consent to contact.",
"If OSM discovery is used, data credit: © OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/copyright",
"",
"## Review priorities"
];
if(!ranked.length)md.push("No usable prospects were researched. Supply company website roots manually or retry discovery later.");
for(const r of ranked){
  md.push("### "+safe(r.name)+" — "+r.score+"/100 · "+r.priority,"");
  md.push("Website: "+r.website);
  if(r.contactUrl)md.push("Contact page: "+r.contactUrl);
  if(r.bookingUrl)md.push("Online booking link: "+r.bookingUrl);
  md.push("Evidence to verify:");
  for(const e of r.evidence)md.push("- "+safe(e.observation)+" — "+e.source);
  if(!r.evidence.length)md.push("- No relevant evidence was automatically found.");
  md.push("Affordability: **not verified**. Review public business scale indicators and ask about budget.");
  md.push("Google reviews: **not assessed**. Any review evidence needs separate permitted, manual verification.");
  md.push("Decision: **human review required**. Confirm services, observations and customer fit.");
  if(r.draft)md.push("#### Suggested draft — not approved to send", "", "~~~text",r.draft.trim(),"~~~");
  md.push("");
}
if(failures.length)md.push("## Skipped or unavailable", ...failures.map(x=>"- "+safe(x)));
md.push("## Before any outreach",
"Check the recipient's role, the lawful consent basis under Canada's CASL, sender identification and physical mailing address, and unsubscribe mechanism. Do not treat a publicly visible email as blanket consent.",
"Never claim a missed call, a customer complaint, a review quotation or an estimated profit unless evidence is independently checked.",
"Automated cold emailing and automatic contact discovery are intentionally disabled.",
"");
await writeFile(new URL("research-report.md",outputDir),md.join("\n"));
console.log(JSON.stringify({event:"calvren_prospect_research_prepared",
 discovered:seeds.length,inspected:ranked.length,highPriority:ranked.filter(x=>x.score>=70).length,
 failures:failures.length,emailsSent:0,output:"artifacts/prospects"}));
