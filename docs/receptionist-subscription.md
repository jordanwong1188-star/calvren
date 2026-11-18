# AI receptionist — custom quotes (updated 17 November 2026)

## Current public offer

- The homepage, AI receptionist page and contact form present **Custom pricing / Request a custom quote**. No receptionist monthly or setup amount is displayed publicly.
- Clients are asked about expected calls, service hours, booking process, existing telephone provider and integration requirements before receiving an individualized written quote.
- The AI receptionist is separate from Starter / Growth / Pro. The three standard plans retain their existing prices and authenticated Stripe checkout.
- The contact form continues to send quote enquiries through the existing Formspree flow and private Calvren lead archive. Quote requests do **not** initiate payment or activate an AI voice service.
- The retired fixed-price receptionist choice has been removed from public billing screens. The billing API advertises quote-only status without any receptionist amounts. Signed-in attempts to request a receptionist checkout now receive HTTP 409 and a quote URL; no Stripe Checkout Session is created.
- Older links such as /payment?plan=receptionist redirect visitors to the custom-quote form. A no-JavaScript visitor can still select the visible custom-quote links on the marketing pages.
- Existing paid receptionist subscriptions, if any, remain recognized by their original Stripe price ID and retain setup-only entitlements. No subscription is canceled, repriced or refunded by this website update.

## Internal / historical Stripe records

- The previously created live monthly price (CAD 425) is `price_1UcywrQ9mewkKyl5NAYObAFI` and the setup price (CAD 515) is `price_1UcywyQ9mewkKyl5btYpSECu`. They remain in the Stripe catalog for account history and existing subscription recognition; the public website no longer creates new sessions for them.
- The prior implementation charged CAD 940 initially (first month + setup). That historical checkout design is retired for new customers.
- Do not promise unlimited use or start a new customer subscription until monthly allowance, overflow handling, setup costs, call recording/consent approach, and activation date are explicitly agreed. A quote request is not a finalized payment contract.
- Provider usage and Stripe processing are not free. A GitHub repository is not a live voice provider.
- The existing Twilio integration supports SMS; a voice agent, telephone routing/forwarding and recording still require separate approved setup and real call testing.

## Operations and verification

- After approving a specific quote, issue a matching scoped Stripe product/payment arrangement deliberately (rather than re-enabling the old public price). Do not reuse the old fixed-price checkout by accident.
- Verify the new quote language, existing plan checkout, rejection of old receptionist checkout attempts and existing member entitlements through source and live read-only tests. No real customer card charge is needed for test verification.
