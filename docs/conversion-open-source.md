# Calvren conversion improvements — free/open-source choices

Goal: help a new AI-automation business turn more relevant visitors into genuine audit requests before paying for marketing infrastructure.

## Applied in the website

- **High-intent CTA accent:** `#AD461F` (dark orange), alongside existing green `#183B31` and beige `#F6F5EE`. Contrast: cream `#FFFAF3` text vs accent 5.51:1. Orange/terracotta is **not** scientifically guaranteed to convert better; distinguishability, clear text, accessibility and testing matter.
- **One direct primary action:** homepage hero and desktop header lead to the existing contact form, not a collapsed homepage section. The demo remains a secondary action and pricing is unchanged.
- **Privacy-safe attribution:** the contact form includes `cta_source=hero` or `header` when an allowed query parameter is present. It is carried in the existing Formspree submission, not a new tracker, cookie or database.
- **Accessibility and functional regression testing:** `tests/cro-accessibility-check.mjs` runs a journey check and a report-only `@axe-core/playwright` scan in GitHub Actions. Initial scan is informational so existing unrelated accessibility problems do not halt deployment.

## Repositories evaluated

| Repository | Licence / cost consideration | Decision |
| --- | --- | --- |
| [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm) | MPL-2.0, free open-source testing package | **Integrated in GitHub Actions**, not served to visitors |
| [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) | Apache-2.0; free GitHub workflow runs for public repository | **Integrated in GitHub Actions**; local-only performance/SEO report artifacts, no tracking script |
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

- The existing Formspree form endpoint remains unchanged. The separate AI receptionist subscription is documented in `receptionist-subscription.md`.
- No new paid APIs, analytics accounts, servers or tracking cookies were introduced.
- Merging into GitHub `main` invokes Cloudflare Pages auto-deploy only **if the repository is correctly connected in Cloudflare**. Confirm successful production deployment and the custom domain in Cloudflare; GitHub commits alone do not prove public availability.
- Before using social proof in sales, verify that all client stories describe genuine experiences with permission. This release neither adds nor invents testimonials.


## Additional research — 17 November 2026

The first two tools below are now integrated as **informational GitHub Actions checks**; the remainder are recommendations, not installed integrations. Code can be free while infrastructure and usage can cost money. No repository by itself creates qualified traffic.

| Repository | Use for Calvren | Cost / implementation | Priority |
| --- | --- | --- | --- |
| [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) | Audits homepage, receptionist, contact for baseline mobile performance and SEO | **Installed**: `lighthouserc.json` and `.github/workflows/site-quality.yml`; saved 7-day Actions artifacts; first run must be reviewed | First |
| [lycheeverse/lychee](https://github.com/lycheeverse/lychee) | Find broken links in static site source | **Installed**: offline report-only `lychee-action@v2` in `.github/workflows/site-quality.yml`. Clean URLs rewritten by Cloudflare can produce false positives; live-site checks remain authoritative | First |
| [catamphetamine/libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) | Help clients enter usable Canadian/international callback numbers during onboarding | MIT; bundle locally; use possible-number feedback without rejecting valid formatting unnecessarily | Next UX improvement |
| [umami-software/umami](https://github.com/umami-software/umami) | Measure which campaigns send visits and completed enquiries | MIT source; needs a deployed analytics service/database or a hosted plan. Not currently connected | Highest marketing measurement value once hosting is chosen |
| [knadh/listmonk](https://github.com/knadh/listmonk) | Send newsletters to prospects who subscribe | AGPL-3.0; requires hosting, PostgreSQL and an email sender; sending may cost money. No campaigns or contact uploads made | Later, after an opted-in audience exists |

Primary sources: each repository README/LICENSE; Lighthouse CI configuration documentation at https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md . Existing axe-core tests and form `cta_source` capture remain installed. SEO metadata, social previews, structured data, robots and sitemap are website code, not an external SEO service. Search Console ownership/submission is not verified by these changes.

## Verification note

The quality workflow is a free source-code/reporting integration, **not** a new hosted analytics service or proof of SEO ranking. GitHub Actions results must be inspected before claiming a passing Lighthouse or Lychee run. The site already includes standard canonical URLs, descriptions, social previews, structured data, sitemap and robots. Google Search Console ownership and sitemap submission are separate account-level steps and have not been verified from source code. No external tool, ad spend, new analytics server or client-data upload was authorized by this workflow.
