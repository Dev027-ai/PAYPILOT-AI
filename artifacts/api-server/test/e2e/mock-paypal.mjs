// Preloaded into the built API server (node --import) by run-e2e.mjs.
//
// Replaces ONLY requests to api-m.sandbox.paypal.com with an in-process
// simulator of the PayPal Orders v2 behaviour PayPilot relies on, and exposes a
// tiny control server so a test can play the buyer ("approve this order").
// It is a TEST DOUBLE: passing against it does not prove real PayPal accepts
// your credentials. Never load it outside tests.
import http from "node:http";
import { isMainThread } from "node:worker_threads";

const realFetch = globalThis.fetch;
const orders = new Map();
let counter = 0;

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const payee = process.env.MOCK_PAYEE || process.env.PAYPAL_MERCHANT_ID;
const authFails = process.env.MOCK_AUTH_FAIL === "1";

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const issue = (status, name, code) =>
  reply({ name, details: [{ issue: code }] }, status);

// --import also runs inside pino's logging worker thread; only patch the main thread.
if (isMainThread) globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname !== "api-m.sandbox.paypal.com") return realFetch(input, init);

  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  // Realistic latency so simultaneous requests genuinely overlap (a duplicate
  // capture then hits PayPal's ORDER_ALREADY_CAPTURED instead of running serially).
  await new Promise((resolve) => setTimeout(resolve, 25));

  if (url.pathname === "/v1/oauth2/token") {
    const expected = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    if (authFails || headers.get("authorization") !== expected) {
      return reply({ error: "invalid_client" }, 401);
    }
    return reply({ access_token: "mock-token", expires_in: 32400 });
  }
  if (headers.get("authorization") !== "Bearer mock-token") {
    return reply({ name: "AUTHENTICATION_FAILURE" }, 401);
  }

  if (url.pathname === "/v2/checkout/orders" && method === "POST") {
    const request = JSON.parse(init.body);
    const unit = request.purchase_units[0];
    const id = `MOCK${String(++counter).padStart(6, "0")}`;
    const record = {
      id,
      status: "CREATED",
      links: [
        {
          rel: "approve",
          href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
        },
      ],
      purchase_units: [
        {
          reference_id: unit.reference_id,
          amount: unit.amount,
          payee: { merchant_id: payee, email_address: "sb-merchant@example.com" },
        },
      ],
    };
    orders.set(id, record);
    return reply(record, 201);
  }

  const match = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
  const record = match && orders.get(match[1]);
  if (!record) return issue(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");

  if (!match[2] && method === "GET") return reply(record);

  if (match[2] && method === "POST") {
    if (record.status === "COMPLETED") {
      return issue(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED");
    }
    if (record.status !== "APPROVED") {
      return issue(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED");
    }
    const unit = record.purchase_units[0];
    record.status = "COMPLETED";
    unit.payments = {
      captures: [
        { id: `CAP-${record.id}`, status: "COMPLETED", amount: unit.amount },
      ],
    };
    return reply(record, 201);
  }
  return issue(405, "METHOD_NOT_SUPPORTED", "METHOD_NOT_SUPPORTED");
};

// Control plane: POST /approve/:id plays the buyer approving on PayPal.
const controlPort = Number(process.env.MOCK_CONTROL_PORT || 0);
if (isMainThread && controlPort) {
  http
    .createServer((req, res) => {
      const match = req.url?.match(/^\/approve\/([^/]+)$/);
      const record = match && orders.get(match[1]);
      if (req.method === "POST" && record) {
        if (record.status === "CREATED") record.status = "APPROVED";
        res.writeHead(200).end(record.status);
      } else {
        res.writeHead(404).end();
      }
    })
    .listen(controlPort, "127.0.0.1");
}
