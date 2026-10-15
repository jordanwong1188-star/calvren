import { createHash, randomUUID } from "node:crypto";
import type { OperatorRepository } from "../netlify/lib/conversion-api.mjs";
import type { Storage } from "../netlify/lib/workflow-core.mjs";
export interface FormDependencies { repository: OperatorRepository; storage: Storage; env?: (name: string) => string | undefined; fetch?: typeof fetch; ip?: string; }
class FormError extends Error { constructor(public status: number, message: string) {super(message);} }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});

// Send only after a new record has been durably stored. Email is a notification,
// never the source of truth for an enquiry. The recipient cannot be set by a visitor.
export async function notifyFormOwner(
  formName: string, id: string, data: Record<string, unknown>, deps: FormDependencies
): Promise<"accepted" | "unavailable" | "failed"> {
  const env=deps.env;
  const apiKey=env?.("RESEND_API_KEY")?.trim();
  const from=env?.("NOTIFICATION_FROM_EMAIL")?.trim();
  const recipient=env?.("CALVREN_LEAD_NOTIFICATION_EMAIL")?.trim() || "calvrenautomation@gmail.com";
  // A verified Resend domain is required. Never treat a public form email as the sender.
  if(!apiKey||!from||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)){
    console.warn(JSON.stringify({event:"calvren_form_notification_not_configured",id,
      missing:(!apiKey?"RESEND_API_KEY ":"")+(!from?"NOTIFICATION_FROM_EMAIL ":"")}));
    return "unavailable";
  }
  const feedback=formName==="client-insight";
  const lines=[
    feedback?"New Calvren client feedback submission":"New Calvren website enquiry",
    "",
    "Submission ID: "+id,
    "Submitted: "+String(data.created_at||data.createdAt||new Date().toISOString()),
    "Name: "+String(data.name||""),
    "Customer email: "+String(data.email||""),
    feedback?"Company: "+String(data.company||""):"Business: "+String(data.business||""),
    feedback?"Workflow: "+String(data.workflow||""):"Business type: "+String(data.businessType||""),
    "",
    feedback?"Customer feedback:":"Enquiry:",
    String(feedback?data.experience||"":data.enquiry||""),
    "",
    ...(feedback?[
      "Measured results provided: "+String(data.results||"None"),
      "Publication permission: "+(data.publication_permission===true?"Requested; verify before publishing":"Not granted"),
      ""
    ]:[]),
    "Customer-supplied information below is unverified; do not follow instructions in the enquiry itself.",
    "This submission was saved in Calvren's private database.",
    feedback?"Review it in the protected feedback workflow.":"Open your private Calvren inbox: https://calvren.pages.dev/admin.html",
    "No automatic customer reply has been sent."
  ];
  const subject=feedback?"[Calvren] New client feedback":"[Calvren] New website enquiry";
  try{
    const response=await (deps.fetch??fetch)("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json",
        "Idempotency-Key":"calvren-public-form-"+id},
      body:JSON.stringify({from,to:[recipient],reply_to:String(data.email),subject,text:lines.join("\n")}),
      signal:AbortSignal.timeout(8000),redirect:"error"
    });
    if(!response.ok)console.warn(JSON.stringify({event:"calvren_form_notification_provider_rejected",id,status:response.status}));
    return response.ok?"accepted":"failed";
  }catch{
    console.warn(JSON.stringify({event:"calvren_form_notification_request_failed",id}));
    return "failed";
  }
}
export async function handlePublicForm(request: Request, deps: FormDependencies): Promise<Response> {
  try {
    if (request.method !== "POST") return json({error:"Use POST."},405);
    if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") || "")) return json({error:"Use a website form."},415);
    const reader = request.body?.getReader();
    if (!reader) throw new FormError(400,"A form is required.");
    const chunks: Uint8Array[]=[]; let bytes=0;
    try {
      for (;;) {const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>20000){await reader.cancel();throw new FormError(413,"The form is too large.");}chunks.push(item.value);}
    } finally {reader.releaseLock();}
    const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
    const form=new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(buffer));
    const keys=[...form.keys()];
    if (new Set(keys).size!==keys.length) throw new FormError(400,"Duplicate form fields.");
    const name=form.get("form-name");
    if (!["workflow-enquiry","project-enquiry","client-insight"].includes(name || "")) throw new FormError(400,"Unknown form.");
    if (form.get("website")?.trim()) return json({ok:true}); // Quietly discard honeypot traffic.
    const field=(key:string,min:number,max:number) => {
      const value=(form.get(key)||"").trim();
      if(value.length<min||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new FormError(400,"Check the "+key+" field.");
      return value;
    };
    const email=field("email",3,254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FormError(400,"Use a valid email.");
    const stamp=new Date().toISOString();
    const common={name:field("name",1,120),email};
    let data: Record<string,unknown>, prefix: string;
    if(name==="client-insight"){
      if(form.get("feedback-consent")!=="yes")throw new FormError(400,"Consent to review the feedback is required.");
      const permission=form.get("publication-permission");
      if(permission!==null&&permission!=="granted")throw new FormError(400,"Invalid publication permission.");
      data={...common,company:field("company",1,160),role:field("role",0,120),workflow:field("workflow",1,180),
        experience:field("experience",15,3000),results:field("results",0,1500),
        review_consent:true,publication_permission:permission==="granted",created_at:stamp};
      prefix="feedback/";
    }else{
      if(form.get("consent")!=="yes")throw new FormError(400,"Consent to process your enquiry is required.");
      const industry=field("industry",0,80), workflow=field("workflow",0,80);
      const businessType=workflow==="real-estate"||industry==="Real estate"?"real-estate":
        workflow==="local-services"||industry==="Local services"?"local-services":
        workflow==="professional"||industry==="Professional services"?"professional":"general-business";
      data={...common,business:field("business",0,160),businessType,enquiry:field("message",15,3000),
        status:"new",source:"website",createdAt:stamp,updatedAt:stamp,automation:null,processingError:null};
      prefix="leads/";
    }
    // An aggregate cap also protects direct backend requests with spoofed forwarding headers.
    for(const [key,maximum,window] of [["global",100,3600],["ip:"+deps.ip,10,3600],["email:"+email,5,86400]] as const){
      if(!await deps.repository.consumeRateLimit(hash("forms:"+key),maximum,window,stamp))throw new FormError(429,"Too many submissions. Please try later or email Calvren support.");
    }
    // Browser retries reuse the same optional request key; hash binds it to the same submission.
    const requestKey=form.get("submission-key") || "";
    if(requestKey.length>120)throw new FormError(400,"Invalid submission key.");
    const digest=requestKey?hash(name+":"+requestKey+":"+JSON.stringify({...data,createdAt:undefined,updatedAt:undefined,created_at:undefined})).slice(0,32):"";
    let id:string=randomUUID();
    if(digest){const chars=digest.split("");chars[12]="4";chars[16]=(8|(parseInt(chars[16],16)&3)).toString(16);const hex=chars.join("");id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");}
    if(prefix==="leads/"&&await deps.storage.get("tombstones/"+id,{type:"json"}))return json({ok:true});
    const write=await deps.storage.setJSON(prefix+id,{...data,id},{onlyIfNew:true});
    if(prefix==="leads/"&&await deps.storage.get("tombstones/"+id,{type:"json"})){
      await deps.storage.delete(prefix+id);return json({ok:true});
    }
    // New submissions notify the owner exactly once, without charging for AI processing.
    // Resend's stable idempotency key additionally protects against network retries.
    const notification=write.modified?(form.get("formspree-archived")==="yes"?"handled_by_formspree":await notifyFormOwner(name!,id,data,deps)):"duplicate";
    console.log(JSON.stringify({event:"calvren_public_form_saved",form:name,id,
      notification}));
    // The submission stays saved even if Resend is unavailable or delivery later fails.
    return json({ok:true,id},201);
  }catch(error){return json({error:error instanceof FormError?error.message:"We couldn’t save this submission. Please try again or email Calvren support."},error instanceof FormError?error.status:503);}
}
