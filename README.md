# Calvren

A professional pitch website for real estate, local services and professional firms, with an interactive browser workflow preview and a protected AI lead inbox.

Calvren is a working brand name. Wider web, domain and trademark availability have not been verified.

## What is included

- Responsive forest green and ivory website with an editorial serif heading style.
- Three editable examples: property viewing, local service quote and professional consultation.
- Browser preview: example rules, lead summary, missing details, reply draft and proposed next action. Inputs stay local. Outputs can be copied or downloaded.
- Time calculator that labels its output as an estimate of current effort, not a promised saving.
- Netlify enquiry form with consent and honeypot, success page, privacy page and custom 404.
- Private /admin.html UI and protected API: generate an AI summary, category, priority, reply draft and next action; save records in Netlify Blobs; mark reviewed or archive.
- No messages are sent, appointments booked or external CRM records written. Those integrations require a separate implementation.

## Existing Netlify project

- Project dashboard: https://app.netlify.com/projects/calvren
- Site ID: 9357eb4a-405e-417e-af9a-f5998d88f2ba
- Live website: https://calvren.netlify.app
- Forms have been enabled.
- Set CALVREN_DATA_ENV=production in Netlify's production context only, and verify it appears in the saved environment variables.
- Public visitor access is configured for the Calvren site only. The protected lead API is separately token authenticated.

The website is live at https://calvren.netlify.app . GitHub is linked to Netlify and automatic deployments are enabled. Netlify recognised the enquiry form and deployed the protected workflow function. Live AI still requires the environment variables described below.

## Deploy

1. Source repository: https://github.com/jordanwong1188-star/calvren. The website and protected workflow are committed together on main.
2. GitHub is connected to Netlify. Pushes to main trigger automatic builds and deployments.
3. Check GitHub Actions for build and published-site browser check results: https://github.com/jordanwong1188-star/calvren/actions.
4. Build settings are supplied in netlify.toml: command npm run build, publish directory public, functions directory netlify/functions, Node 22.
5. Add the environment variables below directly in Netlify. The public example does not need an AI key. Choose the production context; use the platform's default scopes if your plan does not support individual function scopes.
6. After changing runtime credentials, redeploy the site from Netlify's Deploys page so the function receives the new values.
7. Public visitor access is already configured for Calvren. Verify the deployed pitch pages open for visitors and that unauthenticated lead API requests are rejected.

## Function environment variables

- CALVREN_ADMIN_TOKEN: a random secret of at least 32 characters with no spaces. Scope to functions and use distinct values for production and previews. Do not commit it or put it in frontend code.
- OPENAI_API_KEY: your API key, configured in Netlify with functions scope. Add it directly in Netlify rather than posting it into a document or chat.
- OPENAI_MODEL: optional; defaults to gpt-4o-mini. Choose a model that supports chat completions and strict JSON-schema responses.
- CALVREN_DATA_ENV: value production in the production context only. Leave unset in dev, branch deploys and deploy previews. This enables persistent production storage and isolates other contexts in deploy-scoped storage.

Generate the admin token locally using Node:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

The backend will fail closed if its access token or AI credentials are missing. Provider failure does not silently become template output.

## Local development

Install Node 22, then:

    npm install
    npm run check
    npm run dev

Use netlify dev. Link the project with netlify link when using Netlify features. Local environment values may go in a gitignored .env file. Never set CALVREN_DATA_ENV=production in local development or previews.

## Protected API

Use Authorization: Bearer <CALVREN_ADMIN_TOKEN> for every endpoint.

POST /api/workflow with Content-Type: application/json:

    {
      "name": "Jamie Smith",
      "email": "jamie@example.com",
      "businessType": "real-estate",
      "enquiry": "Could we arrange a viewing of the two-bedroom property this weekend?"
    }

Response: 201 { "lead": ... }.

GET /api/leads returns { "leads": [...], "limit": 100 }.

PATCH /api/leads/:id with { "status": "approved" } or { "status": "archived" } returns the updated record. Approved means reviewed; it does not mean sent.

Trusted intake tools can call this API server to server. Never embed its token in a public form or client-side integration.

## Verification performed during preparation

- Nine behavioral cases for the browser example passed in the JavaScript execution environment, including buyer/seller routing, ambiguous requests, confidential-document wording, urgency negation, no invented names and input bounds.
- JavaScript syntax, local HTML link targets and script element references passed. Mocked admin behavior checks confirmed form handling after asynchronous requests and memory-only token use. Production/preview storage selection was also checked.
- Nineteen mocked backend behavior checks passed in a JavaScript adaptation prepared by the backend agent, covering authentication, body validation, AI errors, persistence, review updates and preview isolation.
- The source includes Node tests for the browser engine and a TypeScript build check.

Installed dependency resolution, full TypeScript compilation, JavaScript syntax checks and all nine browser-engine tests passed in GitHub Actions: https://github.com/jordanwong1188-star/calvren/actions/runs/36841456997 . The production deployment is published. Chromium browser checks passed against the live site, including desktop/mobile layout at 320/375/768/1440px, all demo scenarios, stale output clearing, clipboard copy, downloaded JSON records, calculator updates, form failure data preservation, public pages/assets, 404 handling, and rejection by the protected APIs. Browser check run: https://github.com/jordanwong1188-star/calvren/actions/runs/36843989060 . Netlify recognised the contact form; no real enquiry was submitted during the browser check. Live OpenAI execution remains unverified because credentials are not configured.

## Starter-system limits

This is a single-business prototype, not a multi-tenant platform. Inbox listing reads up to 100 records and sorts those records by creation date; it does not guarantee the newest 100 across a larger store. Simultaneous status changes use the Blobs last-write-wins behavior. Archived records remain stored; deleting or exporting records and broader workflow connectors require additional work.

AI output is untrusted draft content and needs human review. Do not interpret a recommendation as an action that has already happened.
