# Calvren owner guide — current production

Website: https://calvren.ca
Private sales inbox: https://calvren.ca/admin.html
Client operator workspace: https://calvren.ca/operator.html
Supabase project: xjfsukhfmkgvlfpgjevg
GitHub repository: jordanwong1188-star/calvren

## Current services
- Cloudflare Pages: production website and same-origin API proxy.
- Supabase: tenant-isolated records, authentication, backend Edge Function and private operational reporting.
- Stripe: Starter C$275, Growth C$499, Pro C$775 per month, with C$349 one-time setup (before applicable tax).
- Formspree: backup receipt path when Calvren intake is unavailable, and browser no-JavaScript fallback.
- Resend: acknowledgement and owner notification only when verified sender credentials are configured.
- Supabase pg_cron + signed Edge Function dispatch: automatic five-minute follow-ups and daily Growth/Pro work. Actual backend runs are recorded privately.
- GitHub Actions: code checks, deployment, public backend availability monitoring, and optional manual fallback runs. Duplicate scheduled customer-sending jobs were disabled.

## Daily owner routine
1. Use /admin.html with the separate CALVREN_ADMIN_TOKEN. Review new enquiries and callbacks due.
2. Review the service operations counts. A failed/unknown send is not safe to retry automatically. Investigate in /operator.html and the provider.
3. Check Formspree backup receipts after backend outages and reconcile genuine submissions into the private inbox with permission.
4. Open the owner operations panel to see the last *actual* follow-up and Growth/Pro runs. Supabase's native scheduler is the source of truth. GitHub's two customer-sending workflows are manual fallbacks; they require CALVREN_CRON_TOKEN to be configured before manual use.
5. Check scheduled GitHub public API monitoring and make sure Actions failure notifications are enabled. Private delivery checks in GitHub require the optional secret; without it, the job reports only public reachability.
6. Check Stripe exceptions and provider usage privately. Avoid publishing payment data, API keys or client records in code and logs.

## Customer activation
1. Customer creates an account and pays securely using Stripe. A success redirect alone is not payment proof.
2. Customer completes private onboarding and reviews the proposed workflow.
3. Owner verifies tools, permissions, usage costs and human-handoff requirements.
4. Owner builds and tests with authorized data, confirms consent and client-specific integrations, and obtains final client approval.
5. Only mark the onboarding record live after the actual workflow is active and tested. Client dashboard distinguishes plan payment from live automation.
6. For Growth and Pro, only turn on approved modules with appropriate authorization. Review human handoffs promptly.

## Support
Current verified contacts: calvrenautomation@gmail.com and 236-988-8283. Do not claim support@calvren.ca is active until configured and tested. Do not promise fixed response times, savings, or provider availability without a signed agreement.

## Changes and validation
Run npm run check, npm run build:cloudflare and npm run build:supabase. Production Cloudflare and Supabase deployments must use matching source. Run live read-only billing and API security checks. Keep the Formspree backup, onboarding and support routes working. Do not claim tests passed until the actual results have been inspected.
