# Calvren lead research — review before outreach

## What is connected

- The owner-run GitHub Action at .github/workflows/prospect-research.yml installs the Apache-2.0 open-source [Crawlee CheerioCrawler](https://github.com/apify/crawlee) pinned to @crawlee/cheerio 3.18.2 and executes scripts/prospect-research.mjs.
- A weekly scheduled run tries **one** OpenStreetMap Overpass query for new Vancouver-area business website tags. If OSM is unavailable or returns no suitable sites, it uses the 12 public business websites in data/prospect-starter-sites.json instead. Push-triggered checks and manual runs default to this curated list to avoid unnecessary load on OSM. The crawler respects robots.txt, limits speed to 2 concurrent / 8 requests per minute, and visits at most 15 business homepage roots.
- It runs weekly or from GitHub → Actions → Research Calvren prospects — review only → Run workflow. For a particular shortlist, paste public website roots into the websites input. Without URLs, choose **starter** (12 curated sites) or **osm** (try OSM discovery with automatic starter fallback).
- It produces a GitHub Actions artifact (retained 14 days) with research-report.md, candidates.csv and candidates.json. Open the completed run to download the artifact. Do not expect automatic import into customer billing, the public site, or a CRM.
- No AI API, paid subscription, bulk email sender, Google Maps scraper or external customer-data upload is added.
- **Public repository caution:** GitHub Actions artifacts can be public. The report includes only public company names, websites, source links and review drafts. Never supply private personal contacts, passwords, sensitive customer information or private revenue data.

## Scores measure research value, not confirmed purchasing power

| Dimension | Maximum | Interpretation |
| --- | ---: | --- |
| Industry fit | 25 | Relevant service work on public website or OSM category |
| Enquiry complexity | 25 | Phone, appointment or urgent-service mentions |
| Capacity indicators | 20 | Commercial services or multiple service areas: weak proxies, not revenue |
| Contactability | 15 | Public enquiry or booking link |
| Evidence strength | 15 | Multiple distinct source-linked observations |

70+ with at least four evidence types = high *research* priority. 45–69 = worth a human screening conversation. Below 45 = needs more evidence. Never describe the score as verified affordability, real revenue, proof of missed calls, or a company's willingness to buy.

Google Maps and Google reviews are not scraped or stored. Review any permitted source separately and manually, checking facts before citing them. OSM attribution: © OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/copyright.

## Before contacting anyone

1. Verify each observation at the linked source. A company website can be outdated.
2. Confirm whether Calvren could actually help, whether the business receives substantial enquiries, and whether it has the budget; no automated inference substitutes for those questions.
3. Identify a relevant business decision-maker and document the legal consent basis under Canada's CASL. A public email address alone is not blanket consent. Check restrictions, sender identification, postal address and unsubscribe requirements.
4. Personalize the draft and review it. Never assert an actual missed call, poor review, lost lead or financial figure without independent evidence.
5. Send any compliant outreach personally after approval. **This workflow sends zero emails.**

CASL references: https://crtc.gc.ca/eng/com500/guide.htm and https://crtc.gc.ca/eng/com500/faq500.htm

## Additional repositories

Crawl4AI could help with heavier web extraction, but adds a Python/browser deployment. Activepieces and Twenty CRM add hosting/operational complexity and are not installed. n8n's Sustainable Use License is not unrestricted MIT. Resend's backend code already exists at Calvren for transactional acknowledgements; sender configuration and real email delivery are separate verification steps.

For a new business, a small research pipeline and manually reviewed outreach are more useful than installing five redundant platforms.
