# Set up Calvren now

Use the owner setup wizard in GitHub Codespaces or on your computer. It connects the existing Netlify project, privately saves credentials, publishes the website and tests a simulated lead when Supabase is ready.

## Set up from a phone or tablet

You do not need to install Node.js on your phone. Use [Calvren's GitHub Codespaces workspace](https://codespaces.new/jordanwong1188-star/calvren).

1. Sign in to your GitHub account on GitHub's own page and choose **Create codespace** on the main branch.
2. Wait for the workspace to open and for the automatic package installation to finish. The repository's dev-container configuration supplies Node 22 and npm.
3. On mobile, use landscape mode or **Request Desktop Website** if the menus are difficult to access.
4. Open **☰ → Terminal → New Terminal** and run `npm run setup`.
5. When Netlify login prints an authorization link, open that link in another browser tab, sign in there and approve access, then return to the terminal. No localhost callback is required.
6. Enter API keys only in the wizard's hidden prompts. Blank answers skip an integration so the public demonstration can be published first.

Keep passwords on the providers' own sign-in pages. The private `.env` is saved in your Codespace and ignored by Git. Download the Google service-account JSON outside the project directory, as required by the wizard. Stop the Codespace from GitHub's Codespaces page when you finish.

## Set up from a computer

Install Node 22.13 or newer and Git, then run:

~~~bash
git clone https://github.com/jordanwong1188-star/calvren.git
cd calvren
npm install
npm run setup
~~~

If you already have the project, update it from GitHub before running setup. The wizard handles Netlify login and site linking. Complete the browser login it opens. No Netlify deployment token needs to be pasted into chat or committed.

Blank answers skip an integration. The public lead demonstration can publish immediately with no provider accounts. Rerun the same command after obtaining more credentials; existing local values are reused.

## What you enter

The wizard displays the provider links and asks only for missing configuration:

| Provider | Owner steps | Values |
| --- | --- | --- |
| Supabase | Create a dedicated Calvren project. Open its SQL Editor and run supabase/migrations/202610030001_calvren_conversion.sql. | Project HTTPS URL and secret key (sb_secret_… or legacy service-role key) |
| OpenAI | Create an API key and enable API billing in your own account. | API key |
| Twilio | Set up an SMS-capable number and complete any required messaging registration. | Account SID, auth token, optional fallback phone |
| Google Calendar | Enable Calendar API; create a service account; download its JSON key outside this repository. Share each client's calendar with its email with permission to change events. | Local path to the JSON key |
| Resend | Verify a sending domain/email. Create an API key. | API key and verified sender email |

Client-specific calendar IDs and business SMS numbers belong in client configurations, rather than a global shared setting.

The wizard generates a random operator token if needed. Find it under CALVREN_ADMIN_TOKEN in your private local .env and use it at https://calvren.netlify.app/operator.html. It is not printed by the wizard.

## What setup does

1. Loads existing local .env, preserving unrelated values.
2. Collects missing credentials with hidden terminal input.
3. Writes .env atomically with private file permissions; it remains ignored by Git.
4. Checks the dedicated Supabase schema without changing the database.
5. Uses your local Netlify CLI login and the fixed existing Calvren project.
6. Uploads configured variables for Production, with Functions scope and secret marking where supported. If your plan explicitly rejects granular scopes, it reports use of the provider's default scopes. Keys stay in server environment configuration.
7. Builds and publishes the existing website.
8. Authenticates the published API and, when the database is ready, creates/reuses a reserved demo business and fake lead. It verifies qualification, simulated appointment, logged notification and saved conversation.

The setup test always uses mock providers, even if real credentials exist. It does not send real SMS/email or create a real calendar event. The wizard keeps first setup in demo mode and preserves an already-live deployment on reruns. It does not activate a new live business automatically.

Database migrations still run in your dedicated project's SQL Editor. The setup command checks whether the migration is present and gives the file to run if it is missing. API keys cannot create billed provider accounts, grant calendar access, verify an email domain, or complete SMS registration; those owner steps happen in the linked dashboards.

## Private credential handling

Run in an interactive terminal in your own GitHub Codespace or on your computer. Do not put keys in command arguments, public files, or this chat. The wizard does not use netlify env:import, because that command prints imported values and lacks scope controls.

Download the Google JSON outside the project. Only the account email and PEM private key are written to .env; the JSON is never copied into deployment sources. Do not enable Netlify's optional source archive upload. Ordinary deployment uploads public and bundled functions, and .env/.netlify are ignored by Git and excluded from the CLI's source archive ignore defaults.

Existing masked secret values in other deployment contexts are never copied through a replacement update. The wizard updates Production and preserves existing metadata when changing it would risk those values.

## Verify the installation without credentials

~~~bash
npm run setup -- --check
~~~

This checks the pinned CLI, its public owner-authentication export and project configuration offline. It does not read .env, prompt, log in, deploy or make network requests.

After publication, open https://calvren.netlify.app/lead-demo.html. Submit “Hi, my kitchen sink is leaking and I need someone to look at it”, answer the questions and choose an appointment.

For real client activation, follow [the complete MVP setup and onboarding guide](lead-conversion-mvp.md). Connect that customer's number/calendar, configure the webhook and intake key, test with explicit SMS consent, then enable live operation. Configuration-presence checks are not proof that provider credentials, billing or permissions work.
