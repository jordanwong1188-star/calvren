// Public project identifier and publishable key only. Never put server credentials here.
const origin = "https://xjfsukhfmkgvlfpgjevg.supabase.co";
const publishableKey = "sb_publishable_cCLJ_WnlgiBsHsU0BzWcvQ_ID03dhxw";
const sessionKey = "calvren-demo-session";
const signupPath = "/try-demo.html";
export async function verifiedDemoSession() {
  let session;
  try { session = JSON.parse(sessionStorage.getItem(sessionKey) || "null"); } catch { return null; }
  if (!session?.access_token || !Number.isFinite(session.expires_at) || session.expires_at <= Date.now()) {
    sessionStorage.removeItem(sessionKey); return null;
  }
  try {
    const response = await fetch(origin + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: "Bearer " + session.access_token },
      signal: AbortSignal.timeout(10000), cache: "no-store"
    });
    if (!response.ok) { if (response.status === 401 || response.status === 403) sessionStorage.removeItem(sessionKey); return null; }
    const user = await response.json();
    return user.id && user.email_confirmed_at ? { ...session, email: user.email } : null;
  } catch { return null; }
}
async function receiveEmailLink() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get("access_token");
  if (fragment.has("error") || fragment.has("error_description")) {
    history.replaceState(null, "", signupPath);
    throw new Error("That sign-in link has expired or could not be verified. Request a fresh link below.");
  }
  if (!token) return false;
  const seconds = Number(fragment.get("expires_in"));
  history.replaceState(null, "", signupPath);
  if (!seconds || seconds < 1 || seconds > 86400) throw new Error("Please request a fresh sign-in link.");
  try { sessionStorage.setItem(sessionKey, JSON.stringify({ access_token: token, expires_at: Date.now() + seconds * 1000 })); }
  catch { throw new Error("Allow browser storage for this website to complete sign-in."); }
  if (!await verifiedDemoSession()) throw new Error("We couldn’t verify your sign-in. Request a fresh link or try again.");
  return true;
}
function makeDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "demo-access-dialog";
  dialog.setAttribute("aria-labelledby", "demo-access-title");
  dialog.innerHTML = `
    <button type="button" class="demo-access-close" aria-label="Close demo sign-in">×</button>
    <p class="eyebrow"><span class="tiny-dot"></span> YOUR FRONT-ROW SEAT</p>
    <div class="demo-access-symbol" aria-hidden="true">↗</div>
    <h2 id="demo-access-title">Ready to put<br><em>Calvren to the test?</em></h2>
    <p class="demo-access-description">Play the customer. Watch a lead become a conversation, then a simulated booking. Your next “what if?” starts here.</p>
    <div class="demo-access-perks"><span>✓ No password</span><span>✓ No card</span><span>✓ Fake leads only</span></div>
    <form id="demo-access-form">
      <label for="demo-access-email">Your email</label>
      <input id="demo-access-email" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="you@yourbusiness.com">
      <button type="submit" class="button full-width">Email me a sign-in link <span aria-hidden="true">→</span></button>
    </form>
    <p class="demo-access-status" role="status" aria-live="polite"></p>
    <p class="demo-access-fine">We’ll create your demo account when you verify your email. Existing account? The same link signs you in. No marketing subscription. <a href="/privacy.html">Privacy details</a>.</p>
    <a class="text-link" href="/#demo">Just browsing? Try the quick preview →</a>
    <p class="demo-access-help">Need a hand? <a href="mailto:Jordan.wong1177@gmail.com">Contact Jordan</a>.</p>`;
  document.body.append(dialog);
  dialog.querySelector(".demo-access-close").addEventListener("click", () => dialog.close());
  const form = dialog.querySelector("form"), status = dialog.querySelector('[role="status"]'), button = form.querySelector("button");
  let waiting = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (waiting || !form.reportValidity()) return;
    waiting = true; button.disabled = true; button.setAttribute("aria-busy", "true");
    status.textContent = "Sending your secure sign-in link…";
    try {
      const response = await fetch(origin + "/auth/v1/otp?redirect_to=" + encodeURIComponent("https://calvren.netlify.app/try-demo.html"), {
        method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.querySelector("input").value.trim(), create_user: true,
          data: { signup_source: "calvren-lead-demo" },
          gotrue_meta_security: {},
          // Supabase requires this redirect origin in Authentication → URL Configuration.
        }),
        signal: AbortSignal.timeout(15000)
      });
      // The redirect is passed as a query parameter by Supabase's Auth REST API.
      if (!response.ok) throw new Error(response.status === 429 ?
        "Please wait a minute before requesting another link." :
        "We couldn’t send your sign-in link. Please try again or contact Jordan for demo access.");
      status.textContent = "Check your inbox (and spam folder). Open the link to verify your email and unlock the demo. You can close this window.";
    } catch (error) {
      status.textContent = error.name === "TimeoutError" || error.name === "TypeError" ?
        "The connection timed out. Please try again." : error.message;
    } finally { waiting = false; button.disabled = false; button.removeAttribute("aria-busy"); }
  });
  return dialog;
}
let dialog;
export async function openDemoAccess() {
  if (await verifiedDemoSession()) { location.assign("/lead-demo.html"); return; }
  dialog ||= makeDialog();
  if (!dialog.open) dialog.showModal();
}
export async function requireDemoAccount() {
  const session = await verifiedDemoSession();
  if (!session) {
    location.replace(signupPath);
    await new Promise(() => {});
  }
  const remaining = session.expires_at - Date.now();
  setTimeout(() => location.replace(signupPath), Math.max(0, remaining));
  return session;
}
export async function signOutDemo() {
  const session = await verifiedDemoSession();
  sessionStorage.removeItem(sessionKey);
  if (session) await fetch(origin + "/auth/v1/logout?scope=local", {
    method: "POST", headers: { apikey: publishableKey, Authorization: "Bearer " + session.access_token },
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
  location.replace(signupPath);
}
document.querySelectorAll("[data-demo-access]").forEach(link => link.addEventListener("click", event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); openDemoAccess();
}));
if (document.body.dataset.demoSignup === "true") {
  try {
    if (await receiveEmailLink() || await verifiedDemoSession()) location.replace("/lead-demo.html");
    else await openDemoAccess();
  } catch (error) {
    await openDemoAccess();
    dialog.querySelector('[role="status"]').textContent = error.message;
  }
}
