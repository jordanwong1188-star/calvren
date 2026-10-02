# Calvren owner guide

Owner: Jordan Wong  
Website: https://calvren.netlify.app  
Private workspace: https://calvren.netlify.app/admin.html  
Website submissions: https://app.netlify.com/projects/calvren/forms  
Contact: Jordan.wong1177@gmail.com · 236-988-8283

## Activate the AI service

The public website and its contact forms work without an AI key. AI preparation and permanent private inbox storage require production setup.

1. In [Netlify environment settings](https://app.netlify.com/projects/calvren/configuration/env), add:
   - `CALVREN_ADMIN_TOKEN`: a unique password-manager-generated token of at least 32 characters, with no spaces. Save it privately.
   - `OPENAI_API_KEY`: your OpenAI API key with API billing enabled.
   - `CALVREN_DATA_ENV`: `production`.
2. Choose the Production context. Use Functions scope, or the platform's default scopes if individual scopes are unavailable. Keep production credentials and the production storage marker out of deploy previews and local development.
3. Redeploy from [Netlify Deploys](https://app.netlify.com/projects/calvren/deploys) after changing environment values.
4. Open the private workspace and connect with your access token. Its Service status panel should show the API key configured, persistent storage configured and website intake available.
5. Add a clearly marked synthetic enquiry using your own email address. Confirm a summary and reply draft appear, mark it reviewed, export it, then delete the test inbox record.
6. Submit one clearly marked test from the public contact page, using your own email address and no client information. Confirm it appears in Netlify Forms and the private inbox. Check its draft, then delete the test record in both places.

The token stays in page memory; reconnect after refreshing. Do not give this owner token to prospects or customers. Each customer's connected workflow needs its own agreed access arrangements.

The optional `OPENAI_MODEL` defaults to `gpt-4o-mini`. Choose a model supporting Chat Completions and strict JSON-schema output if changing it.

## How enquiries move through the system

1. A prospect submits the homepage or contact-page form, with contact consent.
2. Netlify Forms retains the original submission and applies its form handling and honeypot checks.
3. Netlify's verified submission event copies eligible sales enquiries into the private production inbox. Client feedback is excluded.
4. The enquiry is saved before AI preparation. The provider receives the contact name, company if supplied, business type and enquiry; the email address is excluded from the AI prompt.
5. AI prepares a summary, category, priority, reply draft and proposed next action.
6. You review the original enquiry and the output, then decide how to respond.

If AI is unavailable, the private enquiry remains available with a processing note and retry button. Original public submissions remain in Netlify Forms. Provider failure never becomes a template disguised as AI output.

During activation, check Netlify Forms as the source of truth. Submissions made before production storage was enabled are retained there but are not automatically backfilled into the new inbox; add them manually with the submitter's permission when appropriate.

## Turn on owner notifications

Website submissions are saved in Netlify Forms. This does not establish that email notifications are configured.

In Netlify, open the forms notification settings and add an email notification for `workflow-enquiry`, `project-enquiry` and, if wanted, `client-insight`, addressed to Jordan.wong1177@gmail.com. Verify delivery with your controlled test submission.

Until notification delivery is verified, check both Netlify Forms and the private workspace daily. Do not assume a lack of notification means there were no enquiries.

## Daily enquiry handling

- Search the inbox or filter by Needs a draft, Awaiting review, Reviewed or Archived.
- For each enquiry, verify the original message, name, category, priority and missing details.
- Check drafts for unsupported claims, prices, availability, guarantees and requests outside the agreed service.
- Use Prepare / retry draft for records without a draft when the provider is ready.
- Mark a suitable draft reviewed. Open email draft hands it to your email application so you can edit the recipient, subject and wording, then send it yourself.
- Copy draft also supports replying through another channel. Nothing is sent by generation or review.
- Record the sales stage in your normal business tracker: discovery, proposal, won or lost. This inbox is an intake and drafting workspace, not a full sales CRM.

## Offer a focused first workflow

Start with one repeatable task: property enquiry handling, quote-request preparation or professional client intake. Use the live website's example to explain the input, prepared output and human decision.

Agree the scope before building:

- Current steps and who owns the process.
- Existing tools and authorised accounts.
- Typical volume and manual time per task.
- Allowed information and a synthetic sample.
- Which action is prepared and which action a person approves.
- The measure used to judge the pilot, including the starting point and evaluation period.
- Failure handling, access, retention, handover and support.

Use [the client onboarding template](client-onboarding.md) for a discovery call and written proposal. Agree fees and delivery dates with the customer; the website does not promise fixed savings or a fixed delivery time.

## Delivery and handover

1. Map the selected task and the tools involved.
2. Build with synthetic inputs first.
3. Test normal, missing-information, duplicate, provider-failure and human-review cases.
4. Connect only the customer accounts and actions included in the agreement.
5. Run a limited pilot using authorised data.
6. Compare the agreed measures with the baseline.
7. Hand over access, instructions, error handling and the agreed support arrangement.

Client email, calendar and CRM integrations require the customer's accounts and a scoped implementation. This workspace does not automatically send, book or update an external CRM. It is a single-owner workspace; do not share one token or one data store across unrelated client accounts.

## Data and maintenance

Export a record or all currently loaded records to JSON when needed. The inbox reads up to 100 stored records and sorts the loaded set by date. With a larger queue, this view does not guarantee the newest 100; check Netlify Forms and arrange pagination before relying on a larger inbox. An export covers loaded records only.

Archive keeps a record stored. Delete permanently removes it from the private inbox. Website enquiries also have an original Netlify Forms copy, which must be removed there when a deletion request or retention policy requires it.

Keep exports on a trusted device. Set a retention period appropriate to each agreed business purpose. Rotate the owner token or provider key in Netlify if needed and redeploy; verify the private workspace again afterward.

Review Netlify usage and OpenAI billing regularly. Check deployment/build results after code changes and use the public contact page as a fallback while investigating an outage.

## Customer stories

The current case studies are illustrative walkthroughs. Genuine feedback enters the separate `client-insight` form. Verify the company, wording, result measure and optional publication permission before publishing. Keep reviewer emails private.
