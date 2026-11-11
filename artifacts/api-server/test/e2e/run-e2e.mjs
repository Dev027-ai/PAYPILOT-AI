// End-to-end checkout test: real built API server + real PostgreSQL + a
// simulated PayPal Sandbox (see mock-paypal.mjs).
//
//   pnpm --filter @workspace/api-server run build
//   DATABASE_URL=postgresql://... pnpm --filter @workspace/api-server run test:e2e
//
// The database must already have the schema (pnpm --filter @workspace/db run push).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, "../../dist/index.mjs");
const preload = path.resolve(here, "mock-paypal.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (use a throwaway database).");
  process.exit(2);
}

// Fake credentials: only ever used against the in-process simulator.
const SECRET = "e2e-fake-client-secret-never-real";
const MERCHANT = "E2EMERCHANT01";
let failures = 0;
let passes = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passes += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function withServer(label, extraEnv, scenario) {
  console.log(`\n# ${label}`);
  const port = 18000 + Math.floor(Math.random() * 1000);
  const controlPort = port + 1000;
  const child = spawn(
    process.execPath,
    ["--import", preload, "--enable-source-maps", serverEntry],
    {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "development",
        LOG_LEVEL: "silent",
        PAYPAL_ENVIRONMENT: "sandbox",
        PAYPAL_CLIENT_ID: "e2e-client-id",
        PAYPAL_CLIENT_SECRET: SECRET,
        PAYPAL_MERCHANT_ID: MERCHANT,
        REPLIT_DEV_DOMAIN: "paypilot-e2e.example.dev",
        MOCK_CONTROL_PORT: String(controlPort),
        ...extraEnv,
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  const seen = [];
  const api = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    seen.push(text);
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const approve = (id) =>
    fetch(`http://127.0.0.1:${controlPort}/approve/${id}`, { method: "POST" });

  try {
    for (let i = 0; i < 50; i += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) break;
      } catch {
        /* still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await scenario({ api, approve });
    check(
      "no response ever contained the client secret",
      !seen.some((text) => text.includes(SECRET)),
    );
    check(
      "no response ever contained the full merchant ID",
      !seen.some((text) => text.includes(MERCHANT)),
    );
  } finally {
    child.kill("SIGTERM");
  }
}

await withServer("Happy path, pending, duplicates", {}, async ({ api, approve }) => {
  const status = await api("GET", "/settings/status");
  check("status reports PayPal configured", status.body.paypalConfigured === true);

  const diag = await api("POST", "/settings/paypal-check");
  check("paypal-check passes", diag.status === 200 && diag.body.code === "ok", JSON.stringify(diag.body));
  const again = await api("POST", "/settings/paypal-check");
  check("paypal-check is rate limited", again.status === 429);

  const created = await api("POST", "/checkout/orders", {
    productId: "aerokeys-k75",
    quantity: 2,
    amountMinor: 1, // must be ignored: price is server-owned
  });
  check("order created", created.status === 201, JSON.stringify(created.body));
  check("amount is server-priced (2 x 69.00)", created.body.amountMinor === 13800);
  check("buyer is sent to a sandbox approval URL", /sandbox\.paypal\.com/.test(created.body.approveUrl ?? ""));
  check("order awaits approval", created.body.status === "approval-pending");

  const early = await api("POST", `/checkout/orders/${created.body.id}/capture`, {
    paypalOrderId: created.body.paypalOrderId,
  });
  check(
    "capture before buyer approval is pending, not failed or paid",
    early.status === 200 && early.body.status === "pending" && early.body.verified === false,
    JSON.stringify(early.body),
  );

  const wrong = await api("POST", `/checkout/orders/${created.body.id}/capture`, {
    paypalOrderId: "SOMEOTHERORDER",
  });
  check("mismatched PayPal order id is rejected", wrong.status === 400);

  await approve(created.body.paypalOrderId);
  const done = await api("POST", `/checkout/orders/${created.body.id}/capture`, {
    paypalOrderId: created.body.paypalOrderId,
  });
  check(
    "approved order is captured and verified",
    done.status === 200 && done.body.verified === true && done.body.status === "completed",
    JSON.stringify(done.body),
  );
  check("transaction is recorded as a debit of the exact amount", done.body.transaction?.amountMinor === -13800);

  const repeat = await api("POST", `/checkout/orders/${created.body.id}/capture`, {
    paypalOrderId: created.body.paypalOrderId,
  });
  check("repeating a capture stays completed (idempotent)", repeat.body.status === "completed" && repeat.body.verified === true);

  const list = await api("GET", "/transactions?search=AeroKeys");
  const mine = list.body.filter((t) => t.source === "paypilot-order" && t.status === "completed");
  check("completed order appears in transactions", mine.length >= 1);

  // Two simultaneous capture requests for the same approved order.
  const racing = await api("POST", "/checkout/orders", { productId: "arc-usb-hub", quantity: 1 });
  await approve(racing.body.paypalOrderId);
  const body = { paypalOrderId: racing.body.paypalOrderId };
  const [a, b] = await Promise.all([
    api("POST", `/checkout/orders/${racing.body.id}/capture`, body),
    api("POST", `/checkout/orders/${racing.body.id}/capture`, body),
  ]);
  check(
    "concurrent duplicate captures both resolve to one verified payment",
    [a, b].every((r) => r.status === 200 && r.body.verified === true),
    JSON.stringify([a.body, b.body]),
  );
});

await withServer("Wrong merchant ID", { MOCK_PAYEE: "SOMEOTHERMERCH" }, async ({ api }) => {
  const diag = await api("POST", "/settings/paypal-check");
  check("diagnostic names the merchant mismatch", diag.body.code === "merchant_mismatch", JSON.stringify(diag.body));
  check("diagnostic only shows masked IDs", /•/.test(diag.body.paypalMerchantHint ?? ""));
  const created = await api("POST", "/checkout/orders", { productId: "aerokeys-k75", quantity: 1 });
  check("checkout fails closed on merchant mismatch", created.status === 503, JSON.stringify(created.body));
});

await withServer("Rejected credentials", { MOCK_AUTH_FAIL: "1" }, async ({ api }) => {
  const diag = await api("POST", "/settings/paypal-check");
  check("diagnostic names the auth failure", diag.body.code === "auth_failed" && diag.body.paypalStatus === 401, JSON.stringify(diag.body));
  const created = await api("POST", "/checkout/orders", { productId: "aerokeys-k75", quantity: 1 });
  check("checkout fails closed on auth failure", created.status === 503);
});

await withServer("Not configured", { PAYPAL_CLIENT_ID: "" }, async ({ api }) => {
  const diag = await api("POST", "/settings/paypal-check");
  check(
    "diagnostic lists the missing variable by name",
    diag.body.code === "not_configured" && diag.body.missing?.includes("PAYPAL_CLIENT_ID"),
    JSON.stringify(diag.body),
  );
  const created = await api("POST", "/checkout/orders", { productId: "aerokeys-k75", quantity: 1 });
  check("checkout fails closed when unconfigured", created.status === 503);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
