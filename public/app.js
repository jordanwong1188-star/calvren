import { scenarios, previewEnquiry } from "./demo-engine.js";
const $ = (id) => document.getElementById(id);
let selectedScenario = "real-estate";
let lastResult = null;
function setStatus(message) { $("demo-announcement").textContent = message; }
function updateCount() { $("character-count").textContent = $("enquiry").value.length.toLocaleString() + " / 2,000"; }
function clearOutput() {
  lastResult = null; $("demo-results").hidden = true; $("demo-empty").hidden = false;
  $("demo-state").textContent = "WAITING FOR INPUT"; $("demo-error").hidden = true;
}
document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedScenario = button.dataset.scenario;
    document.querySelectorAll("[data-scenario]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    $("enquiry").value = scenarios[selectedScenario]; updateCount(); clearOutput();
    setStatus("Example changed. Edit the message or run the workflow.");
  });
});
$("reset-example").addEventListener("click", () => { $("enquiry").value = scenarios[selectedScenario]; updateCount(); clearOutput(); setStatus("Example reset."); });
$("enquiry").addEventListener("input", () => { updateCount(); clearOutput(); });
$("demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    lastResult = previewEnquiry($("enquiry").value, selectedScenario);
    $("lead-intent").textContent = lastResult.intent; $("lead-summary").textContent = lastResult.summary;
    $("missing-details").textContent = lastResult.missing; $("reply-draft").textContent = lastResult.replyDraft;
    $("next-action").textContent = lastResult.nextAction;
    $("lead-tags").replaceChildren(...lastResult.tags.map((tag) => { const node = document.createElement("span"); node.className = "tag"; node.textContent = tag; return node; }));
    $("demo-empty").hidden = true; $("demo-results").hidden = false; $("demo-error").hidden = true;
    $("demo-state").textContent = "EXAMPLE PREPARED"; $("copy-reply").textContent = "Copy draft";
    setStatus("Example prepared. Lead type: " + lastResult.intent + ". A reply draft and proposed next action are ready for review.");
    window.calvrenTrackEvent?.("demo_started");
  } catch (error) { $("demo-error").textContent = error.message; $("demo-error").hidden = false; }
});
$("copy-reply").addEventListener("click", async () => {
  if (!lastResult) return;
  try { await navigator.clipboard.writeText(lastResult.replyDraft); $("copy-reply").textContent = "Copied"; setStatus("Reply draft copied."); }
  catch { setStatus("Copy is unavailable in this browser. Select the draft text to copy it."); $("copy-reply").textContent = "Select text to copy"; }
});
$("download-result").addEventListener("click", () => {
  if (!lastResult) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastResult, null, 2)], {type:"application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = "calvren-example-record.json";
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Example record downloaded. This is a local preview, not an external CRM record.");
});
let estimatorTracked=false;
const cad=value=>new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0}).format(value);
function updateEstimate(interacted=false) {
  const tasks=Number($("monthly-tasks").value),minutes=Number($("minutes-per-task").value);
  const share=Number($("automation-share").value)/100,review=Number($("review-minutes").value);
  const hourly=Number($("hourly-value").value),plan=Number($("estimate-plan").value);
  const totalHours=tasks*minutes/60;
  const freedHours=Math.max(0,tasks*share*(minutes-review)/60);
  const value=freedHours*hourly,difference=value-plan;
  $("tasks-value").value=String(tasks);$("minutes-value").value=String(minutes);
  $("share-value").value=String(Math.round(share*100))+"%";$("review-value").value=String(review);
  $("hourly-value-display").value=cad(hourly);
  $("hours-result").textContent=totalHours.toFixed(1);
  $("saved-hours").textContent=freedHours.toFixed(1)+" hours";
  $("monthly-value").textContent=cad(value);
  $("comparison-result").textContent=(difference<0?"−":"+")+cad(Math.abs(difference));
  $("comparison-note").textContent=difference>=0
    ?"Illustrative labour-time value exceeds the monthly plan fee. This is not guaranteed cash savings."
    :"Illustrative labour-time value is below the monthly plan fee. Response speed and reliability may still matter.";
  if(interacted&&!estimatorTracked){estimatorTracked=true;window.calvrenTrackEvent?.("estimator_used");}
}
for(const id of ["monthly-tasks","minutes-per-task","automation-share","review-minutes","hourly-value"])
  $(id).addEventListener("input",()=>updateEstimate(true));
$("estimate-plan").addEventListener("change",()=>updateEstimate(true));
updateCount(); updateEstimate();
const initialScenario=new URLSearchParams(location.search).get("scenario");
if(Object.hasOwn(scenarios,initialScenario))document.querySelector('[data-scenario="'+initialScenario+'"]')?.click();
