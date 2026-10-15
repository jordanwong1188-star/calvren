/**
 * Transactional client mail. Requires a verified Resend sender domain configured in
 * NOTIFICATION_FROM_EMAIL (e.g. Calvren <hello@your-verified-domain>).
 * Never include credentials, card details, or private lead data in messages.
 */
type Env=(name:string)=>string|undefined;
export type MailKind="welcome"|"submitted"|"scope_ready";
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const site=(env:Env)=>{
  try{const url=new URL(env("CALVREN_PUBLIC_URL")||"https://calvren.pages.dev");
    return url.protocol==="https:"&&!url.username&&!url.password?url.origin:"https://calvren.pages.dev";}
  catch{return "https://calvren.pages.dev";}
};
export async function sendClientMail(env:Env,to:string,kind:MailKind,options:{
  business?:string; kickoff?:boolean; scope?:string; id:string; fetcher?:typeof fetch;
}):Promise<boolean>{
  const key=env("RESEND_API_KEY")||"",from=env("NOTIFICATION_FROM_EMAIL")||"";
  if(!key||!from||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!options.id){
    console.warn(JSON.stringify({event:"calvren_client_mail_unconfigured",kind}));
    return false;
  }
  const namedFrom=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)?"Calvren <"+from+">":from;
  const origin=site(env),name=(options.business||"your business").slice(0,150);
  const kickoff=options.kickoff?" You also requested an optional kickoff call. We'll contact you to agree a time; no meeting is booked yet.":"";
  const specs={
    welcome:{subject:"Welcome to Calvren — your next steps",heading:"Welcome to Calvren.",intro:"Your subscription is confirmed and your private onboarding workspace is ready.",action:"Complete your onboarding",url:origin+"/onboarding.html",detail:"Tell us about your business, enquiries, booking rules and handoff preferences. You can save your progress and return later."},
    submitted:{subject:"Your Calvren onboarding is received",heading:"Your details are in good hands.",intro:"We've received the onboarding questionnaire for "+name+".",action:"Track your setup",url:origin+"/onboarding.html",detail:"We'll review your requirements, arrange any approved integrations and test the workflow before asking you to approve the final setup."+kickoff},
    scope_ready:{subject:"Calvren — your workflow is ready for approval",heading:"Your workflow is ready to review.",intro:"We've prepared the proposed launch scope for "+name+".",action:"Review and approve your workflow",url:origin+"/onboarding.html",detail:"Please sign in, read the final scope, and approve it only if the details are correct. Approval does not automatically switch on live messaging."}
  }[kind];
  const text=specs.heading+"\n\n"+specs.intro+"\n\n"+specs.detail+"\n\n"+specs.action+": "+specs.url+"\n\nNeed help? Reply to this email or visit "+origin+"/contact.html\n\nCalvren · Managed automation\nThis is a service email related to your account, not a marketing subscription.";
  const html='<div style="margin:0;padding:38px 18px;background:#f6f7f2;font-family:Arial,sans-serif;color:#1b382d"><div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #e3e9dc;border-radius:12px;padding:38px"><div style="font-weight:800;letter-spacing:-1px;font-size:27px;color:#193d32">calvren<span style="color:#86a479">.</span></div><div style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#678374;margin-top:26px">YOUR CLIENT WORKSPACE</div><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:36px;line-height:1.15;margin:12px 0 18px">'+escape(specs.heading)+'</h1><p style="font-size:15px;line-height:1.8">'+escape(specs.intro)+'</p><p style="font-size:14px;line-height:1.8;color:#53675b">'+escape(specs.detail)+'</p><a href="'+escape(specs.url)+'" style="display:inline-block;margin-top:22px;background:#1b4937;color:#fff;padding:15px 21px;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">'+escape(specs.action)+' →</a><div style="border-top:1px solid #edf0e8;margin-top:32px;padding-top:20px;font-size:12px;color:#738277;line-height:1.7">Questions? <a href="'+origin+'/contact.html" style="color:#1b4937">Contact Calvren</a>.<br>Secure account information — please do not forward this email.</div></div></div>';
  try{
    const response=await (options.fetcher||fetch)("https://api.resend.com/emails",{
      method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":options.id.slice(0,255)},
      body:JSON.stringify({from:namedFrom,to:[to],subject:specs.subject,text,html}),signal:AbortSignal.timeout(10000),redirect:"error"
    });
    if(!response.ok){console.error(JSON.stringify({event:"calvren_client_mail_failed",kind,status:response.status}));return false;}
    return true;
  }catch{
    console.error(JSON.stringify({event:"calvren_client_mail_failed",kind,reason:"network"}));
    return false;
  }
}
