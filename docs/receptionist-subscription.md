# AI receptionist subscription — 17 November 2026

- Separate from Starter / Growth / Pro: CAD 425 monthly and CAD 515 one-time setup. First payment CAD 940. Owner confirmed no tax collection for this release.
- Live monthly price: `price_1UcywrQ9mewkKyl5NAYObAFI`; setup: `price_1UcywyQ9mewkKyl5btYpSECu`. These are public catalog identifiers, not credentials.
- Authenticated Checkout uses verified server-side prices, requires acknowledgement that billing starts at purchase, and verifies subscription lifecycle events before account access.
- Payment grants managed onboarding access only. No voice agent, phone number, forwarding, call routing or recording service is provisioned by checkout. Existing Twilio integration is SMS. The operator must configure a voice provider, agree the client's scope and activation date, and test calls before delivery.
- There are no automatic minute-overage charges. Additional scope needs a separate client agreement; marketing benefit lists make no unlimited-use claim.
- Existing account storage permits one subscription per login. Existing subscribers must contact Calvren to discuss an additional service, rather than buying two plans on the same login.
- Refund/dispute/fraud events resolve InvoicePayment -> Invoice -> Subscription and produce `calvren_billing_review_required` entries in private backend logs. Operators must review those entries and Stripe's dashboard; no automatic refund or cancellation is performed.
- Existing Starter/Growth/Pro prices and CAD 349 setup are unchanged. Voice-provider usage and Stripe processing are not free GitHub tools.

Validation: automated billing tests cover independent setup-price verification, acknowledgement, correct line items, setup-only access, invoice failure reconciliation and risk-event resolution. No real customer payment was made during verification.
