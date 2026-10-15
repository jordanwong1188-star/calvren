# Public form notifications — Formspree

Calvren's canonical production site is **https://calvren.pages.dev**.

All three public forms submit to the Formspree endpoint supplied by the owner:

`https://formspree.io/f/xrperqkk`

- Homepage workflow enquiry (`workflow-enquiry`)
- Contact-page project enquiry (`project-enquiry`)
- Case-study client feedback (`client-insight`)

The live website sends to Formspree first. **Only when Formspree responds successfully** does the visitor see Calvren's usual thank-you page. The page also attempts a secondary private copy through Cloudflare Pages → Supabase; private-copy failure does not make an email notification fail. Supabase remains the private operator inbox where available. No user-supplied API keys are exposed in the site.

## Owner setup — required for notifications

1. Log in to [Formspree](https://formspree.io) and select the form with endpoint `xrperqkk`.
2. Check the form's **target/notification email** is **calvrenautomation@gmail.com**. Verify the address if prompted.
3. Check the form's Workflow/Notifications settings so an email notification is actually enabled. A successfully stored Formspree submission does not, on its own, prove that Gmail delivered a notification.
4. Test at [the live contact form](https://calvren.pages.dev/contact.html) with a fresh, consented test enquiry.
5. Confirm the record in **Formspree → Submissions**, then check Gmail's Inbox, Promotions and Spam. If stored but no email arrives, inspect Formspree notification settings and spam filtering.
6. For company-domain restrictions, use the canonical `https://calvren.pages.dev` domain as an allowed origin if the Formspree form is configured to restrict domains.

The Resend sender-domain setup is **not required for website enquiry notifications** after this change. It remains a separate integration for client-conversion notifications and optional promotional demo emails.

## Technical behavior

- Native HTML fallback: the form has a real external `action` and `method="POST"`; with JavaScript disabled, the visitor sees Formspree's own completion flow.
- JavaScript path: `shared.js` sends `FormData` with `Accept: application/json`; on success it attempts a secondary URL-encoded submission to Supabase and navigates to `/thanks.html` (or `/review-thanks.html` for feedback).
- The Formspree form includes a fixed `subject`, the customer `email` as the reply-to address, and the `_gotcha` honeypot. When the separately saved Supabase backup succeeds, Calvren attempts one personalised transactional receipt to the visitor through a verified Resend sender. Formspree still handles the operator alert. If Resend/backup storage is unavailable, the visitor sees the on-page acknowledgement but no email is promised.
- Backup records are marked as already delivered through Formspree, so Supabase does **not** send a second Resend notification for them. Direct legacy submissions to Supabase (not sent through Formspree) still use the separate Resend configuration if present.
- Rate limits, spam classification and provider outages are controlled by the vendors. Formspree returns errors such as HTTP 429; visitors see a retry/contact message rather than a misleading thank-you page.
- The site privacy page discloses Formspree processing and the separate Supabase copy.

**Do not test by posting actual customer details through developer tools or automated suites.** The browser regression suite intercepts the Formspree endpoint and never sends messages to the owner's mailbox.

### Transactional customer acknowledgements
- An enquiry gets “We've received your enquiry | Calvren,” including the contact's first name, business when supplied, and realistic next steps. Feedback receives a private acknowledgement with no publication claim.
- Email sending is protected by the existing website rate limits, durable `onlyIfNew` persistence and a stable provider idempotency key; duplicates should not produce a second customer receipt.
- Resend requires `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` for an authenticated, verified sender domain. Customer receipts use `Reply-To: calvrenautomation@gmail.com`.
- This applies to the normal JavaScript form flow. If JavaScript is disabled, the direct Formspree fallback requires separately configured autoresponder rules; avoid sending duplicate emails when both systems are configured.
- New client login and signup confirmations are sent by Supabase Auth, not this backend; refer to [customer email templates](customer-email-templates.md) and configure the Auth template in the Supabase dashboard.
