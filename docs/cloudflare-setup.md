# Calvren: free hosting migration

Architecture: Cloudflare Pages publishes the existing public website from GitHub. Its lightweight API proxy forwards to the existing Calvren Supabase project. Supabase Edge Functions run the reusable automation and private inbox. The same clients, conversion leads, messages and appointments stay in the same database. New marketing enquiries and client reviews use private Supabase storage; older Netlify Forms/Blobs records remain on Netlify and are not deleted or automatically imported.

## One-time account actions
These steps require the owner's provider login. Do not put passwords or secret keys in GitHub source or chat.

1. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git/GitHub. Authorize only jordanwong1188-star/calvren, select main. Choose an available project name.
2. Framework preset: None. Build command: npm run build:cloudflare. Output directory: public. Root directory: leave blank. Add NODE_VERSION=22. Use the Free plan.
3. Pages routes to https://xjfsukhfmkgvlfpgjevg.supabase.co/functions/v1/calvren by default. Optionally set CALVREN_BACKEND_URL to that exact URL. Once the Pages origin is known, set CALVREN_SITE_URL to it in Cloudflare build variables and redeploy so canonical URLs point to the new website. Cloudflare does not need OpenAI, Twilio, Google, Supabase privileged keys or operator credentials.
4. Supabase Dashboard → Edge Functions → Secrets. Copy server settings from Netlify:
   CALVREN_ADMIN_TOKEN, OPENAI_API_KEY, OPENAI_MODEL, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, RESEND_API_KEY, NOTIFICATION_FROM_EMAIL when available.
   Set CALVREN_PUBLIC_URL to your actual production Pages/custom-domain origin. Keep CALVREN_AUTOMATION_MODE=demo until end-to-end live testing passes.
   Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically; do not move them into frontend settings.
5. Supabase Authentication → URL Configuration: Site URL = new production website origin. Add its exact /try-demo.html return URL. Keep email confirmation enabled and configure custom SMTP to deliver sign-in emails to customers.
6. For automatic backend updates: Supabase Account → Access Tokens → create an access token. GitHub repository → Settings → Secrets and variables → Actions → New repository secret: SUPABASE_ACCESS_TOKEN. This credential belongs only in GitHub Actions. The backend publishes after Check Calvren succeeds for a push to main; fork pull requests cannot trigger privileged publishing. Initial database migration is applied during this migration; future schema changes need their own reviewed migration.
7. For automatic follow-ups: generate a random 32+ character CALVREN_CRON_TOKEN. Save the same value in Supabase Edge Function Secrets AND GitHub Actions secrets. GitHub's Calvren follow-up scheduler calls the backend approximately every five minutes and processes one due lead per pass. Scheduled GitHub Actions can be delayed and may disable themselves after prolonged repository inactivity; this is a first-client MVP schedule, not an exact-time guarantee.
8. If using real SMS later: change the Twilio number's inbound webhook to the new website /api/conversion/twilio/inbound. The configured business phone_number must match its assigned Twilio number. Test signed incoming SMS, confirmations and STOP after completing all live provider credentials.

## Test before inviting customers
- Main website, contact/review forms, public quick preview and mobile navigation.
- New marketing enquiry appears in /admin; prepare/review a fake draft and test archive/export.
- /operator requires your token and still shows existing clients/conversations.
- Create a new server demo lead, answer the questions, choose a simulated time and inspect booked notification.
- /try-demo creates a verified email account; direct signed-out /lead-demo returns to signup; sign-out removes access.
- Run the GitHub scheduler manually with a demo client and verify due follow-up history.
- Client feedback remains private in calvren_private_records (feedback/ keys); authenticated operator GET /api/feedback can retrieve it. It is never automatically published.
- Verify real provider delivery separately before changing CALVREN_AUTOMATION_MODE.

## Costs and limits
Cloudflare Pages and Supabase have free allowances. Pages Functions, Supabase function calls, database/storage, GitHub Actions schedules and email senders have limits; they are not unlimited capacity. Public marketing submissions do not automatically call OpenAI. OpenAI and real Twilio messages still have separate usage costs.
Use branch previews for review and merge complete changes to main for production publishing. GitHub remains the source of truth.

## Existing data
Conversion data is unchanged in Supabase. Historical Netlify Forms and Blobs data stays with Netlify. Export the old private inbox from /admin when Netlify is accessible; do not delete the old project before checking exports. No historical marketing records have been automatically copied during this migration.
