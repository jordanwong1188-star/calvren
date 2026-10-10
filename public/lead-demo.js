import { ConversionEngine } from "/conversion/engine.mjs";
import { MemoryRepository } from "/conversion/memory-repository.mjs";
import { createDemoServices } from "/conversion/mock-services.mjs";
import { newDemoClient } from "/conversion/demo-config.mjs";
import { validateClient } from "/conversion/validation.mjs";

import { requireDemoAccess, clearDemoAccess } from "/demo-access.js";
await requireDemoAccess();
document.getElementById("demo-access-check").hidden = true;
document.getElementById("main").hidden = false;
document.getElementById("demo-sign-out").addEventListener("click", clearDemoAccess);
const $ = id => document.getElementById(id);
const titleCase = value => String(value || "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const uuid = () => crypto.randomUUID();
let client = newDemoClient();
let repository;
let engine;
let bundle = null;
let clock = new Date();
let busy = false;
let generation = 0;
let pendingIntakeKey = uuid();

function status(id, message, error = false) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle("error", error);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderConversation(messages) {
  const list = $("demo-conversation");
  list.replaceChildren();
  for (const message of messages) {
    const item = element("li", undefined, `conversation-message ${message.sender}`);
    const meta = element("div", undefined, "message-meta");
    meta.append(element("span", message.sender === "assistant" ? `${client.business_name} · demo responder` : titleCase(message.sender)),
      element("span", `${new Date(message.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · ${message.status}`));
    item.append(meta, element("p", message.message));
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}
function render() {
  $("demo-business-heading").textContent = client.business_name;
  $("demo-business-summary").textContent = client.services.join(" · ");
  $("demo-qualification").replaceChildren();
  for (const question of client.qualifying_questions) {
    const answer = bundle?.lead.answers[question.id];
    const item = element("li");
    item.dataset.questionId = question.id;
    item.dataset.answerStatus = answer ? "answered" : "missing";
    item.append(element("strong", question.prompt + (question.required ? " · required" : " · optional")),
      element("span", answer || "Waiting for the customer"));
    $("demo-qualification").append(item);
  }
  const lead = bundle?.lead;
  $("demo-lead-status").textContent = lead ? titleCase(lead.status) : "Not started";
  $("demo-qualification-status").textContent = lead ? titleCase(lead.qualification_status) : "Pending";
  $("demo-automation-status").textContent = lead ? (lead.opted_out ? "Opted out" : lead.automation_active ? "Active" : "Paused for a person") : "Ready";
  $("demo-automation-status").parentElement.classList.toggle("attention", Boolean(lead && !lead.automation_active));
  renderConversation(bundle?.messages || []);
  $("demo-reply").hidden = !lead;
  $("demo-send").disabled = busy || !lead;
  $("demo-start").disabled = busy || Boolean(lead);
  $("demo-name").disabled = Boolean(lead);
  $("demo-message").disabled = Boolean(lead);
  $("demo-handoff").disabled = busy || !lead?.automation_active;
  $("demo-resume-panel").hidden = !lead || lead.automation_active || lead.opted_out;
  $("demo-resume").disabled = busy || !$("demo-resume-consent").checked;
  $("demo-followup").hidden = !lead?.next_follow_up_at || !lead.automation_active;
  $("demo-followup").disabled = busy;
  $("demo-export").disabled = !bundle;
  $("demo-reset").disabled = busy;
  $("demo-slots").replaceChildren();
  if (lead?.automation_active && lead.appointment_status === "offered") {
    for (const [index, slot] of lead.offered_slots.entries()) {
      const button = element("button", slot.label);
      button.type = "button";
      button.dataset.slotId = slot.id;
      button.disabled = busy;
      button.addEventListener("click", () => reply(String(index + 1)));
      $("demo-slots").append(button);
    }
  }
  const booked = bundle?.appointments.find(appointment => appointment.status === "booked");
  $("demo-appointment").hidden = !booked;
  $("demo-appointment").textContent = booked ? `Simulated appointment booked: ${booked.slot.label}. No real calendar event was created.` : "";
  $("demo-notifications").replaceChildren();
  if (bundle?.notifications.length) {
    for (const notification of bundle.notifications) {
      const item = element("li", `${titleCase(notification.event)} · ${notification.status} · ${notification.message}`);
      item.dataset.event = notification.event;
      $("demo-notifications").append(item);
    }
  } else {
    $("demo-notifications").append(element("li", "Notifications will be logged here."));
  }
  if (lead && !lead.automation_active) {
    status("demo-action-status", lead.opted_out ? "The customer opted out. No autonomous replies or follow-ups will be sent." :
      `Automation is paused: ${lead.handoff_reason || "A person needs to review this lead."} Customer replies are still saved.`);
  }
}
function reset(nextClient = client) {
  generation++;
  client = structuredClone(nextClient);
  client.mode = "demo";
  client.calendar.provider = "demo";
  repository = new MemoryRepository([client]);
  clock = new Date();
  engine = new ConversionEngine({repository, ...createDemoServices(), now: () => new Date(clock)});
  bundle = null;
  pendingIntakeKey = uuid();
  $("demo-config").value = JSON.stringify(client, null, 2);
  $("demo-resume-consent").checked = false;
  $("demo-reply-message").value = "";
  status("demo-intake-status", "Ready for a fake enquiry.");
  status("demo-action-status", "");
  render();
}
async function run(action, id = "demo-action-status") {
  if (busy) return;
  busy = true;
  const currentGeneration = generation;
  status(id, "Running the simulation…");
  render();
  try {
    const result = await action();
    if (currentGeneration !== generation) return;
    if (result?.lead) bundle = result;
    if (bundle) bundle = await repository.getBundle(client.id, bundle.lead.id);
    status(id, "Saved in this demo. No real messages or appointments were sent.");
  } catch (error) {
    if (currentGeneration !== generation) return;
    status(id, error?.message || "The simulation could not finish this step.", true);
  } finally {
    busy = false;
    render();
  }
}
async function reply(message) {
  if (!bundle || !message.trim()) return;
  const currentLead = bundle.lead.id;
  await run(() => engine.receive({client_id:client.id, lead_id:currentLead, message,
    channel:"website", event_key:uuid()}));
  $("demo-reply-message").value = "";
}
$("demo-intake").addEventListener("submit", event => {
  event.preventDefault();
  run(() => engine.intake({client_id:client.id, name:$("demo-name").value.trim(),
    message:$("demo-message").value.trim(), channel:"website", source:"browser-demo",
    idempotency_key:pendingIntakeKey}), "demo-intake-status");
});
$("demo-reply").addEventListener("submit", event => {
  event.preventDefault();
  reply($("demo-reply-message").value);
});
$("demo-config-form").addEventListener("submit", event => {
  event.preventDefault();
  if (busy) return;
  try {
    const config = validateClient(JSON.parse($("demo-config").value));
    if (!config || typeof config !== "object" || typeof config.business_name !== "string" ||
        !Array.isArray(config.services) || !Array.isArray(config.qualifying_questions) ||
        !config.calendar || config.mode !== "demo" || config.calendar.provider !== "demo") {
      throw new Error("Enter a complete client configuration with mode and calendar provider set to demo.");
    }
    reset(config);
    status("demo-config-status", "Configuration applied. The previous fake lead was cleared.");
  } catch (error) {
    status("demo-config-status", error?.message || "Check your JSON configuration.", true);
  }
});
$("demo-reset").addEventListener("click", () => reset());
$("demo-handoff").addEventListener("click", () => {
  if (bundle) run(() => engine.handoff(client.id, bundle.lead.id, "Paused by the Calvren demo operator for human review."));
});
$("demo-resume-consent").addEventListener("change", render);
$("demo-resume").addEventListener("click", () => {
  if (bundle && $("demo-resume-consent").checked && !bundle.lead.opted_out) {
    run(() => engine.resume(client.id, bundle.lead.id));
    $("demo-resume-consent").checked = false;
  }
});
$("demo-followup").addEventListener("click", () => {
  if (!bundle?.lead.next_follow_up_at) return;
  run(async () => {
    clock = new Date(new Date(bundle.lead.next_follow_up_at).getTime() + 1000);
    await engine.followUps(1);
    return repository.getBundle(client.id, bundle.lead.id);
  });
});
$("demo-export").addEventListener("click", () => {
  if (!bundle) return;
  const blob = new Blob([JSON.stringify({simulation:true, client, ...bundle}, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = "calvren-fake-lead-example.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
reset();
