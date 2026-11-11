# PayPilot AI — Master Specification Gap Analysis

**Updated:** 2026-10-26
**Basis:** `PayPilot AI — Master Hackathon Implementation Specification` supplied by the project owner.
**Evidence rule:** Source inspection is marked CODE. Simulator/unit tests are not proof of a live Gemini or PayPal Sandbox round trip.

## Implemented in this source tree (CODE unless otherwise stated)

- Google Gemini is the primary assistant provider using Google's documented OpenAI-compatible endpoint; model defaults to `gemini-3.8-flash`.
- Four constrained, read-only assistant tools exist: catalog search, available transaction search, spending summary, and indicative FX estimate.
- Product price and quantity are validated server-side from the demo catalog before creating an order.
- PayPal Sandbox order creation, buyer approval redirect, server-side capture and capture verification logic exist.
- Capture verification checks order/capture status, amount, currency and receiving merchant where available.
- The assistant labels synthetic transaction data and uses a deterministic fallback when no provider is configured or a provider request fails.
- PayPal Sandbox diagnostic endpoint creates a test order that is not approved or captured.
- Environment examples use placeholders and `.env` is ignored by Git.
- This revision adds explicit CORS origin allowlisting, lightweight per-process rate limits for assistant/order creation/capture, a safe configuration diagnostics endpoint, and tests for the rate limiter.
- When `AI_PROVIDER` is omitted, the app now prefers Gemini only; it no longer silently selects OpenAI just because an OpenAI key happens to exist. OpenAI remains available only when explicitly selected.

## Not verified in this environment

- Dependency installation, TypeScript typecheck, production build and automated tests could not be run here because Corepack could not download pnpm from the npm registry (`EAI_AGAIN registry.npmjs.org`).
- No live Gemini request was made because no private API key was available.
- No real PayPal Sandbox OAuth/order/approval/capture round trip was made in this environment.
- Existing simulator-based test evidence in the prior `IMPLEMENTATION_STATUS.md` is historical evidence from that report; it is not a test run of this revised archive.

## Important gaps before a public judge-facing deployment

1. **Authentication and order ownership are not implemented.** Orders and transaction data are not scoped to authenticated users. Keep the demo restricted to synthetic data in a controlled environment until authentication/ownership is implemented and tested.
2. **Shared production rate limiting is not implemented.** The new limiter is in-memory and per process; multi-instance deployment needs a shared store and reverse-proxy-aware client identification.
3. **Cancellation is UI-only.** Cancellation currently displays a message but does not persist a cancelled state in the database.
4. **Order status retrieval endpoint is not yet implemented.** PayPilot-created orders surface in transaction lists, but there is no dedicated `GET /api/checkout/orders/:orderId` endpoint.
5. **OAuth token caching and webhook signature verification are not implemented.** Do not claim webhooks or PayPal Agent Toolkit/MCP integration; the current payment integration uses direct PayPal REST API calls.
6. **Real-provider acceptance tests remain required.** Complete a successful Gemini tool-call request and a separate buyer-approved PayPal Sandbox payment before claiming end-to-end live integration.
7. **Catalog is curated demo data.** Do not claim live product inventory, merchant partnerships, or real-world product availability.
8. **No hosted deployment, clean-checkout verification, or demo video was verified by this revision.**

## Required local verification after extracting this archive

Run from the project root on a machine with network access and the configured Node/pnpm toolchain:

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm --filter @workspace/api-server run test:e2e
pnpm run build
```

Then configure local Gemini and Sandbox credentials in `.env`, start the app, open `/api/settings/diagnostics`, verify the AI provider, and complete a real Sandbox buyer approval/capture. Never place secret values in the public repository or a chat message.

## Submission readiness

**Not yet certified as submission-ready.** The source has the core AI tools and defensive checkout implementation, but it must pass the checks above and the authentication/order-ownership gap must be resolved or the hosted demo must remain restricted to synthetic data in a controlled demo environment. A real Sandbox checkout and live Gemini tool call are the most important remaining demonstrations.
