# Public form email notifications

Calvren's **current website is Cloudflare Pages**, and public forms are saved in private Supabase storage before notification. Notifications cover:
- Homepage form (`workflow-enquiry`)
- Contact page form (`project-enquiry`)
- Case-study feedback form (`client-insight`)

Each **new**, accepted submission sends one transactional email through Resend. The recipient defaults to `jordan.wong1177@gmail.com` and may be overridden privately through `CALVREN_LEAD_NOTIFICATION_EMAIL`. The browser cannot choose this recipient. No automated customer reply or AI request is triggered.

## Required one-time sender setup

1. Create/sign into your Resend account at https://resend.com. Add a sender domain **you control** in Resend → Domains, add its required DNS records in your DNS provider and wait for Resend to mark it verified. A Gmail address is the **recipient**, not an appropriate Resend sender domain.
2. In Resend → API Keys, create a key with *sending* permission. Store it only in **Supabase → project xjfsukhfmkgvlfpgjevg → Edge Functions → Secrets**, not in GitHub, Cloudflare public variables, browser code, or chat.
3. Configure these Edge Function secrets:
   - `RESEND_API_KEY` = the secret API key from Resend
   - `NOTIFICATION_FROM_EMAIL` = a mailbox on the verified sender domain, for example `notifications@your-owned-domain.com`
   - `CALVREN_LEAD_NOTIFICATION_EMAIL` = `jordan.wong1177@gmail.com` (optional because this is the safe default; explicitly setting it is recommended)
4. Supabase functions can read newly saved secrets without redeployment. The app code still must be deployed to Supabase from GitHub `main`. The GitHub workflow **Publish Calvren backend** deploys after **Check Calvren** succeeds, provided the repository's `SUPABASE_ACCESS_TOKEN` GitHub Actions secret is present.
5. On https://calvren.pages.dev/contact.html submit a clearly labeled **TEST ENQUIRY** with consent checked. Check your Gmail inbox, Promotions and Spam. An accepted Resend API request means email was accepted, not necessarily delivered.

## Troubleshooting / proof

- The form always writes to `calvren_private_records` (keys `leads/<uuid>` or `feedback/<uuid>`) **before** trying email.
- In **Supabase → Edge Functions → calvren → Logs**, find `calvren_public_form_saved`. Its `notification` field is:
  - `accepted`: Resend returned success; check its email logs and Gmail for delivered/bounced status
  - `unavailable`: missing API key, sender, or usable recipient
  - `failed`: Resend rejected the request or it timed out; review Resend's logs and verified sender domain
  - `duplicate`: this same submission key was processed earlier; deliberately does not send a duplicate message
- A mail failure never deletes a lead. Review saved enquiries in the private `/admin.html` inbox and private feedback through `/api/feedback` (operator auth required).
- If a visitor is redirected to the thank-you page, the save succeeded; that is not a guarantee a notification was delivered.
- Never put Resend credentials in browser code or respond publicly with provider errors.
