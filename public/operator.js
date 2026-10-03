import { newDemoClient } from "/conversion/demo-config.mjs";

const $ = id => document.getElementById(id);
const titleCase = value => String(value || "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const endpoint = "/api/conversion";
let token = "";
let epoch = 0;
let clients = [];
let leads = [];
let selected = null;
let editorClientId = "";
let readiness = null;
const controllers = new Set();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}
function clearKey() {
  $("operator-key-value").textContent = "";
  $("operator-key-box").hidden = true;
  $("operator-key-confirm").checked = false;
}
function disconnect(message = "Disconnected. Private data and the token were cleared from this page.") {
  epoch++;
  token = "";
  for (const controller of controllers) controller.abort();
  controllers.clear();
  clients = [];
  leads = [];
  selected = null;
  editorClientId = "";
  readiness = null;
  $("operator-token").value = "";
  $("operator-workspace").hidden = true;
  $("operator-disconnect").hidden = true;
  $("operator-readiness").replaceChildren();
  $("operator-leads").replaceChildren();
  $("operator-conversation").replaceChildren();
  $("operator-answers").replaceChildren();
  $("operator-appointments").replaceChildren();
  $("operator-notifications").replaceChildren();
  $("operator-slots").replaceChildren();
  $("operator-client-config").value = "";
  $("operator-client-editor-select").replaceChildren(element("option", "New business"));
  $("operator-client-filter").replaceChildren(element("option", "All businesses"));
  $("operator-intake-client").replaceChildren();
  $("operator-reply-message").value = "";
  $("operator-intake-name").value = "Alex Taylor";
  $("operator-intake-message").value = "Hi, my kitchen sink is leaking and I need someone to look at it.";
  for (const id of ["operator-detail-name","operator-detail-contact","operator-detail-business","operator-detail-mode",
    "operator-detail-status","operator-detail-qualified","operator-detail-automation","operator-detail-reason",
    "operator-followup","operator-key-status","operator-action-status","operator-client-status","operator-leads-status",
    "operator-intake-status","operator-lead-count","operator-setup"]) $(id).textContent = "";
  clearKey();
  renderDetail();
  status("operator-auth-status", message);
}
async function request(path, {method = "GET", body} = {}) {
  if (!token) throw new Error("Connect with your operator token first.");
  const startEpoch = epoch;
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const response = await fetch(endpoint + path, {
      method, signal:controller.signal, credentials:"omit", redirect:"error",
      headers:{Authorization:`Bearer ${token}`, Accept:"application/json", ...(body ? {"Content-Type":"application/json"} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    const data = await response.json().catch(() => ({error:"The server returned an unreadable response."}));
    if (startEpoch !== epoch) throw new Error("The workspace connection changed.");
    if (response.status === 401 || response.status === 403) {
      disconnect("Access was refused. Check the server token and reconnect.");
      throw new Error(data.error || "Operator access was refused.");
    }
    if (!response.ok || data.ok === false) throw new Error(data.error || "The request could not be completed.");
    return data;
  } finally {
    controllers.delete(controller);
  }
}
async function action(id, operation) {
  const startEpoch = epoch;
  status(id, "Working…");
  try {
    await operation();
  } catch (error) {
    if (startEpoch === epoch) status(id, error?.message || "The action could not finish.", true);
  }
}
function renderReadiness() {
  const container = $("operator-readiness");
  container.replaceChildren();
  if (!readiness) return;
  const checks = [
    ["Mode", readiness.mode === "live" ? "Live · check client rules" : "Demo · mock delivery", true],
    ["Database", readiness.database ? "Connected" : "Setup required", readiness.database],
    ["OpenAI", readiness.providers?.openai ? "Configured" : "Not configured", readiness.providers?.openai],
    ["Twilio SMS", readiness.providers?.twilio ? "Configured" : "Not configured", readiness.providers?.twilio],
    ["Google Calendar", readiness.providers?.google ? "Configured" : "Not configured", readiness.providers?.google],
    ["Business email", readiness.providers?.notifications ? "Configured" : "Not configured", readiness.providers?.notifications],
    ["Deployment", readiness.production ? "Production" : "Preview / development", readiness.production],
    ["Browser demo", "Available without credentials", true]
  ];
  for (const [label, value, ready] of checks) {
    const card = element("div", undefined, "conversion-stat" + (ready ? "" : " attention"));
    card.append(element("small", label), element("strong", value));
    container.append(card);
  }
  const issues = Array.isArray(readiness.issues) ? readiness.issues.join(" ") : "";
  status("operator-setup", issues || (readiness.mode === "demo" ?
    "Demo clients use mock providers. Complete the database and provider setup before onboarding a live client." :
    "Configured credentials still need an end-to-end test on each client's number and calendar."));
}
function option(value, label) {
  const node = element("option", label);
  node.value = value;
  return node;
}
function renderClientSelectors() {
  const oldFilter = $("operator-client-filter").value;
  $("operator-client-filter").replaceChildren(option("", "All businesses"));
  $("operator-client-editor-select").replaceChildren(option("", "New business"));
  $("operator-intake-client").replaceChildren(option("", "Select a demo business"));
  for (const client of clients) {
    const label = `${client.business_name} · ${client.mode}${client.active ? "" : " · inactive"}`;
    $("operator-client-filter").append(option(client.id, label));
    $("operator-client-editor-select").append(option(client.id, label));
    if (client.mode === "demo" && client.active) $("operator-intake-client").append(option(client.id, label));
  }
  if (clients.some(client => client.id === oldFilter)) $("operator-client-filter").value = oldFilter;
  if (clients.some(client => client.id === editorClientId)) $("operator-client-editor-select").value = editorClientId;
}
function setEditor(client = null) {
  editorClientId = client?.id || "";
  $("operator-client-editor-select").value = editorClientId;
  const config = client || newDemoClient({id:`client-${crypto.randomUUID().slice(0,8)}`, business_name:"New demo business"});
  $("operator-client-config").value = JSON.stringify(config, null, 2);
  $("operator-key-controls").hidden = !editorClientId;
  clearKey();
  status("operator-client-status", client ? `Editing ${client.business_name}. Existing leads keep their original demo/live mode.` :
    "Start from this illustrative demo configuration, replace the business details and save.");
  status("operator-key-status", "");
}
function renderLeads() {
  const clientFilter = $("operator-client-filter").value;
  const statusFilter = $("operator-status-filter").value;
  const shown = leads.filter(bundle => (!clientFilter || bundle.lead.client_id === clientFilter) &&
    (!statusFilter || bundle.lead.status === statusFilter));
  $("operator-lead-count").textContent = `(${shown.length})`;
  $("operator-leads").replaceChildren();
  if (!shown.length) {
    $("operator-leads").append(element("p", "No leads match this view.", "empty-state"));
  }
  for (const bundle of shown) {
    const lead = bundle.lead;
    const client = clients.find(item => item.id === lead.client_id);
    const button = element("button", undefined, "operator-lead-button");
    button.type = "button";
    button.dataset.leadId = lead.id;
    button.setAttribute("aria-pressed", String(selected?.lead.id === lead.id));
    button.append(element("strong", lead.name || "Unnamed lead"),
      element("small", `${client?.business_name || lead.client_id} · ${titleCase(lead.status)} · ${lead.mode}`),
      element("p", lead.original_message.slice(0,180)));
    button.addEventListener("click", () => action("operator-leads-status", async () => {
      const data = await request(`/leads/${encodeURIComponent(lead.id)}?client_id=${encodeURIComponent(lead.client_id)}`);
      selected = data.bundle;
      $("operator-resume-confirm").checked = false;
      status("operator-action-status", "");
      renderLeads();
      renderDetail();
      status("operator-leads-status", "Conversation loaded.");
    }));
    $("operator-leads").append(button);
  }
}
function renderDetail() {
  $("operator-detail-empty").hidden = Boolean(selected);
  $("operator-detail-content").hidden = !selected;
  if (!selected) return;
  const {lead, messages, appointments, notifications} = selected;
  const client = clients.find(item => item.id === lead.client_id);
  $("operator-detail-business").textContent = client?.business_name || lead.client_id;
  $("operator-detail-name").textContent = lead.name || "Unnamed lead";
  $("operator-detail-mode").textContent = `${lead.mode} · ${lead.channel}`;
  $("operator-detail-contact").textContent = [lead.phone,lead.email].filter(Boolean).join(" · ") || "Website demo · no delivery contact";
  $("operator-detail-status").textContent = titleCase(lead.status);
  $("operator-detail-qualified").textContent = titleCase(lead.qualification_status);
  $("operator-detail-automation").textContent = lead.opted_out ? "Opted out" : lead.automation_active ? "Active" : "Paused";
  $("operator-detail-reason").textContent = lead.handoff_reason || "";
  $("operator-conversation").replaceChildren();
  for (const message of messages) {
    const item = element("li", undefined, `conversation-message ${message.sender}`);
    const meta = element("div", undefined, "message-meta");
    meta.append(element("span", `${titleCase(message.sender)} · ${message.ai ? "AI" : "human/system"} · ${message.channel}`),
      element("span", `${new Date(message.timestamp).toLocaleString()} · ${message.status}`));
    item.append(meta, element("p", message.message));
    $("operator-conversation").append(item);
  }
  $("operator-conversation").scrollTop = $("operator-conversation").scrollHeight;
  $("operator-answers").replaceChildren();
  for (const [id, value] of Object.entries(lead.answers)) {
    const question = client?.qualifying_questions.find(question => question.id === id);
    const item = element("li");
    item.append(element("strong", question?.prompt || id), element("span", value));
    $("operator-answers").append(item);
  }
  if (!Object.keys(lead.answers).length) $("operator-answers").append(element("li", "No qualifying answers yet."));
  $("operator-appointments").replaceChildren();
  for (const appointment of appointments) {
    $("operator-appointments").append(element("p", `${titleCase(appointment.status)} · ${appointment.slot.label}`, "appointment-note"));
  }
  if (!appointments.length) $("operator-appointments").append(element("p", "No appointment yet."));
  $("operator-notifications").replaceChildren();
  for (const notification of notifications) {
    $("operator-notifications").append(element("li", `${titleCase(notification.event)} · ${notification.status} · ${notification.message}`));
  }
  if (!notifications.length) $("operator-notifications").append(element("li", "No notifications yet."));
  $("operator-followup").textContent = `Follow-up attempts: ${lead.follow_up_attempts}. ${lead.next_follow_up_at ?
    "Next check: " + new Date(lead.next_follow_up_at).toLocaleString() : "No follow-up scheduled."}`;
  $("operator-handoff").hidden = !lead.automation_active;
  $("operator-resume-panel").hidden = lead.automation_active || lead.opted_out;
  $("operator-resume").disabled = !$("operator-resume-confirm").checked;
  $("operator-reply").hidden = lead.mode !== "demo";
  $("operator-slots").replaceChildren();
  if (lead.mode === "demo" && lead.automation_active && lead.appointment_status === "offered") {
    for (const slot of lead.offered_slots) {
      const button = element("button", slot.label);
      button.type = "button";
      button.addEventListener("click", () => reply(slot.id));
      $("operator-slots").append(button);
    }
  }
}
function updateBundle(bundle) {
  selected = bundle;
  const index = leads.findIndex(item => item.lead.id === bundle.lead.id && item.lead.client_id === bundle.lead.client_id);
  if (index < 0) leads.unshift(bundle);
  else leads[index] = bundle;
  renderLeads();
  renderDetail();
}
async function loadStatus() {
  const data = await request("/status");
  readiness = data.readiness;
  renderReadiness();
}
async function refresh() {
  const [clientData, leadData] = await Promise.all([request("/clients"), request("/leads")]);
  clients = clientData.clients;
  leads = leadData.leads;
  renderClientSelectors();
  if (selected) selected = leads.find(item => item.lead.id === selected.lead.id && item.lead.client_id === selected.lead.client_id) || null;
  renderLeads();
  renderDetail();
  if (!editorClientId && !$("operator-client-config").value) setEditor();
  status("operator-leads-status", "Client and lead records refreshed.");
}
$("operator-auth").addEventListener("submit", async event => {
  event.preventDefault();
  const nextToken = $("operator-token").value.trim();
  if (nextToken.length < 32) {
    status("operator-auth-status", "Use the server's private token, at least 32 characters.", true);
    return;
  }
  disconnect("");
  token = nextToken;
  status("operator-auth-status", "Connecting…");
  const startEpoch = epoch;
  try {
    await loadStatus();
    if (startEpoch !== epoch) return;
    $("operator-workspace").hidden = false;
    $("operator-disconnect").hidden = false;
    status("operator-auth-status", "Connected. Your token is held only in this page's memory.");
    setEditor();
    if (readiness.database) await refresh();
    else status("operator-leads-status", "Set up the Calvren Supabase database to save clients and leads. The browser lead demo works now.");
  } catch (error) {
    if (startEpoch === epoch) {
      disconnect();
      status("operator-auth-status", error?.message || "Could not connect to the server.", true);
    }
  }
});
$("operator-disconnect").addEventListener("click", () => disconnect());
$("operator-check").addEventListener("click", () => action("operator-setup", loadStatus));
$("operator-refresh").addEventListener("click", () => action("operator-leads-status", refresh));
$("operator-client-filter").addEventListener("change", renderLeads);
$("operator-status-filter").addEventListener("change", renderLeads);
$("operator-new-client").addEventListener("click", () => setEditor());
$("operator-client-editor-select").addEventListener("change", () => {
  setEditor(clients.find(client => client.id === $("operator-client-editor-select").value) || null);
});
$("operator-client-form").addEventListener("submit", event => {
  event.preventDefault();
  action("operator-client-status", async () => {
    const config = JSON.parse($("operator-client-config").value);
    if (editorClientId && config.id !== editorClientId) throw new Error("A saved client ID cannot be changed. Create a new client instead.");
    const data = await request(editorClientId ? `/clients/${encodeURIComponent(editorClientId)}` : "/clients",
      {method:editorClientId ? "PUT" : "POST",body:config});
    await refresh();
    setEditor(data.client);
    status("operator-client-status", "Business configuration saved.");
  });
});
$("operator-key-rotate").addEventListener("click", () => {
  if (!editorClientId || !$("operator-key-confirm").checked) {
    status("operator-key-status", "Select a saved client and acknowledge that its previous key will be replaced.", true);
    return;
  }
  action("operator-key-status", async () => {
    const keyClientId = editorClientId;
    const data = await request(`/clients/${encodeURIComponent(keyClientId)}/key`, {method:"POST",body:{}});
    if (editorClientId !== keyClientId) return;
    $("operator-key-value").textContent = data.key;
    $("operator-key-box").hidden = false;
    $("operator-key-confirm").checked = false;
    status("operator-key-status", "New key generated. Copy it to the client's server, then clear it from this page.");
  });
});
$("operator-key-hide").addEventListener("click", clearKey);
$("operator-intake").addEventListener("submit", event => {
  event.preventDefault();
  action("operator-intake-status", async () => {
    const clientId = $("operator-intake-client").value;
    const client = clients.find(item => item.id === clientId);
    if (!client || client.mode !== "demo") throw new Error("Select an active demo business.");
    const data = await request("/leads", {method:"POST",body:{client_id:clientId,name:$("operator-intake-name").value.trim(),
      message:$("operator-intake-message").value.trim(),source:"operator-demo",channel:"website",
      idempotency_key:crypto.randomUUID()}});
    updateBundle(data.bundle);
    status("operator-intake-status", "Fake lead saved. No real message was sent.");
  });
});
async function reply(message) {
  if (!selected || selected.lead.mode !== "demo" || !message.trim()) return;
  const lead = selected.lead;
  await action("operator-action-status", async () => {
    const data = await request(`/leads/${encodeURIComponent(lead.id)}/reply`, {method:"POST",body:{client_id:lead.client_id,
      message,event_key:crypto.randomUUID()}});
    updateBundle(data.bundle);
    $("operator-reply-message").value = "";
    status("operator-action-status", "Demo reply saved and processed.");
  });
}
$("operator-reply").addEventListener("submit", event => {event.preventDefault();reply($("operator-reply-message").value);});
$("operator-handoff").addEventListener("click", () => {
  if (!selected) return;
  const lead = selected.lead;
  action("operator-action-status", async () => {
    const data = await request(`/leads/${encodeURIComponent(lead.id)}/handoff`, {method:"POST",body:{client_id:lead.client_id,
      reason:"Calvren operator paused this lead for human review."}});
    updateBundle(data.bundle);
    status("operator-action-status", "Automation paused. The business has been notified or the notification failure logged.");
  });
});
$("operator-resume-confirm").addEventListener("change", renderDetail);
$("operator-resume").addEventListener("click", () => {
  if (!selected || selected.lead.opted_out || !$("operator-resume-confirm").checked) return;
  const lead = selected.lead;
  action("operator-action-status", async () => {
    const data = await request(`/leads/${encodeURIComponent(lead.id)}/resume`, {method:"POST",body:{client_id:lead.client_id}});
    updateBundle(data.bundle);
    $("operator-resume-confirm").checked = false;
    renderDetail();
    status("operator-action-status", "Automation re-enabled after operator review.");
  });
});
window.addEventListener("pagehide", () => disconnect());
