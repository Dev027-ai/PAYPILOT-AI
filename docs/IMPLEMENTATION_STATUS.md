# PayPilot AI — Verified Implementation Status

**Audit date:** 2026-10-25
**Source of truth:** the Replit-generated repository (git `c45a627`, plus the changes listed in §7).
**Compared against:** the master blueprint (`docs/architecture-and-handoff.md`) and the original Replit master prompt (`attached_assets/`).

## How to read this report

Every status carries an **evidence level**. A feature is never "working" because the spec lists it.

| Level | Meaning |
|---|---|
| **RUN** | Executed in a real browser or HTTP client against the real server and a real PostgreSQL database. |
| **SIM** | Executed end to end, but PayPal was an in-process **simulator** (`artifacts/api-server/test/e2e/mock-paypal.mjs`). Proves PayPilot's logic; does **not** prove real PayPal accepts your credentials. |
| **CODE** | Read in the source only. Not executed. |
| **NONE** | Not implemented. |

### What could not be tested (and why)

- **Real PayPal Sandbox.** No credentials were provided (correct — secrets must never be shared in chat), and the audit environment's network blocks `api-m.sandbox.paypal.com`. **No real PayPal request has ever been made by this audit. The real OAuth, order, approval and capture round-trip is unverified.**
- **OpenAI.** No key available. The live model path is **CODE** only; the no-key fallback is **RUN**.
- **Frankfurter FX provider.** Blocked in the audit environment, so only the labelled demonstration-rate fallback was exercised.
- **Your Replit Secrets.** Not visible to the audit, so whether they are set in your Replit project is unknown. The code reports readiness at `GET /api/settings/status` and, new, at Settings → *Run PayPal Sandbox check*.

## 1. Stack (verified from the repository)

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Node 22+ (Replit: Node 24), TypeScript 5.9 |
| Frontend | React 19 + Vite 7 + Tailwind 4, `wouter`, TanStack Query; one large `src/App.tsx` (7 pages) |
| Backend | Express 5, pino logging, esbuild bundle |
| Database | PostgreSQL + Drizzle ORM; **one table**, `paypilot_orders` |
| API contract | OpenAPI (`lib/api-spec/openapi.yaml`) → Orval → generated React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) |
| AI | `openai` SDK, Chat Completions with 4 read-only function tools; deterministic fallback |
| PayPal | Direct REST calls to `https://api-m.sandbox.paypal.com` with `fetch` (hard-coded Sandbox host). **No PayPal SDK, no Agent Toolkit, no MCP.** |
| Unused scaffolding | `artifacts/mockup-sandbox` (Replit canvas tool) |

Build health at audit start: `pnpm run typecheck` **passes** (all packages); API and web production builds **pass**. No automated tests existed.

## 2. Feature status

| Capability (blueprint §3) | Status | Evidence | Notes |
|---|---|---|---|
| App starts and serves | Working | RUN | With no credentials set, all 8 GET routes and the assistant respond correctly, and the checkout POST routes fail closed (400/404/503) as designed. |
| AI Payment Agent | **Partial** | RUN (fallback) / CODE (OpenAI) | `POST /api/assistant`. Four read-only tools (catalog, transactions, spending, FX). By design it **cannot** create or capture orders; the blueprint's `create_checkout_order`, `capture_approved_order`, `get_payment_status` tools do not exist. Model default `gpt-5.4-mini` is unverified; an invalid model silently degrades to a labelled fallback. |
| Intelligent Checkout Agent | **Implemented, not yet proven on real PayPal** | SIM + RUN (UI) | Server-priced order → PayPal order → buyer approval redirect → server capture → verification. See §3. |
| Transaction Intelligence | Working on **synthetic** data | RUN | List, search, status filter, detail. 9 seeded records labelled `seeded-demo` plus app-created orders. No PayPal transaction-history API is integrated (blueprint §3.3 permits this if labelled; it is). |
| Spending Intelligence | Working | RUN | Deterministic week/month/quarter totals, categories, period comparison. |
| International Payment Assistant | **Partial** | RUN (fallback only) | Frankfurter reference rates with a labelled demo-rate fallback. No PayPal fees or quotes (correctly stated as unavailable). |
| Authentication / user scoping | **None** | CODE | Any visitor sees every order and can call any endpoint. CORS is open. Acceptable for a single-tenant demo only. |
| Webhooks | **None** | CODE | README lists `PAYPAL_WEBHOOK_ID`, but no code reads it. |
| Automated tests | **None → added** | RUN | 32 unit + 29 end-to-end checks added (§7). |

## 3. PayPal integration — the focus of this audit

Source: `artifacts/api-server/src/lib/paypal-sandbox.ts`, routes in `src/routes/paypilot.ts`.

| Step | Implementation | Evidence |
|---|---|---|
| **Sandbox authentication** | `POST /v1/oauth2/token`, HTTP Basic `client_id:secret`, 10 s timeout. Fails closed. Token is **not cached**: a fresh token is requested for every PayPal call (1 to create an order, 3 to capture and verify). | SIM / CODE |
| **Merchant ID** | `PAYPAL_MERCHANT_ID` is **never sent to PayPal**. It is an *expected value*: after PayPal returns an order, `purchase_units[0].payee.merchant_id` must equal it, otherwise order creation and capture verification fail. So it must be the **Account ID of the Sandbox business account the REST app is attached to**, not the Client ID, app name or email. A wrong value makes every checkout fail closed. | SIM |
| **Order creation** | `POST /v2/checkout/orders`, `intent: CAPTURE`. Amount comes only from the server catalog × quantity (client-supplied amounts are ignored; proven). Request id = internal order UUID. Verifies returned payee, currency, exact amount, and that the approval link is an `https://*.sandbox.paypal.com` URL. Uses the legacy `application_context` for return/cancel URLs (still how this works today as far as the audit could tell; confirm against current PayPal docs before submission). | SIM |
| **Approval** | Full-page redirect to PayPal's approval URL; PayPal redirects back to `/checkout?paypilotOrderId=…&token=…`. | SIM + RUN (UI return handling) |
| **Capture** | On return the frontend calls `POST /api/checkout/orders/:id/capture` **once**. Server GETs the order, captures only if `APPROVED` (idempotency key `capture-<id>`), re-GETs. | SIM |
| **Payment verification** | `completed` requires *all* of: order `COMPLETED`, capture `COMPLETED`, exact amount and currency, payee match. A redirect alone never marks anything paid. Un-approved returns are reported **pending**. | SIM + RUN |
| **Duplicate/refresh handling** | DB status short-circuits repeats; concurrent duplicates reconcile via `ORDER_ALREADY_CAPTURED` (**fixed in this audit**). | SIM |
| **Cancellation** | Handled in the browser only (message shown). Server order stays `approval-pending`; there is no persisted `CANCELLED` state. | RUN |
| **Webhooks** | None. | NONE |

**Bottom line:** the logic is sound and unusually defensive, but it has only ever run against a simulator. The single most valuable next action is one real Sandbox purchase.

## 4. The two current blockers

### A. "Unauthorized" in the PayPal Developer Dashboard

This is a PayPal website access problem. **No change to PayPilot's code can cause or fix it.** It does not by itself mean your credentials are invalid. Things to try, in order: sign out and back in at developer.paypal.com with the same account that created the developer app; try a private window or another browser; confirm the dashboard toggle is on **Sandbox**, not Live; if it persists, contact PayPal developer support. The audit could not reproduce or inspect the dashboard.

### B. Which merchant ID to use

You no longer need the dashboard to find out whether it is right. Add the four variables in Replit Secrets (Sandbox values only), restart, then open **Settings → Run PayPal Sandbox check**. It returns exactly one of:

| Code | Meaning | Fix |
|---|---|---|
| `not_configured` | Lists the missing variable **names** | Add them to Replit Secrets |
| `auth_failed` | PayPal rejected the Client ID/Secret (HTTP status shown) | Re-copy both from the *same Sandbox* REST app |
| `merchant_mismatch` | Credentials fine; `PAYPAL_MERCHANT_ID` ≠ the account PayPal pays. Shows **masked** hints for both (e.g. `AB••••••YZ`) | Use the Account ID of the business account whose first/last characters match PayPal's hint |
| `merchant_unavailable` | PayPal did not report a payee on the test order | Check the app is a Sandbox app with Checkout enabled |
| `paypal_error` / `network_error` | PayPal refused or was unreachable | Retry; check app configuration |
| `ok` | Auth and merchant both verified | Proceed to a real purchase test |

The check creates a $1.00 test order that is **never approved or captured**, returns only masked identifiers, never returns secrets, and is rate limited to one run per 5 seconds.

## 5. Spec versus implementation

| Blueprint item | Blueprint | Actual |
|---|---|---|
| Health | `GET /api/health` | `GET /api/healthz` |
| Create order | `POST /api/orders` | `POST /api/checkout/orders` |
| Capture | `POST /api/orders/:id/capture` | `POST /api/checkout/orders/:orderId/capture` |
| Order status | `GET /api/orders/:id` | **Missing** (orders only surface as transactions) |
| Transactions | `GET /api/transactions` | Same, plus `/transactions/:id` |
| Insights | `GET /api/insights/summary` | `GET /api/analytics/spending?period=` |
| Chat | `POST /api/chat` | `POST /api/assistant` |
| Extra routes | — | `/overview`, `/catalog/products`, `/fx/estimate`, `/settings/status`, `/settings/paypal-check` (new) |
| Payment states | `CREATED … UNKNOWN` | `prepared`, `approval-pending`, `completed`, `failed` (no `cancelled`, no capture-pending) |
| Data model | users, orders, payments, transactions, AI metadata | One `paypilot_orders` table; demo transactions are in code |
| AI tools | status / create / capture / list / summarize / categorize / explain | catalog search, transaction search, spending summary, FX estimate (all read-only) |

Original Replit master-prompt requirements **not met**: PayPal Agent Toolkit / MCP (direct REST used instead; do **not** claim MCP in the submission), PayPal React SDK v6 (redirect flow used), webhook endpoint and signature verification, authentication and rate limiting, AG Grid Studio (README correctly says not configured), user-scoped data.

## 6. Defects

**Found and fixed in this audit** (fixes 2–4 were mutation-checked: reverting each makes a test fail):

1. Every PayPal failure became one generic 503, hiding bad credentials versus wrong merchant ID. → error kinds + the diagnostic endpoint and Settings button.
2. A duplicate/concurrent capture returned "could not verify" even though the payment succeeded (`ORDER_ALREADY_CAPTURED`). → reconciled by re-reading the order.
3. An order PayPal still reports as `CREATED` (buyer hasn't approved yet) was permanently marked `failed`. → now `pending`. A capture under review (`PENDING`) is also `pending`.
4. The assistant's fallback recommended a **mouse** for "wireless keyboard under $75" (price-only sort). → relevance-first ranking; wording changed from "lowest-priced" to "best match".
5. `.gitignore` did not exclude `.env` files. → excluded; `.env.example` added.

**Found, not fixed (recommended order):**

1. No auth; open CORS; every visitor sees every order (blueprint §10, §12).
2. OAuth token not cached (extra latency and token requests; blueprint §7.3).
3. No persisted cancelled state; no `GET /orders/:id`.
4. Failed attempts (e.g. misconfigured merchant ID) are stored as `failed` orders and appear in the Transactions list, which clutters a demo; clear them before recording.
5. Product-card accent colours: CSS names like `mint` and `rose` are invalid, so some cards render blank while `blue` renders pure `#0000ff`.
6. After a verified payment the "Your order" panel also shows "Nothing selected yet".
7. Setup-guidance list lost its numbering (CSS reset).
8. `openapi.yaml` documents order-creation failure as 502; the server returns 503.
9. `PAYPAL_WEBHOOK_ID` is documented but unused.
10. `replit.md` was an unfilled template (now filled).

## 7. Changes made and test evidence

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/paypal-sandbox.ts` | Error kinds + PayPal issue codes; `missingPayPalConfiguration`; `diagnosePayPalSandbox`; capture reconcile; pending-status mapping |
| `artifacts/api-server/src/lib/paypilot-data.ts` | Relevance-ranked `findProducts` |
| `artifacts/api-server/src/routes/paypilot.ts` | `POST /api/settings/paypal-check` (rate limited); wording fix |
| `lib/api-spec/openapi.yaml` + regenerated clients | New endpoint and `PayPalCheck` schema |
| `artifacts/paypilot-ai/src/App.tsx` | "Run PayPal Sandbox check" button and result panel on Settings |
| `artifacts/api-server/src/lib/*.test.ts` | 32 Vitest unit tests (`pnpm test`) |
| `artifacts/api-server/test/e2e/` | End-to-end suite with PayPal simulator (`pnpm --filter @workspace/api-server run test:e2e`) |
| `.env.example`, `.gitignore`, root `package.json` | Placeholders, secret protection, `test` script |
| `README.md`, `replit.md`, `docs/` | Updated to match reality |

**Results:** typecheck passes for all packages · production builds pass · 32/32 unit tests · 29/29 end-to-end checks (real server + real PostgreSQL + simulated PayPal) · 9/9 browser checks (Playwright, one-off, not committed) covering the Settings check, approval link host, return-from-PayPal verification, refresh, cancel, un-approved return, and the transactions list. Mutation checks confirmed that tests fail when fixes 2–4 are reverted; the end-to-end duplicate-capture check was initially vacuous and was corrected so it now fails without the fix.

## 8. Recommended next steps

1. **Smallest safe next step (needs you):** set the four Sandbox secrets in Replit, restart, run **Settings → Run PayPal Sandbox check**, and fix whatever code it reports. Nothing else should be built until it says `ok`.
2. Do one real Sandbox purchase with a Sandbox *personal* buyer account; confirm "Payment verified in Sandbox" and the capture in the Sandbox business account. Record the result in this file.
3. Cache the OAuth token; persist a `cancelled` state; add `GET /api/orders/:id`.
4. Decide on authentication and rate limiting before any public demo.
5. Evaluate PayPal Agent Toolkit/MCP for the AI path **only** if it can be genuinely connected and tested; otherwise document the direct-API choice.
6. Polish items in §6, then the demo script and video.


## Windows local setup update (2026-10-26)

The local Vite configuration now proxies `/api` to the Express API, local ports have defaults, and PayPal return/cancel URLs can use `PAYPILOT_APP_ORIGIN` (default local value: `http://localhost:23943`). PowerShell scripts load the ignored root `.env`, build/start the API, start the web app, and push the database schema. These code changes do not certify real PayPal Sandbox credentials; run the Settings diagnostic and a buyer-approved Sandbox checkout after setup.


## 8. 6 November 2026 implementation update (static changes; not yet runtime-certified)

The following changes were made after the historical 25 October audit. They are source-level changes only until the Windows verification commands in `LOCAL_WINDOWS_SETUP.md` are run:

- The API global error handler now logs a bounded, credential-redacted error summary through the request logger while preserving a generic client response.
- `GET /api/settings/diagnostics` checks `SELECT 1` and the `paypilot_orders` table separately, returning safe error codes and no connection secrets.
- Read-only transaction loading now falls back to explicitly labelled synthetic demo records if PostgreSQL is unavailable or the table is missing. Checkout writes still fail closed; the fallback never fabricates a persisted order or payment.
- PostgreSQL pool connection attempts are bounded to five seconds, with a small pool and idle timeout.
- PayPal Sandbox OAuth tokens are cached in process memory until shortly before expiry.
- `GET /api/checkout/orders/:orderId` refreshes remote Sandbox state and only persists `completed` after exact order/capture/amount/currency/payee verification.
- `POST /api/checkout/orders/:orderId/cancel` records a buyer return/cancel event locally and refuses to overwrite an already verified capture. It does not claim a remote PayPal void.
- Settings now displays database reachability and table availability diagnostics.

### Not yet complete

No fresh typecheck, unit/e2e test run, frontend/API production build, live Gemini call, or real PayPal Sandbox approval/capture was executed for this update in the archive-editing environment. Full authentication and tenant ownership, verified PayPal webhooks, TrustLens, Promise, and Rescue are not implemented by these changes. They must be built and independently tested before any production or real-customer-data claim.
