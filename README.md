# PayPilot AI

**Your money, understood.**

PayPilot AI is an independent hackathon prototype for payment intelligence and
buyer-approved commerce. It is not an official PayPal application and is not
endorsed by PayPal.

## What works in this prototype

- A seven-page responsive workspace for overview, the AI assistant, checkout,
  transactions, analytics, international estimates, and integration settings.
- An OpenAI-backed assistant that receives only server-selected, scoped facts.
  When the AI provider is unavailable, responses are marked as deterministic
  demo fallback responses.
- Searchable synthetic transaction examples, explicitly labeled as demo data
  and never described as a connected PayPal account.
- Server-calculated spending totals and period comparisons using exact integer
  minor-unit amounts.
- A curated demo product catalog. Checkout totals are calculated from the
  server catalog and prepared orders are stored in PostgreSQL.
- Indicative exchange-rate estimates sourced from Frankfurter reference rates,
  with clearly labeled demonstration rates only for configured fallback pairs.

## Important checkout status

The Sandbox checkout (server-priced order, buyer approval on PayPal, server
capture, verification) is implemented and has been tested end to end against a
**simulated** PayPal. It has **not** yet been verified against the real PayPal
Sandbox: that needs your Sandbox credentials. Until a Sandbox client ID,
secret, and expected receiving merchant ID are configured, the app fails closed:
it creates no PayPal order and reports no payment as complete. A payment is only
ever reported complete after the server verifies PayPal's capture (amount,
currency, and receiving merchant). Do not use live credentials for this demo.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for a
verified, evidence-graded status of every feature, and
[`docs/architecture-and-handoff.md`](docs/architecture-and-handoff.md) for the
intended architecture.

The data workspace contains synthetic examples and PayPilot-created orders
only. It does not read personal PayPal account history. No AG Grid Studio
license or integration is configured. This prototype is not production-ready,
does not provide financial advice, and has not received regulatory or security
certification.

## Run

For Windows local setup, follow [`docs/LOCAL_WINDOWS_SETUP.md`](docs/LOCAL_WINDOWS_SETUP.md).
The Replit project provides the PostgreSQL connection and runs the web and API
services through its configured workflows. To prepare the development schema:

```sh
pnpm --filter @workspace/db run push
```

To check TypeScript across the project:

```sh
pnpm run typecheck
```

The web app is served at the root preview route. The shared API is under
`/api`; its health endpoint is `/api/healthz`.

## Environment configuration

Set secrets through Replit Secrets, never in source code or browser-visible
configuration.

| Variable | Purpose | Status |
| --- | --- | --- |
| `AI_PROVIDER` | AI provider selector | Defaults to `gemini` in `.env.example` |
| `GEMINI_API_KEY` | Server-side Gemini assistant calls | Optional; without a valid key the assistant uses clearly labeled fallback replies |
| `GEMINI_MODEL` | Gemini model override | Defaults to `gemini-3.8-flash` |
| `OPENAI_API_KEY` | Optional OpenAI alternative | Used when `AI_PROVIDER=openai` |
| `OPENAI_MODEL` | Optional OpenAI model override | Defaults to `gpt-5.4-mini` |
| `PAYPAL_ENVIRONMENT` | PayPal API environment; must be `sandbox` | Required for checkout (preset in `.replit`) |
| `PAYPAL_CLIENT_ID` | PayPal Sandbox REST app client ID | Required for checkout |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox REST app secret | Required for checkout |
| `PAYPAL_MERCHANT_ID` | Account ID of the Sandbox business account the REST app pays. Not sent to PayPal; compared with the payee PayPal returns | Required for checkout |
| `PAYPAL_WEBHOOK_ID` | Reserved for future webhook verification | **Not used by the current code** |
| `DATABASE_URL` | PostgreSQL connection | Required for orders and transaction loading |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed browser origins | Defaults to local app origins; configure for hosted previews |

A placeholder-only [`.env.example`](.env.example) is provided with local ports and the local PayPal return origin. Copy it to `.env` for Windows local development. Real `.env` files are git-ignored.

### Verify your PayPal Sandbox setup

After adding the secrets and restarting, open **Settings → Run PayPal Sandbox
check**. It reports exactly what is wrong (`not_configured` with the missing
variable names, `auth_failed`, `merchant_mismatch` with masked IDs, or `ok`),
without exposing any secret. It creates a $1.00 test order that is never
approved or captured. The same check is available as
`POST /api/settings/paypal-check` (rate limited to one run per 5 seconds).

### PayPal Sandbox setup

1. Create a Sandbox REST app in the PayPal Developer Dashboard.
2. Create or select a Sandbox Business account as the intended receiving
   merchant, and record its merchant ID if available.
3. Create a separate Sandbox Personal buyer account for approval tests.
4. Add the Sandbox app's client ID and secret to Replit Secrets. Add the
   expected Sandbox merchant ID as well. Do not use live credentials or paste
   secrets into chat.
5. Confirm that the app is configured for the Sandbox API host before testing.
6. Test buyer approval and server-side capture with the Sandbox buyer. A return
   from the approval page alone is not proof of payment; only the verified
   capture response can mark an order complete.
7. Register and verify a webhook only after a webhook ID and signature
   verification flow are configured. A missing webhook is not treated as
   verified.

The PayPal Sandbox credentials must be configured before the purchase journey
is available. The app intentionally fails closed until then.

## Tests

```sh
pnpm test                                        # unit tests (Vitest, no network or database)
pnpm --filter @workspace/api-server run build
DATABASE_URL=postgresql://... \
  pnpm --filter @workspace/api-server run test:e2e  # real server + database + simulated PayPal
```

The end-to-end suite replaces only PayPal's HTTP API with an in-process
simulator (`artifacts/api-server/test/e2e/mock-paypal.mjs`) and uses fake
credentials. Passing it proves PayPilot's own logic; it does not prove that
real PayPal accepts your credentials. Use a throwaway database for it.

## Data and safety

- Demo transactions are synthetic and carry a `seeded-demo` source label.
- Checkout products and prices are owned by the server; the model cannot set
  payable amounts.
- The assistant is read-only. It cannot directly access the database, shell,
  or arbitrary network tools, and it cannot initiate a payment.
- No card number, CVV, PayPal password, or raw payment credential is stored.
- The current hosted demo does not implement user login or private,
  user-scoped transaction history, and has only lightweight per-process rate limits (not a shared production limiter); every visitor can see the demo order list. Use synthetic data only and do not deploy with private customer records.

## Repository and demo submission

The source is prepared with an MIT license. Publishing a public Git repository,
recording a demo video, enabling the PayPal Sandbox checkout, and obtaining an
AG Grid Studio trial remain separate setup steps.


## AI assistant provider

The default local configuration uses Google's Gemini API through its OpenAI-compatible endpoint. If `AI_PROVIDER` is omitted, the server does not silently fall back to OpenAI; select OpenAI explicitly if you intend to use it. Create a key in [Google AI Studio](https://aistudio.google.com/apikey), then set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.8-flash` in `.env`. The assistant keeps its server-side tool calls for the demo catalogue, synthetic transaction search, spending summaries, and indicative FX estimates. Gemini API free-tier access is subject to model availability, rate limits, and Google's terms. Never expose the key in frontend code or commit `.env`.

To use OpenAI instead, set `AI_PROVIDER=openai` and configure `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.


## Master implementation checklist

See [the master specification gap analysis](docs/MASTER_SPEC_GAP_ANALYSIS.md) for the current evidence-based status, unverified live-provider steps, and blockers before public deployment.


## Runtime diagnostics and database recovery (6 November 2026)

Open **Settings → Live runtime diagnostics** or request `GET /api/settings/diagnostics`. This checks PostgreSQL with `SELECT 1` and verifies that `paypilot_orders` is queryable. It never returns the database URL or credentials. A configured `DATABASE_URL` is not proof that the database is reachable or that the schema exists.

Read-only transaction views now degrade explicitly to the labelled synthetic demo dataset if the database query fails. This keeps the demo dashboard and assistant readable, but it does **not** make checkout or database writes available. Checkout remains fail-closed when the database cannot persist an order. Run `scripts/setup-db.ps1` only after confirming that `.env` points to the intended non-production database.

PayPal OAuth access tokens are cached in process memory until shortly before expiry to avoid requesting a new token for every API call. `GET /api/checkout/orders/:orderId` refreshes an order from PayPal Sandbox when credentials are configured and only marks it completed when order status, capture status, exact amount, currency and receiving merchant all verify. `POST /api/checkout/orders/:orderId/cancel` records that the buyer returned from the approval flow without completing checkout; it does not claim that PayPal voided the remote order.

### Verification boundary

The 6 November code changes are static implementation changes until the project is installed and run on the target Windows machine. This archive has not been certified by a fresh full dependency install, typecheck, test suite, production build, live Gemini request, or real PayPal Sandbox buyer-approved capture. Authentication, tenant isolation, webhook signature verification, and the TrustLens / Promise / Rescue vertical slices remain separate implementation work; do not expose this demo to real customer data or describe it as production-ready.
