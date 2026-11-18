// Calvren prospect scoring. Website-only signals are leads to investigate,
// never proof of missed calls, turnover, affordability, reviews or legal consent.
import { isIP } from "node:net";

const restricted = /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/i;
const platform = /(?:^|\.)(?:google\.com|google\.ca|maps\.google\.com|facebook\.com|instagram\.com|tiktok\.com|yelp\.com|yellowpages\.ca|linktr\.ee|linkedin\.com|youtube\.com)$/i;

export function safeWebsite(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 350) return null;
  try {
    const input = value.trim();
    const u = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
    const host = u.hostname.toLowerCase();
    if (!["http:","https:"].includes(u.protocol) || u.username || u.password ||
      u.port || !host.includes(".") || isIP(host) || restricted.test(host) ||
      platform.test(host) || /[^a-z0-9.-]/i.test(host) || host.includes("..")) return null;
    // A root URL is safer than visiting arbitrary paths from third-party seed data.
    return "https://" + host + "/";
  } catch { return null; }
}

export function eligibleSeeds(items, limit=12) {
  const seen = new Set(), output = [];
  for (const item of items) {
    const website = safeWebsite(typeof item==="string" ? item : item?.website);
    if (!website || seen.has(website)) continue;
    seen.add(website);
    const name = typeof item==="string" ? "" : String(item?.name || "").slice(0,90);
    const sector = typeof item==="string" ? "" : String(item?.sector || "").slice(0,60);
    output.push({website,name,sector});
    if (output.length >= limit) break;
  }
  return output;
}

function clean(text) {
  return String(text || "").replace(/\s+/g," ").trim().slice(0,10000);
}
const patterns = {
  sector:/\b(?:plumb(?:er|ing)|hvac|heating|air conditioning|electrician|electrical|cleaning|window washing|window cleaning|auto detailing|car detailing|automotive detailing|landscaping|lawn care|roofing|pest control|property management)\b/i,
  emergency:/\b(?:24\/7|24 hours|after.hours|emergency service|urgent service|same.day)\b/i,
  phone:/\b(?:call us|call now|give us a call|phone us|call today|call for (?:a |an )?(?:quote|estimate|appointment))\b/i,
  appointment:/\b(?:appointment|booking|schedule a visit|estimate request|request a quote)\b/i,
  commercial:/\b(?:commercial services?|business clients?|commercial properties|industrial clients?)\b/i,
  coverage:/\b(?:locations|service areas?|areas we serve|multiple locations|serving the lower mainland)\b/i,
};
export function evaluateWebsite({name,website,sector="",text="",links=[],sourceUrl=website}){
  const body=clean(text), title=clean(name).slice(0,90) || new URL(website).hostname;
  const root=new URL(website);
  const sameHostLinks=links.filter(x=>{
    try{const u=new URL(x.href,sourceUrl);return u.hostname===root.hostname && u.protocol.startsWith("http");}
    catch{return false;}
  }).slice(0,150);
  const booking=sameHostLinks.find(x=>/book(?:ing)? online|book now|schedule online|schedule appointment|reserve a time/i.test(x.text||""));
  const contact=sameHostLinks.find(x=>/contact|request a quote|get a quote|estimate|request service/i.test(x.text||"")||/\/contact(?:\/|$|[?.])/i.test(x.href||""));
  const signals=[];
  const add=(id,description)=>signals.push({id,observation:description,source:sourceUrl});
  const sectorFit=patterns.sector.test(body) || /^(plumber|electrician|hvac|cleaning|car_repair|car_detailing|estate_agent)$/i.test(sector);
  if(sectorFit)add("sector","A service-business category relevant to lead response is described");
  if(patterns.emergency.test(body))add("urgent","The site mentions urgent, same-day or extended-hours service");
  if(patterns.phone.test(body))add("phone","The website explicitly invites customers to call");
  if(patterns.appointment.test(body))add("appointment","Appointments, quotes or scheduling are described");
  if(patterns.commercial.test(body))add("commercial","Commercial work or business customers are mentioned");
  if(patterns.coverage.test(body))add("coverage","Multiple service areas or locations are mentioned");
  if(contact)add("contact","An enquiry or contact link is available");
  if(booking)add("booking","An online scheduling link is visible");
  const points={
    sectorFit:sectorFit?25:0,
    enquiryComplexity:Math.min(25,(patterns.emergency.test(body)?14:0)+(patterns.phone.test(body)?7:0)+(patterns.appointment.test(body)?7:0)),
    capacityIndicators:Math.min(20,(patterns.commercial.test(body)?12:0)+(patterns.coverage.test(body)?8:0)),
    contactability:(contact?10:0)+(booking?5:0),
    evidence:Math.min(15,signals.length*3)
  };
  const score=Object.values(points).reduce((a,b)=>a+b,0);
  const priority=score>=70 && signals.length>=4?"High research priority":score>=45?"Worth a screening call":"Needs more evidence";
  const strongest=signals.find(s=>["urgent","appointment","phone","commercial"].includes(s.id));
  const observation=strongest?.id==="urgent"?"your website mentions time-sensitive service requests":
    strongest?.id==="appointment"?"your site discusses appointments and enquiries":
    strongest?.id==="phone"?"your website invites customers to call":
    strongest?.id==="commercial"?"your site describes commercial service work":null;
  const draft=observation ?
    "Subject: A question about enquiry handling at "+title+"\n\n"+
    "Hi [first name],\n\nI came across "+title+" and noticed that "+observation+
    ". I work on Calvren, where we help service businesses capture enquiry details and route booking requests. "+
    "Would improving that process be relevant for your team?\n\n"+
    "Best,\nCalvren\nhttps://calvren.ca\n\n"+
    "[HUMAN REVIEW REQUIRED: verify the observation, recipient role, CASL consent basis, sender postal address and unsubscribe process before sending.]\n"
    :null;
  return {name:title,website,sector,score,priority,points,evidence:signals,
    contactUrl:contact?new URL(contact.href,sourceUrl).href:null,
    bookingUrl:booking?new URL(booking.href,sourceUrl).href:null,
    reviewEvidence:"Not assessed: Google reviews are not scraped",
    affordability:"Not verified: website signals are not financial statements",
    draft,status:"Review required; no outreach sent"};
}
