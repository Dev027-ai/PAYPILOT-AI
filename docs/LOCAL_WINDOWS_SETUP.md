# PayPilot AI — Windows local setup

This guide configures the existing PayPal Sandbox flow; it does not provide PayPal credentials. PayPal Sandbox credentials and a PostgreSQL database are required for checkout. Gemini is the recommended AI provider and its API key is optional.

## 1. Requirements

- Node.js 20.6+ (Node 22 recommended)
- pnpm (use the version pinned in `package.json` / `pnpm-lock.yaml`)
- A PostgreSQL database (a free Neon PostgreSQL project is one option)
- A PayPal Developer account with a **Sandbox REST app**, plus a Sandbox Business receiving account

## 2. Install and configure secrets

From PowerShell in the project root:

```powershell
pnpm install
Copy-Item .env.example .env
notepad .env
```

Replace the placeholders in `.env`:

- `DATABASE_URL`: PostgreSQL connection URL. Use the provider's pooled/direct URL as documented by that provider; include SSL parameters when required. URL-encode special characters in the database username/password.
- `PAYPAL_CLIENT_ID`: Client ID from the **Sandbox** REST app.
- `PAYPAL_CLIENT_SECRET`: Secret from that same **Sandbox** REST app.
- `PAYPAL_MERCHANT_ID`: ID of the Sandbox Business account expected to receive payments (not the REST app client ID).
- `AI_PROVIDER`: set to `gemini` for Google Gemini (recommended).
- `GEMINI_API_KEY`: create a key at https://aistudio.google.com/apikey and paste it here.
- `GEMINI_MODEL`: defaults to `gemini-3.8-flash`. Gemini free-tier availability and rate limits depend on your account and current Google limits.
- Optional OpenAI alternative: set `AI_PROVIDER=openai` and configure `OPENAI_API_KEY`. Without a valid key for the selected provider, the app uses its clearly labelled demo fallback.
- `PAYPILOT_APP_ORIGIN`: for default local use, `http://localhost:23943`. If you change the web port, update this value to match.
- `CORS_ALLOWED_ORIGINS`: comma-separated browser origins, usually `http://localhost:23943,http://127.0.0.1:23943` for local use.

Never use PayPal Live credentials. Never paste secrets into chat or source files. `.env` is git-ignored.

## 3. Prepare the database

```powershell
.\scripts\setup-db.ps1
```

This pushes the Drizzle schema to the configured database. Use a database you control. Do not run against a production database.

## 4. Start the app

```powershell
.\scripts\start-local.ps1
```

It opens separate PowerShell windows for the API (`http://127.0.0.1:8080`) and web app (`http://localhost:23943`). Or start them separately using `scripts/dev-api.ps1` and `scripts/dev-web.ps1`. The Vite `/api` proxy forwards requests to Express.

Verify the routing by opening `http://localhost:23943/api/settings/status`; it should return JSON with `"environment":"sandbox-demo"`. Verify the API health route at `http://localhost:23943/api/healthz`. The safe provider diagnostics endpoint is `http://localhost:23943/api/settings/diagnostics`.

## 5. Verify PayPal

In the app, open **Settings → Run PayPal Sandbox check**. The diagnostic creates a $1.00 Sandbox order that is never approved or captured. It can identify missing credentials, authentication errors, or a receiving merchant mismatch. Then go to **Demo checkout**, create a demo order, approve it with a Sandbox Personal buyer account, and let the app verify the capture on return. Only verified captures are marked complete.

The local `PAYPILOT_APP_ORIGIN` must match the URL you open in the browser. If you use `http://127.0.0.1:23943` instead of `http://localhost:23943`, set the origin accordingly in `.env`.

## Important limitations

- Real PayPal Sandbox operation cannot be verified until you supply valid credentials and test against PayPal.
- Gemini API use is subject to Google AI Studio free-tier eligibility, model availability, and rate limits; no free quota is guaranteed.
- This remains a hackathon prototype, not a production payment service. It has no full user authentication or user-isolated payment history. Use Sandbox and synthetic data only.


## 6. Diagnose the database and order state

Open Settings → **Live runtime diagnostics**. A healthy result requires both `database.reachable = true` and `ordersTableAvailable = true`. If the database is reachable but the table check fails, verify the selected Supabase project/database and run:

```powershell
. .\scripts\load-env.ps1
.\scripts\setup-db.ps1
```

Then restart the API and refresh diagnostics. Do not run schema setup against a production database. A `DATABASE_URL` value by itself only means the variable exists; it does not prove login, table access, or persistence.

To inspect an order after returning from PayPal Sandbox, call `GET http://localhost:8080/api/checkout/orders/<orderId>`. The endpoint checks the remote Sandbox order when configured. Only a verified completed capture is reported as paid. A buyer cancel return is persisted locally by `POST /api/checkout/orders/<orderId>/cancel`; this is a local checkout state and is not a PayPal-side void.


## 7. One-command local verification

After dependencies are installed, run the full local verification sequence:

```powershell
.\scripts\verify-local.ps1
```

With the API running on port 8080, inspect runtime endpoints without exposing credentials:

```powershell
.\scripts\check-runtime.ps1
```
