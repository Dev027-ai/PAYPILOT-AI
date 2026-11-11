# PayPilot AI

An independent hackathon prototype (not an official PayPal product): an AI payment assistant, a buyer-approved PayPal Sandbox demo checkout with server-side capture and verification, labelled synthetic transaction intelligence, spending analytics, and indicative currency estimates.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build and run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm test` — unit tests (Vitest)
- `pnpm --filter @workspace/api-server run test:e2e` — end-to-end suite (needs `DATABASE_URL` and a prior API build; uses a PayPal simulator)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas after editing `openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`. Checkout also needs `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` (Replit Secrets). Optional: `OPENAI_API_KEY`, `OPENAI_MODEL`.
- After setting PayPal secrets: Settings page → **Run PayPal Sandbox check**.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`); Web: React 19 + Vite + Tailwind 4 + wouter + TanStack Query (`artifacts/paypilot-ai`)
- DB: PostgreSQL + Drizzle ORM (`lib/db`, one table: `paypilot_orders`)
- Validation/contract: OpenAPI → Orval → Zod + React Query hooks
- Build: esbuild bundle for the API

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` (generated code in `lib/api-client-react`, `lib/api-zod`; never hand-edit generated files)
- PayPal client: `artifacts/api-server/src/lib/paypal-sandbox.ts`
- Routes: `artifacts/api-server/src/routes/paypilot.ts`
- Catalog, synthetic transactions, analytics: `artifacts/api-server/src/lib/paypilot-data.ts`
- All frontend pages: `artifacts/paypilot-ai/src/App.tsx`
- Verified status of every feature: `docs/IMPLEMENTATION_STATUS.md`; intended architecture: `docs/architecture-and-handoff.md`

## Architecture decisions

- Prices are server-owned: the client sends only a product id and quantity; the model can never set a payable amount.
- A payment is "completed" only when the server re-reads PayPal and order, capture, exact amount, currency and payee (`PAYPAL_MERCHANT_ID`) all match. A redirect proves nothing.
- `PAYPAL_MERCHANT_ID` is never sent to PayPal; it is an expected value compared with `payee.merchant_id`.
- The AI assistant is read-only (catalog, transactions, spending, FX tools) and falls back to labelled deterministic replies.
- Sandbox host is hard-coded (`api-m.sandbox.paypal.com`); there is no live mode.

## Product

Seven pages: Overview, AI assistant, Demo checkout, Transactions, Analytics, International, Settings. Transaction data is synthetic (`seeded-demo`) plus orders created by the demo store.

## User preferences

- Never ask for or expose API secrets in chat; secrets live in Replit Secrets only.
- Do not rebuild the project or remove working features; make incremental, tested changes and keep the docs in `docs/` matching reality.
- Never describe a feature as working without saying how it was verified (run, simulator, or code-read only).

## Gotchas

- The real PayPal Sandbox round-trip has not been verified yet; the end-to-end suite uses a simulator. Do one real purchase and record it in `docs/IMPLEMENTATION_STATUS.md`.
- Failed checkout attempts are stored as `failed` orders and appear in Transactions; clear them before a demo.
- After editing `openapi.yaml`, run codegen; `pnpm run typecheck` fails until generated types match.
- `pnpm` enforces a 1-day minimum package release age (`pnpm-workspace.yaml`); do not disable it.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
