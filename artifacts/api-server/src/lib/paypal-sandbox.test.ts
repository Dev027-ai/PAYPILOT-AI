import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureAndVerifyPayPalSandboxOrder,
  createPayPalSandboxOrder,
  diagnosePayPalSandbox,
  getPayPalSandboxOrderStatus,
  resetPayPalTokenCacheForTests,
  isPayPalSandboxConfigured,
  maskIdentifier,
  missingPayPalConfiguration,
  PayPalSandboxError,
} from "./paypal-sandbox";

/**
 * These tests stub `fetch`, so they verify PayPilot's own logic against
 * PayPal-shaped responses. They do NOT prove that real PayPal Sandbox accepts
 * the configured credentials; that needs a live run with real Sandbox secrets.
 */

const SECRET = "super-secret-value-do-not-leak";
const MERCHANT = "MERCHANT12345";
const ORDER_ID = "internal-order-1";
const PAYPAL_ORDER_ID = "5O190127TN364715T";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

type Handler = (call: Call) => Response | Promise<Response> | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function paypalError(status: number, issue: string): Response {
  return json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue }] }, status);
}

function order(overrides: {
  status?: string;
  merchant?: string | null;
  amount?: string;
  currency?: string;
  captureStatus?: string | null;
  captureAmount?: string;
  approveHost?: string;
}) {
  const {
    status = "CREATED",
    merchant = MERCHANT,
    amount = "69.00",
    currency = "USD",
    captureStatus = null,
    captureAmount = amount,
    approveHost = "www.sandbox.paypal.com",
  } = overrides;
  return {
    id: PAYPAL_ORDER_ID,
    status,
    links: [
      {
        rel: "approve",
        href: `https://${approveHost}/checkoutnow?token=${PAYPAL_ORDER_ID}`,
      },
    ],
    purchase_units: [
      {
        reference_id: ORDER_ID,
        amount: { currency_code: currency, value: amount },
        ...(merchant ? { payee: { merchant_id: merchant } } : {}),
        ...(captureStatus
          ? {
              payments: {
                captures: [
                  {
                    id: "CAP-1",
                    status: captureStatus,
                    amount: { currency_code: currency, value: captureAmount },
                  },
                ],
              },
            }
          : {}),
      },
    ],
  };
}

let calls: Call[] = [];

function installFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        headers,
        body:
          typeof init?.body === "string" && headers["content-type"]?.includes("json")
            ? JSON.parse(init.body)
            : init?.body,
      };
      calls.push(call);
      if (call.url.endsWith("/v1/oauth2/token")) {
        return json({ access_token: "tok_abc", expires_in: 32400 });
      }
      const response = await handler(call);
      if (!response) throw new Error(`Unexpected PayPal call: ${call.method} ${call.url}`);
      return response;
    }),
  );
}

const apiCalls = () => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token"));

beforeEach(() => {
  resetPayPalTokenCacheForTests();
  vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client-id-123");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", SECRET);
  vi.stubEnv("PAYPAL_MERCHANT_ID", MERCHANT);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REPLIT_DEV_DOMAIN", "paypilot.example.dev");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("is configured only when sandbox + id + secret + merchant are present", () => {
    expect(isPayPalSandboxConfigured()).toBe(true);
    vi.stubEnv("PAYPAL_MERCHANT_ID", "");
    expect(isPayPalSandboxConfigured()).toBe(false);
  });

  it("refuses anything but the sandbox environment", () => {
    vi.stubEnv("PAYPAL_ENVIRONMENT", "live");
    expect(isPayPalSandboxConfigured()).toBe(false);
    expect(missingPayPalConfiguration()[0]).toContain("PAYPAL_ENVIRONMENT");
  });

  it("reports missing variable names, never values", () => {
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    const missing = missingPayPalConfiguration();
    expect(missing).toEqual(["PAYPAL_CLIENT_SECRET"]);
    expect(JSON.stringify(missing)).not.toContain(MERCHANT);
  });
});

describe("createPayPalSandboxOrder", () => {
  const input = {
    orderId: ORDER_ID,
    productName: "AeroKeys K75",
    amountMinor: 6900,
    currency: "USD",
  };

  it("sends the server-computed amount and returns the approval link", async () => {
    installFetch(() => json(order({})));
    const result = await createPayPalSandboxOrder(input);

    expect(result).toEqual({
      paypalOrderId: PAYPAL_ORDER_ID,
      approveUrl: expect.stringContaining("sandbox.paypal.com"),
    });

    const token = calls[0];
    expect(token.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(token.headers.authorization).toBe(
      `Basic ${Buffer.from(`client-id-123:${SECRET}`).toString("base64")}`,
    );

    const create = apiCalls()[0];
    expect(create.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(create.headers.authorization).toBe("Bearer tok_abc");
    expect(create.headers["paypal-request-id"]).toBe(ORDER_ID);
    const unit = (create.body as { purchase_units: Array<{ amount: unknown }> })
      .purchase_units[0];
    expect(unit.amount).toEqual({ currency_code: "USD", value: "69.00" });
  });

  it("reuses a still-valid OAuth token for repeated Sandbox API calls", async () => {
    installFetch(() => json(order({})));
    await createPayPalSandboxOrder(input);
    await createPayPalSandboxOrder(input);
    expect(calls.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    expect(apiCalls()).toHaveLength(2);
  });

  it("only ever calls the sandbox host", async () => {
    installFetch(() => json(order({})));
    await createPayPalSandboxOrder(input);
    for (const call of calls) {
      expect(new URL(call.url).hostname).toBe("api-m.sandbox.paypal.com");
    }
  });

  it("classifies rejected credentials as an auth error without leaking secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "invalid_client" }, 401)),
    );
    const error = await createPayPalSandboxOrder(input).catch((e) => e);
    expect(error).toBeInstanceOf(PayPalSandboxError);
    expect(error.kind).toBe("auth");
    expect(error.status).toBe(401);
    expect(error.message).not.toContain(SECRET);
  });

  it("rejects an order whose payee is not the configured merchant", async () => {
    installFetch(() => json(order({ merchant: "SOMEONEELSE1" })));
    await expect(createPayPalSandboxOrder(input)).rejects.toThrow(
      /receiving merchant/,
    );
  });

  it("rejects an order whose payee is missing", async () => {
    installFetch(() => json(order({ merchant: null })));
    await expect(createPayPalSandboxOrder(input)).rejects.toThrow(
      /receiving merchant/,
    );
  });

  it("rejects an amount that differs from the server catalog", async () => {
    installFetch(() => json(order({ amount: "0.01" })));
    await expect(createPayPalSandboxOrder(input)).rejects.toThrow(/amount/);
  });

  it("rejects an approval link that is not on a sandbox host", async () => {
    installFetch(() => json(order({ approveHost: "www.paypal.com" })));
    await expect(createPayPalSandboxOrder(input)).rejects.toThrow(/non-Sandbox/);
  });
});

describe("captureAndVerifyPayPalSandboxOrder", () => {
  const input = {
    orderId: ORDER_ID,
    paypalOrderId: PAYPAL_ORDER_ID,
    amountMinor: 6900,
    currency: "USD",
  };
  const isCapture = (c: Call) => c.method === "POST" && c.url.endsWith("/capture");

  it("captures an approved order and verifies the completed capture", async () => {
    let captured = false;
    installFetch((call) => {
      if (isCapture(call)) {
        captured = true;
        return json(order({ status: "COMPLETED", captureStatus: "COMPLETED" }), 201);
      }
      return json(
        captured
          ? order({ status: "COMPLETED", captureStatus: "COMPLETED" })
          : order({ status: "APPROVED" }),
      );
    });

    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result).toEqual({ status: "completed", verified: true, captureId: "CAP-1" });
    const capture = apiCalls().find(isCapture)!;
    expect(capture.headers["paypal-request-id"]).toBe(`capture-${ORDER_ID}`);
  });

  it("verifies an order that was already captured without capturing again", async () => {
    installFetch(() =>
      json(order({ status: "COMPLETED", captureStatus: "COMPLETED" })),
    );
    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result.verified).toBe(true);
    expect(apiCalls().some(isCapture)).toBe(false);
  });

  it("recovers when PayPal says the order was already captured (duplicate request)", async () => {
    let captureAttempted = false;
    installFetch((call) => {
      if (isCapture(call)) {
        captureAttempted = true;
        return paypalError(422, "ORDER_ALREADY_CAPTURED");
      }
      return json(
        captureAttempted
          ? order({ status: "COMPLETED", captureStatus: "COMPLETED" })
          : order({ status: "APPROVED" }),
      );
    });
    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result).toEqual({ status: "completed", verified: true, captureId: "CAP-1" });
  });

  it("does not hide other capture failures", async () => {
    installFetch((call) =>
      isCapture(call)
        ? paypalError(422, "INSTRUMENT_DECLINED")
        : json(order({ status: "APPROVED" })),
    );
    await expect(captureAndVerifyPayPalSandboxOrder(input)).rejects.toMatchObject({
      issue: "INSTRUMENT_DECLINED",
    });
  });

  it("treats an order the buyer has not approved yet as pending, not failed", async () => {
    installFetch(() => json(order({ status: "CREATED" })));
    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result).toEqual({ status: "pending", verified: false, captureId: null });
    expect(apiCalls().some(isCapture)).toBe(false);
  });

  it("treats a capture still under review as pending, never completed", async () => {
    installFetch(() =>
      json(order({ status: "COMPLETED", captureStatus: "PENDING" })),
    );
    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result.status).toBe("pending");
    expect(result.verified).toBe(false);
  });

  it("fails verification when the captured amount differs", async () => {
    installFetch(() =>
      json(
        order({ status: "COMPLETED", captureStatus: "COMPLETED", captureAmount: "1.00" }),
      ),
    );
    const result = await captureAndVerifyPayPalSandboxOrder(input);
    expect(result).toEqual({ status: "failed", verified: false, captureId: null });
  });

  it("fails verification when the payee is not the configured merchant", async () => {
    installFetch(() =>
      json(
        order({ status: "COMPLETED", captureStatus: "COMPLETED", merchant: "OTHERMERCH01" }),
      ),
    );
    expect((await captureAndVerifyPayPalSandboxOrder(input)).verified).toBe(false);
  });

  it("fails verification for a voided order", async () => {
    installFetch(() => json(order({ status: "VOIDED" })));
    expect((await captureAndVerifyPayPalSandboxOrder(input)).status).toBe("failed");
  });
});

describe("diagnosePayPalSandbox", () => {
  const apiOrder = () => json(order({}), 201);

  it("reports missing variable names and makes no network call", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "");
    vi.stubEnv("PAYPAL_MERCHANT_ID", "");
    installFetch(() => undefined);
    const result = await diagnosePayPalSandbox();
    expect(result.code).toBe("not_configured");
    expect(result.missing).toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_MERCHANT_ID"]);
    expect(calls).toHaveLength(0);
  });

  it("identifies rejected credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_client" }, 401)));
    const result = await diagnosePayPalSandbox();
    expect(result).toMatchObject({ ok: false, code: "auth_failed", paypalStatus: 401 });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("identifies a merchant ID that does not match, with masked hints only", async () => {
    vi.stubEnv("PAYPAL_MERCHANT_ID", "WRONGMERCH999");
    installFetch(() => apiOrder());
    const result = await diagnosePayPalSandbox();
    expect(result.code).toBe("merchant_mismatch");
    expect(result.paypalMerchantHint).toBe(maskIdentifier(MERCHANT));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MERCHANT);
    expect(serialized).not.toContain("WRONGMERCH999");
    expect(serialized).not.toContain(SECRET);
  });

  it("reports success and never approves or captures anything", async () => {
    installFetch(() => apiOrder());
    const result = await diagnosePayPalSandbox();
    expect(result).toMatchObject({ ok: true, code: "ok" });
    expect(apiCalls()).toHaveLength(1);
    expect(apiCalls()[0].method).toBe("POST");
    expect(apiCalls()[0].url).toMatch(/\/v2\/checkout\/orders$/);
  });

  it("flags a response without any payee", async () => {
    installFetch(() => json(order({ merchant: null }), 201));
    expect((await diagnosePayPalSandbox()).code).toBe("merchant_unavailable");
  });

  it("flags PayPal refusing the test order", async () => {
    installFetch(() => paypalError(403, "PERMISSION_DENIED"));
    expect((await diagnosePayPalSandbox()).code).toBe("paypal_error");
  });

  it("reports unreachable PayPal as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await diagnosePayPalSandbox()).code).toBe("network_error");
  });
});

describe("maskIdentifier", () => {
  it("keeps only the edges of an identifier", () => {
    expect(maskIdentifier("ABCDEFGHIJKLM")).toBe("AB••••••LM");
    expect(maskIdentifier("ABCD")).toBe("••••");
  });
});


describe("getPayPalSandboxOrderStatus", () => {
  const input = {
    orderId: ORDER_ID,
    paypalOrderId: PAYPAL_ORDER_ID,
    amountMinor: 6900,
    currency: "USD",
  };

  it("only reports completed when PayPal order, capture, amount, currency and payee match", async () => {
    installFetch(() => json(order({ status: "COMPLETED", captureStatus: "COMPLETED" })));
    await expect(getPayPalSandboxOrderStatus(input)).resolves.toEqual({
      providerStatus: "COMPLETED",
      status: "completed",
      verified: true,
      captureId: "CAP-1",
    });
    expect(apiCalls()).toHaveLength(1);
    expect(apiCalls()[0].method).toBe("GET");
  });

  it("does not verify a completed order when the capture amount differs", async () => {
    installFetch(() => json(order({ status: "COMPLETED", captureStatus: "COMPLETED", captureAmount: "1.00" })));
    await expect(getPayPalSandboxOrderStatus(input)).resolves.toMatchObject({
      status: "failed",
      verified: false,
      captureId: null,
    });
  });
});
