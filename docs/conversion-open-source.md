# Calvren conversion improvements — free/open-source choices

Goal: help a new AI-automation business turn more relevant visitors into genuine audit requests before paying for marketing infrastructure.

## Applied in the website

- **High-intent CTA accent:** `#B94F30` (terracotta), alongside existing green `#183B31` and beige `#F6F5EE`. Contrast: accent vs beige 4.55:1; cream `#FFFAF3` text vs accent 4.79:1. Orange/terracotta is **not** scientifically guaranteed to convert better; distinguishability, clear text, accessibility and testing matter.
- **One direct primary action:** homepage hero and desktop header lead to the existing contact form, not a collapsed homepage section. The demo remains a secondary action and pricing is unchanged.
- **Privacy-safe attribution:** the contact form includes `cta_source=hero` or `header` when an allowed query parameter is present. It is carried in the existing Formspree submission, not a new tracker, cookie or database.
- **Accessibility and functional regression testing:** `tests/cro-accessibility-check.mjs` runs a journey check and a report-only `@axe-core/playwright` scan in GitHub Actions. Initial scan is informational so existing unrelated accessibility problems do not halt deployment.

## Repositories evaluated

| Repository | Licence / cost consideration | Decision |
| --- | --- | --- |
| [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm) | MPL-2.0, free open-source testing package | **Integrated in GitHub Actions**, not served to visitors |
| [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) | Apache-2.0, free source; consumes test runner resources | Candidate for later page-speed regression monitoring |
| [umami-software/umami](https://github.com/umami-software/umami) | MIT, free to self-host; requires a running service and database | **Deferred** until hosting/account setup is agreed |
| [PostHog/posthog](https://github.com/PostHog/posthog) | Mixed/open-core licensing, free allowances vary; external analytics | **Deferred** to avoid a new hosted service or trackers |
| [growthbook/growthbook](https://github.com/growthbook/growthbook) | Open core; check current terms for any commercial rollout | **Deferred** until there is enough traffic for credible A/B tests |
| [plausible/analytics](https://github.com/plausible/analytics) | AGPL-3.0; self-hosting takes infrastructure, hosted service may cost | **Deferred** |

## How to judge success

- Primary conversion: **completed free-audit enquiry / relevant website visits** (requires visit analytics to calculate; this release only records CTA source on *submitted* forms).
- Secondary conversions: demo opens; qualified audit requests; calls booked after manual review; paid clients.
- Formspree submissions can show `cta_source` for requests coming from the primary CTA. This does not count all CTA clicks or unique visitors.
- Review the source of submitted requests, ask prospects what motivated them, and make adjustments after real data. Do not claim a conversion uplift without a baseline and a credible test.

## Release notes and boundaries

- The existing Formspree form endpoint, Supabase backend, Stripe checkout and pricing remain unchanged.
- No new paid APIs, analytics accounts, servers or tracking cookies were introduced.
- Merging into GitHub `main` invokes Cloudflare Pages auto-deploy only **if the repository is correctly connected in Cloudflare**. Confirm successful production deployment and the custom domain in Cloudflare; GitHub commits alone do not prove public availability.
- Before using social proof in sales, verify that all client stories describe genuine experiences with permission. This release neither adds nor invents testimonials.
