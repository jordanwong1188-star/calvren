# Calvren

For the Cloudflare Pages + Supabase hosting migration and GitHub publishing, follow [docs/cloudflare-setup.md](docs/cloudflare-setup.md). The original Netlify setup command is retained for existing Netlify deployments.

Calvren now includes a reusable Lead Conversion MVP alongside the existing marketing site. Run the guided owner setup with `npm install` then `npm run setup`. It collects credentials privately, generates an operator token, configures the existing Netlify site and deploys the build. Read [the quick setup guide](docs/setup-now.md) and [the complete demo and customer onboarding guide](docs/lead-conversion-mvp.md).

- Full conversation demo: `/lead-demo.html` (credential-free simulation)
- Client/lead operator workspace: `/operator.html` (protected; Supabase required for persistence)


A live B2B AI automation website and single-owner enquiry workspace for Jordan Wong.

- Website: https://calvren.netlify.app
- Case studies and client feedback: https://calvren.netlify.app/case-studies
- Contact: https://calvren.netlify.app/contact
- Private owner workspace: https://calvren.netlify.app/admin.html
- Netlify: https://app.netlify.com/projects/calvren
- Repository: https://github.com/jordanwong1188-star/calvren

## Operating the business

Start with [the owner guide](docs/owner-guide.md), including activation, controlled smoke tests, enquiry handling, notifications and data deletion. Use [the onboarding and proposal template](docs/client-onboarding.md) to scope customer pilots.

The public website is accessible without a login. Its three forms are registered with Netlify. The public interactive example uses labelled browser rules and templates; it does not call an AI provider.

Production AI preparation requires `CALVREN_ADMIN_TOKEN`, `OPENAI_API_KEY` and `CALVREN_DATA_ENV=production` in Netlify's Production context, then a redeploy. An API key's presence alone does not verify provider billing or permissions. The private Service status panel reports configuration without exposing secret values.

## Enquiry workflow

Netlify retains original form submissions. Its verified `submission-created` event copies eligible `workflow-enquiry` and `project-enquiry` submissions into the private inbox; reviews and honeypot submissions are excluded. Production intake requires production storage configuration.

Records are saved before AI generation. A failed provider request leaves a retryable enquiry. The inbox supports searching/filtering, reviewed/archived states, manual email-draft handoff, JSON exports and permanent deletion. Original Netlify Forms submissions remain separate copies.

The workflow prepares a draft; generation and review do not send messages, book appointments or update an external CRM. Customer integrations require a scoped implementation and their authorised accounts. This is a single-owner workspace, not a shared multi-client portal.

## Runtime configuration

- `CALVREN_ADMIN_TOKEN`: unique random secret, 32–1024 characters, no spaces.
- `OPENAI_API_KEY`: a funded OpenAI API key.
- `OPENAI_MODEL`: optional, defaults to `gpt-4o-mini`; must support strict JSON-schema Chat Completions.
- `CALVREN_DATA_ENV`: `production` only in the Production environment. The runtime deployment context must also be production for persistent storage.

Keep secrets out of GitHub, public JavaScript and chat. Add them directly in Netlify with Functions scope or the default scopes where individual scopes are unavailable. Redeploy after changing values.

## Protected API

All endpoints require `Authorization: Bearer <CALVREN_ADMIN_TOKEN>`.

- `GET /api/status`: configuration booleans, environment and model.
- `POST /api/workflow`: JSON name, email, businessType and enquiry; saves first, then prepares an AI draft.
- `GET /api/leads`: up to 100 records.
- `POST /api/leads/:id/draft`: prepare/retry a record without a draft.
- `PATCH /api/leads/:id`: approved or archived status; review requires a draft.
- `DELETE /api/leads/:id`: permanent inbox deletion.

Provider failures return the retained record with a safe processing note. Archived records remain stored until deleted. Exports cover loaded inbox records only; check Netlify Forms separately for original submissions.

## Build and verification

Use Node 22.13 or newer:

    npm install
    npm run check
    npm run dev

Use Netlify Dev for platform features. The guided setup keeps credentials in ignored private `.env` files and configures hosted Production variables. Local development and deploy previews cannot run the new live client providers; use a demo client for local tests.

Build settings are in netlify.toml. Automatic publication requires linking this repository to the existing Netlify project on branch `main`; it has not been verified. The guided setup can publish directly through your authenticated Netlify CLI session. [GitHub Actions](https://github.com/jordanwong1188-star/calvren/actions) checks TypeScript, JavaScript syntax, browser-demo behavior, backend behavior and the published website. Live browser tests use mocked form success/failure paths, so ordinary checks do not create real enquiries.

Production OpenAI execution and notification delivery must be verified with the controlled smoke tests in the owner guide after account configuration. No fabricated customer reviews or performance results are published.

Calvren remains a working brand name; wider domain and trademark availability have not been verified.
