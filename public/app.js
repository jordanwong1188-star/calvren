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
function updateEstimate() {
  const tasks = Number($("monthly-tasks").value), minutes = Number($("minutes-per-task").value);
  $("tasks-value").value = String(tasks); $("minutes-value").value = String(minutes);
  $("hours-result").textContent = (tasks * minutes / 60).toFixed(1);
}
$("monthly-tasks").addEventListener("input", updateEstimate);
$("minutes-per-task").addEventListener("input", updateEstimate);
$("year").textContent = String(new Date().getFullYear()); updateCount(); updateEstimate();
$("contact-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector("button[type=submit]");
  const body = new URLSearchParams();
  for (const [key,value] of new FormData(form)) body.append(key,String(value));
  button.disabled = true; $("contact-error").hidden = true;
  try {
    const response = await fetch("/", {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    if (!response.ok) throw new Error("The enquiry could not be submitted.");
    window.location.assign("/thanks.html");
  } catch { $("contact-error").textContent = "We couldn’t submit your enquiry. Please try again in a moment."; $("contact-error").hidden = false; button.disabled = false; }
});
