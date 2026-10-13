// Calvren's public demo is deliberately self-contained: no imports, API calls, admin token,
// sign-in requirement, external providers, or build-generated dependencies.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayIndex = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  const safeClone = value => JSON.parse(JSON.stringify(value));
  const initial = {
    id:"abc-plumbing-demo", business_name:"ABC Plumbing", industry:"Local services",
    services:["Emergency plumbing","Drain cleaning","Leak repair","Water heater repair"],
    timezone:"America/Vancouver", mode:"demo", active:true, booking_enabled:true,
    follow_up_enabled:true, max_follow_up_attempts:3,
    calendar:{provider:"demo",duration_minutes:60,buffer_minutes:15,horizon_days:14},
    business_hours:{
      "0":null,"1":{open:"08:00",close:"17:00"},"2":{open:"08:00",close:"17:00"},
      "3":{open:"08:00",close:"17:00"},"4":{open:"08:00",close:"17:00"},
      "5":{open:"08:00",close:"17:00"},"6":{open:"09:00",close:"13:00"}
    },
    qualifying_questions:[
      {id:"service",prompt:"What service do you need?",required:true},
      {id:"emergency",prompt:"Is this an emergency, or can it wait for a routine appointment?",required:true},
      {id:"area",prompt:"What area are you located in?",required:true},
      {id:"timing",prompt:"When would you like service?",required:true}
    ]
  };
  let client, lead, clock;
  function append(tag, text, className) {
    const el=document.createElement(tag);
    if(text!==undefined) el.textContent=String(text);
    if(className) el.className=className;
    return el;
  }
  function say(sender,text) {
    lead.messages.push({sender,message:text,timestamp:clock.toISOString(),status:sender==="lead"?"received":"sent"});
  }
  function status(id,message,error=false) {
    const element=$(id);
    element.textContent=message;
    element.classList.toggle("error",error);
  }
  function local(date) {
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:client.timezone,weekday:"short",
      year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
    const val=t=>parts.find(p=>p.type===t)?.value||"";
    return { weekday:weekdayIndex[val("weekday").toLowerCase().slice(0,3)],date:val("year")+"-"+val("month")+"-"+val("day"),time:val("hour")+":"+val("minute"),hour:Number(val("hour")) };
  }
  function requestedTime(value) {
    const v=String(value||"").toLowerCase().trim();
    const weekday=/\b(sunday|sun|monday|mon|tuesday|tues?|wednesday|wed|thursday|thurs?|thu|friday|fri|saturday|sat)\b/.exec(v);
    const requestedWeekday=weekday?weekdayIndex[weekday[1].slice(0,3)]:null;
    const today=local(clock).date;
    const shift=days=>{const [y,m,d]=today.split("-").map(Number);return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);};
    const requestedDay=/\btomorrow\b/.test(v)?shift(1):/\b(today|tonight)\b/.test(v)?today:null;
    const part=/\bafternoon\b/.test(v)?[12,17]:/\bmorning\b/.test(v)?[0,12]:/\b(evening|tonight)\b/.test(v)?[17,24]:null;
    return {requestedWeekday,requestedDay,part};
  }
  function slots(preference) {
    const {requestedWeekday,requestedDay,part}=requestedTime(preference);
    const result=[];
    const step=15*60000, duration=client.calendar.duration_minutes*60000;
    const first=Math.ceil((clock.getTime()+3600000)/step)*step;
    const horizon=clock.getTime()+client.calendar.horizon_days*86400000;
    for(let ms=first;ms<horizon&&result.length<3;ms+=step){
      const start=local(new Date(ms));
      const end=local(new Date(ms+duration+client.calendar.buffer_minutes*60000));
      const hours=client.business_hours[String(start.weekday)];
      if(!hours||start.time<hours.open||end.date!==start.date||end.time>hours.close)continue;
      if(requestedWeekday!==null&&start.weekday!==requestedWeekday)continue;
      if(requestedDay&&start.date!==requestedDay)continue;
      if(part&&(start.hour<part[0]||start.hour>=part[1]))continue;
      const label=new Intl.DateTimeFormat("en-US",{timeZone:client.timezone,weekday:"short",
        month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(ms));
      result.push({id:"demo_"+ms,start:new Date(ms).toISOString(),end:new Date(ms+duration).toISOString(),label});
      ms+=(client.calendar.duration_minutes+client.calendar.buffer_minutes-15)*60000;
    }
    return result;
  }
  function kind(question) {
    const p=question.prompt.toLowerCase();
    if(/emergency|urgent/.test(p))return "emergency";
    if(/area|location|located|postcode|zip code|city/.test(p))return "area";
    if(/when|timing|date|time.*service/.test(p))return "timing";
    if(/service|what.*need|what.*help/.test(p))return "service";
    return "other";
  }
  function matchingService(text){
    const source=String(text).toLowerCase();
    if(/\b(sink|leak|leaking|drip)\b/.test(source))return client.services.find(s=>/\bleak\b/i.test(s))||null;
    const tokens=new Set((source.match(/[a-z]+/g)||[]));
    return client.services.find(service=>(service.toLowerCase().match(/[a-z]+/g)||[]).some(t=>
      t.length>3&&tokens.has(t)&&!["service","cleaning","repair","emergency"].includes(t)))||null;
  }
  function nextQuestion(){
    return client.qualifying_questions.find(q=>q.required&&!lead.answers[q.id])||null;
  }
  function conversation(){
    if(lead.opted_out||!lead.active)return;
    const missing=nextQuestion();
    if(missing) {
      lead.status="contacted";
      lead.waiting=missing.id;
      say("assistant",(lead.messages.filter(m=>m.sender==="lead").length===1?"Thanks for contacting "+client.business_name+". ":"Thanks. ")+missing.prompt);
      return;
    }
    lead.qualification_status="qualified";
    if(!lead.notifications.some(n=>n.event==="qualified")){
      lead.notifications.push({event:"qualified",status:"sent",message:"Lead qualified: "+lead.name+". Ready for review."});
    }
    if(!client.booking_enabled){
      lead.status="needs_human";lead.active=false;
      say("assistant","Thanks. A member of the team will review the request and arrange the next step.");
      return;
    }
    const timing=client.qualifying_questions.find(q=>kind(q)==="timing");
    const preference=timing?lead.answers[timing.id]:"";
    lead.offered_slots=slots(preference);
    if(!lead.offered_slots.length){
      lead.status="qualified";lead.waiting=timing?.id||"timing";
      say("assistant","There are no simulated appointments available for that requested day or time. Please choose another day or time, or ask for a person.");
      return;
    }
    lead.waiting=null;
    lead.status="booking";
    say("assistant","Thanks, we have the details needed. Here are simulated appointment options:\n"+
      lead.offered_slots.map((slot,i)=>(i+1)+". "+slot.label).join("\n")+
      "\nReply 1, 2, or 3 to choose a time, or ask for a person.");
  }
  function stop(text,optedOut=false){
    lead.active=false;lead.opted_out=optedOut;lead.status="needs_human";
    lead.handoff_reason=optedOut?"The customer opted out.":"A person should review this enquiry.";
    lead.offered_slots=[];
    lead.notifications.push({event:"needs_human",status:"sent",message:lead.handoff_reason});
    if(!optedOut)say("assistant","I will pause the automated conversation so a person can help.");
  }
  function input(message) {
    if(!lead)return;
    const text=message.trim();
    if(!text)return;
    say("lead",text);
    if(/^(stop|stopall|unsubscribe|cancel|end|quit)[.!]?$/i.test(text)) {
      if(!lead.opted_out)stop(text,true);return render();
    }
    if(!lead.active)return render();
    if(/\b(human|real person|speak to someone|talk to someone|call me|gas leak|smell of gas|fire)\b/i.test(text)){
      stop(text);return render();
    }
    if(lead.status==="booked") {
      say("assistant","Your simulated appointment is recorded. Ask for a person to make changes.");
      return render();
    }
    if(lead.status==="booking"&&/^(?:option\s*|slot\s*)?([1-3])(?:\s*(?:please|works|works for me))?[.!]?$/i.test(text)){
      const num=Number(text.match(/[1-3]/)[0])-1;
      const slot=lead.offered_slots[num];
      if(slot){
        lead.booked=slot;lead.status="booked";lead.offered_slots=[];
        say("assistant","Simulated appointment confirmed: "+slot.label+". No real calendar booking was made.");
        lead.notifications.push({event:"booked",status:"sent",message:"Simulated appointment for "+lead.name+": "+slot.label});
      }
      return render();
    }
    if(lead.status==="booking"){
      const timing=client.qualifying_questions.find(q=>kind(q)==="timing");
      if(timing&&/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|morning|afternoon|evening)\b/i.test(text)){
        lead.answers[timing.id]=text;conversation();return render();
      }
      say("assistant","Choose option 1, 2, or 3, or tell me another preferred day.");
      return render();
    }
    const q=client.qualifying_questions.find(x=>x.id===lead.waiting);
    if(q){
      if(kind(q)==="emergency"&&/^(yes|urgent|emergency)\b/i.test(text)){stop(text);return render();}
      if(kind(q)==="service"){
        const match=matchingService(text);
        if(!match){stop(text);return render();}
        lead.answers[q.id]=match;
      }else {
        if(kind(q)==="timing"&&!/\b(today|tomorrow|morning|afternoon|evening|tonight|anytime|soon|next|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b|\d/i.test(text)){
          say("assistant","Please suggest a day or time, for example Friday morning.");
          return render();
        }
        lead.answers[q.id]=text.slice(0,500);
      }
    }
    conversation();render();
  }
  function render(){
    $("demo-business-heading").textContent=client.business_name;
    $("demo-business-summary").textContent=client.services.join(" · ");
    $("demo-qualification").replaceChildren(...client.qualifying_questions.map(q=>{
      const li=append("li");
      li.dataset.questionId=q.id;li.dataset.answerStatus=lead?.answers[q.id]?"answered":"missing";
      li.append(append("strong",q.prompt+(q.required?" · required":" · optional")),
        append("span",lead?.answers[q.id]||"Waiting for the customer"));
      return li;
    }));
    $("demo-lead-status").textContent=lead?({needs_human:"Needs human",booked:"Booked",booking:"Booking"}[lead.status]||lead.status.replace(/^./,x=>x.toUpperCase())):"Not started";
    $("demo-qualification-status").textContent=lead?lead.qualification_status.replace(/^./,x=>x.toUpperCase()):"Pending";
    $("demo-automation-status").textContent=lead?(lead.opted_out?"Opted out":lead.active?"Active":"Paused for a person"):"Ready";
    $("demo-conversation").replaceChildren(...(lead?.messages||[]).map(m=>{
      const li=append("li",undefined,"conversation-message "+m.sender);
      const meta=append("div",undefined,"message-meta");
      meta.append(append("span",m.sender==="assistant"?client.business_name+" · demo responder":m.sender==="lead"?"Lead":"System"),
        append("span",new Date(m.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" · "+m.status));
      li.append(meta,append("p",m.message));return li;
    }));
    const chat=$("demo-conversation");chat.scrollTop=chat.scrollHeight;
    $("demo-reply").hidden=!lead;
    $("demo-start").disabled=Boolean(lead);
    $("demo-name").disabled=Boolean(lead);$("demo-message").disabled=Boolean(lead);
    $("demo-send").disabled=!lead;
    $("demo-handoff").disabled=!lead||!lead.active;
    $("demo-export").disabled=!lead;
    $("demo-followup").hidden=!lead||!lead.active||lead.status==="booked";
    $("demo-slots").replaceChildren(...(lead?.status==="booking"?lead.offered_slots:[]).map((slot,i)=>{
      const b=append("button",slot.label);b.type="button";b.addEventListener("click",()=>input(String(i+1)));return b;
    }));
    $("demo-appointment").hidden=!lead?.booked;
    $("demo-appointment").textContent=lead?.booked?"Simulated appointment booked: "+lead.booked.label+". No real calendar event was created.":"";
    $("demo-notifications").replaceChildren(...(lead?.notifications.length?lead.notifications.map(n=>{
      const li=append("li",n.event.replace("_"," ")+" · "+n.status+" · "+n.message);
      li.dataset.event=n.event;return li;
    }):[append("li","Notifications will be logged here.")]));
    $("demo-resume-panel").hidden=!lead||lead.active||lead.opted_out;
    $("demo-resume").disabled=!$("demo-resume-consent").checked;
  }
  function reset(nextClient=client||initial){
    client=safeClone(nextClient);client.mode="demo";client.calendar.provider="demo";
    clock=new Date();lead=null;
    $("demo-config").value=JSON.stringify(client,null,2);
    $("demo-name").value="Alex Taylor";
    $("demo-message").value="Hi, my kitchen sink is leaking and I need someone to look at it.";
    $("demo-reply-message").value="";$("demo-resume-consent").checked=false;
    status("demo-intake-status","Ready for a fake enquiry.");status("demo-action-status","");
    render();
  }
  function validate(config){
    if(!config||typeof config!=="object"||config.mode!=="demo"||config.calendar?.provider!=="demo"||
      !Array.isArray(config.services)||!config.services.length||!Array.isArray(config.qualifying_questions)||
      !config.business_hours||!config.timezone||!config.business_name||
      !Number.isInteger(config.calendar.duration_minutes)||!Number.isInteger(config.calendar.horizon_days))throw Error("Enter a complete demo business configuration.");
    new Intl.DateTimeFormat("en-US",{timeZone:config.timezone});
    return config;
  }
  $("demo-intake").addEventListener("submit",event=>{
    event.preventDefault();if(lead)return;
    try{
      const name=$("demo-name").value.trim(),text=$("demo-message").value.trim();
      if(!name||!text)throw Error("Enter a fake customer name and message.");
      lead={name,answers:{},messages:[],notifications:[],offered_slots:[],booked:null,active:true,
        opted_out:false,status:"new",qualification_status:"pending",waiting:null};
      say("lead",text);
      const service=matchingService(text);
      const q=client.qualifying_questions.find(q=>kind(q)==="service");
      if(service&&q)lead.answers[q.id]=service;
      conversation();render();
      status("demo-intake-status","Conversation started. No real messages were sent.");
    }catch(err){status("demo-intake-status",err.message||"Try the example enquiry again.",true);}
  });
  $("demo-reply").addEventListener("submit",event=>{
    event.preventDefault();
    try{input($("demo-reply-message").value);$("demo-reply-message").value="";
      status("demo-action-status","Reply processed in this demo. No real messages were sent.");
    }catch(err){status("demo-action-status",err.message||"Please try again.",true);}
  });
  $("demo-config-form").addEventListener("submit",event=>{
    event.preventDefault();
    try{reset(validate(JSON.parse($("demo-config").value)));
      status("demo-config-status","Demo business updated. Previous fake leads were cleared.");
    }catch(err){status("demo-config-status",err.message||"Check your demo business JSON.",true);}
  });
  $("demo-reset").addEventListener("click",()=>reset());
  $("demo-handoff").addEventListener("click",()=>{if(lead){stop("Requested handoff");render();}});
  $("demo-resume-consent").addEventListener("change",render);
  $("demo-resume").addEventListener("click",()=>{
    if(lead&&!lead.active&&!lead.opted_out&&$("demo-resume-consent").checked){
      lead.active=true;lead.status="responding";$("demo-resume-consent").checked=false;
      conversation();render();
    }
  });
  $("demo-followup").addEventListener("click",()=>{
    if(!lead||!lead.active||lead.status==="booked")return;
    clock=new Date(clock.getTime()+7200000);
    say("assistant","Hi "+lead.name.split(" ")[0]+", just checking whether you'd like to continue your enquiry. "+
      (nextQuestion()?.prompt||"Please reply with a preferred appointment option."));
    render();
  });
  $("demo-export").addEventListener("click",()=>{
    if(!lead)return;
    const data=JSON.stringify({simulation:true,client,lead},null,2);
    const url=URL.createObjectURL(new Blob([data],{type:"application/json"}));
    const link=append("a");link.href=url;link.download="calvren-fake-lead-example.json";link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  // A public, local-only simulation must never depend on the signup API or private operator.
  $("demo-access-check").hidden=true;$("main").hidden=false;
  const exit=$("demo-sign-out");exit.textContent="Start over";exit.addEventListener("click",()=>reset());
  reset(initial);
  document.documentElement.dataset.calvrenDemoReady="true";
})();