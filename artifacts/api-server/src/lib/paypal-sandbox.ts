import { randomUUID } from "node:crypto";

const sandboxApi = "https://api-m.sandbox.paypal.com";

interface PayPalLink {
  rel?: string;
  href?: string;
}

interface PayPalAmount {
  currency_code?: string;
  value?: string;
}

interface PayPalCaptureRecord {
  id?: string;
  status?: string;
  amount?: PayPalAmount;
}

interface PayPalPurchaseUnit {
  reference_id?: string;
  amount?: PayPalAmount;
  payee?: { merchant_id?: string };
  payments?: { captures?: PayPalCaptureRecord[] };
}

interface PayPalOrderRecord {
  id?: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: PayPalPurchaseUnit[];
}

export type PayPalErrorKind = "config" | "auth" | "api" | "verification";

export class PayPalSandboxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: PayPalErrorKind = "api",
    /** PayPal's machine-readable issue code (for example ORDER_ALREADY_CAPTURED). Never shown to buyers. */
    readonly issue?: string,
  ) {
    super(message);
    this.name = "PayPalSandboxError";
  }
}

const PAYPAL_ISSUE_PATTERN = /^[A-Z0-9_]{3,64}$/;

/** Extracts PayPal's issue code from an error body without trusting its shape. */
async function readIssueCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      name?: unknown;
      details?: Array<{ issue?: unknown }>;
    };
    const candidate = body.details?.[0]?.issue ?? body.name;
    return typeof candidate === "string" && PAYPAL_ISSUE_PATTERN.test(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

/** Names (never values) of the environment variables the Sandbox integration still needs. */
export function missingPayPalConfiguration(): string[] {
  const missing: string[] = [];
  if (process.env.PAYPAL_ENVIRONMENT !== "sandbox") {
    missing.push("PAYPAL_ENVIRONMENT (must be exactly \"sandbox\")");
  }
  for (const name of [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
  ] as const) {
    if (!process.env[name]) missing.push(name);
  }
  return missing;
}

export function isPayPalSandboxConfigured(): boolean {
  return missingPayPalConfiguration().length === 0;
}

function appOrigin(): string {
  // Local development must use an explicit browser-reachable origin because
  // Replit's domain variables are not present on a developer's machine.
  const configuredOrigin = process.env.PAYPILOT_APP_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error("Unsupported origin");
      }
      return parsed.origin;
    } catch {
      throw new PayPalSandboxError(
        "PAYPILOT_APP_ORIGIN must be a valid http(s) origin, such as http://localhost:23943.",
      );
    }
  }

  const domains =
    process.env.NODE_ENV === "production"
      ? process.env.REPLIT_DOMAINS
      : process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS;
  const domain = domains?.split(",").map((item) => item.trim()).find(Boolean);
  if (!domain) {
    if (process.env.NODE_ENV !== "production") {
      return `http://localhost:${process.env.WEB_PORT || "23943"}`;
    }
    throw new PayPalSandboxError(
      "The PayPal return URL cannot be resolved for this environment. Set PAYPILOT_APP_ORIGIN.",
    );
  }
  return domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let tokenRequestInFlight: Promise<string> | null = null;

/** @internal Test helper; never exposed through an HTTP route. */
export function resetPayPalTokenCacheForTests(): void {
  cachedAccessToken = null;
  tokenRequestInFlight = null;
}

async function accessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 15_000) {
    return cachedAccessToken.value;
  }
  if (tokenRequestInFlight) return tokenRequestInFlight;

  tokenRequestInFlight = requestAccessToken();
  try {
    return await tokenRequestInFlight;
  } finally {
    tokenRequestInFlight = null;
  }
}

async function requestAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (
    process.env.PAYPAL_ENVIRONMENT !== "sandbox" ||
    !clientId ||
    !clientSecret
  ) {
    throw new PayPalSandboxError(
      "PayPal Sandbox application credentials are not configured.",
      undefined,
      "config",
    );
  }

  const response = await fetch(`${sandboxApi}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new PayPalSandboxError(
      "PayPal Sandbox authentication failed.",
      response.status,
      "auth",
    );
  }
  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) {
    throw new PayPalSandboxError(
      "PayPal Sandbox did not return an access token.",
      response.status,
      "auth",
    );
  }
  const lifetimeSeconds = Number.isFinite(token.expires_in) ? Number(token.expires_in) : 300;
  cachedAccessToken = {
    value: token.access_token,
    // Refresh one minute early, with a small lower bound for unusual responses.
    expiresAt: Date.now() + Math.max(30, lifetimeSeconds - 60) * 1000,
  };
  return token.access_token;
}

async function paypalRequest<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  requestId?: string,
): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${sandboxApi}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new PayPalSandboxError(
      "PayPal Sandbox could not complete the requested checkout operation.",
      response.status,
      "api",
      await readIssueCode(response),
    );
  }
  return (await response.json()) as T;
}

function amountString(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function amountMinor(value?: string): number | null {
  if (!value || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fractional] = value.split(".");
  return Number(whole) * 100 + Number(fractional);
}

function purchaseUnitFor(
  order: PayPalOrderRecord,
  referenceId: string,
): PayPalPurchaseUnit | undefined {
  return (
    order.purchase_units?.find((unit) => unit.reference_id === referenceId) ??
    order.purchase_units?.[0]
  );
}

function validatePayee(unit: PayPalPurchaseUnit | undefined): boolean {
  return Boolean(
    unit?.payee?.merchant_id &&
      unit.payee.merchant_id === process.env.PAYPAL_MERCHANT_ID,
  );
}

export async function createPayPalSandboxOrder(input: {
  orderId: string;
  productName: string;
  amountMinor: number;
  currency: string;
}): Promise<{ paypalOrderId: string; approveUrl: string }> {
  if (!isPayPalSandboxConfigured()) {
    throw new PayPalSandboxError(
      "Sandbox client ID, secret, environment, and expected merchant ID are required.",
    );
  }

  const origin = appOrigin();
  const response = await paypalRequest<PayPalOrderRecord>(
    "/v2/checkout/orders",
    "POST",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId,
          description: `PayPilot Sandbox demo: ${input.productName}`,
          amount: {
            currency_code: input.currency,
            value: amountString(input.amountMinor),
          },
        },
      ],
      application_context: {
        brand_name: "PayPilot AI Demo Store",
        user_action: "PAY_NOW",
        return_url: `${origin}/checkout?paypilotOrderId=${encodeURIComponent(input.orderId)}`,
        cancel_url: `${origin}/checkout?cancelled=1&paypilotOrderId=${encodeURIComponent(input.orderId)}`,
      },
    },
    input.orderId,
  );

  const paypalOrderId = response.id;
  const unit = purchaseUnitFor(response, input.orderId);
  const link = response.links?.find(
    (candidate) => candidate.rel === "approve" || candidate.rel === "payer-action",
  );
  const approveUrl = link?.href;
  if (!paypalOrderId || !validatePayee(unit)) {
    throw new PayPalSandboxError(
      "PayPal Sandbox did not confirm the configured receiving merchant.",
    );
  }
  if (
    unit?.amount?.currency_code !== input.currency ||
    amountMinor(unit.amount.value) !== input.amountMinor
  ) {
    throw new PayPalSandboxError(
      "PayPal Sandbox returned an order amount that did not match the server catalog.",
    );
  }
  if (!approveUrl) {
    throw new PayPalSandboxError(
      "PayPal Sandbox did not return a buyer approval link.",
    );
  }
  const parsedUrl = new URL(approveUrl);
  if (
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname.endsWith(".paypal.com") ||
    !parsedUrl.hostname.includes("sandbox")
  ) {
    throw new PayPalSandboxError(
      "PayPal returned a non-Sandbox approval destination.",
    );
  }
  return { paypalOrderId, approveUrl };
}

export async function getPayPalSandboxOrderStatus(input: {
  orderId: string;
  paypalOrderId: string;
  amountMinor: number;
  currency: string;
}): Promise<{
  providerStatus: string;
  status: "completed" | "pending" | "failed";
  verified: boolean;
  captureId: string | null;
}> {
  if (!isPayPalSandboxConfigured()) {
    throw new PayPalSandboxError("PayPal Sandbox status verification is not configured.", undefined, "config");
  }
  const order = await paypalRequest<PayPalOrderRecord>(
    `/v2/checkout/orders/${encodeURIComponent(input.paypalOrderId)}`,
    "GET",
  );
  const unit = purchaseUnitFor(order, input.orderId);
  const capture = unit?.payments?.captures?.find((item) => item.status === "COMPLETED");
  const verified = Boolean(
    order.id === input.paypalOrderId &&
      order.status === "COMPLETED" &&
      capture?.id &&
      amountMinor(capture.amount?.value) === input.amountMinor &&
      capture.amount?.currency_code === input.currency &&
      validatePayee(unit),
  );
  if (verified && capture?.id) {
    return { providerStatus: order.status ?? "UNKNOWN", status: "completed", verified: true, captureId: capture.id };
  }
  const pending =
    ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(order.status ?? "") ||
    Boolean(unit?.payments?.captures?.some((item) => item.status === "PENDING"));
  return {
    providerStatus: order.status ?? "UNKNOWN",
    status: pending ? "pending" : "failed",
    verified: false,
    captureId: null,
  };
}

export async function captureAndVerifyPayPalSandboxOrder(input: {
  orderId: string;
  paypalOrderId: string;
  amountMinor: number;
  currency: string;
}): Promise<{
  status: "completed" | "pending" | "failed";
  verified: boolean;
  captureId: string | null;
}> {
  if (!isPayPalSandboxConfigured()) {
    throw new PayPalSandboxError(
      "PayPal Sandbox verification is not configured.",
    );
  }

  const encodedId = encodeURIComponent(input.paypalOrderId);
  let paypalOrder = await paypalRequest<PayPalOrderRecord>(
    `/v2/checkout/orders/${encodedId}`,
    "GET",
  );

  if (paypalOrder.status === "APPROVED") {
    try {
      await paypalRequest<PayPalOrderRecord>(
        `/v2/checkout/orders/${encodedId}/capture`,
        "POST",
        {},
        `capture-${input.orderId}`,
      );
    } catch (error) {
      // A concurrent or retried request may have captured this order already.
      // PayPal's guidance is to read the order back; the verification below
      // still decides the outcome, so nothing is assumed to be paid.
      if (
        !(error instanceof PayPalSandboxError) ||
        error.issue !== "ORDER_ALREADY_CAPTURED"
      ) {
        throw error;
      }
    }
    paypalOrder = await paypalRequest<PayPalOrderRecord>(
      `/v2/checkout/orders/${encodedId}`,
      "GET",
    );
  }

  const unit = purchaseUnitFor(paypalOrder, input.orderId);
  const capture = unit?.payments?.captures?.find(
    (item) => item.status === "COMPLETED",
  );
  const exactAmount =
    amountMinor(capture?.amount?.value) === input.amountMinor &&
    capture?.amount?.currency_code === input.currency;
  const verified = Boolean(
    paypalOrder.id === input.paypalOrderId &&
      paypalOrder.status === "COMPLETED" &&
      capture?.id &&
      exactAmount &&
      validatePayee(unit),
  );

  if (verified && capture?.id) {
    return { status: "completed", verified: true, captureId: capture.id };
  }
  // Anything PayPal still describes as in progress is pending, never failed:
  // an order that has not been approved yet (CREATED/SAVED/PAYER_ACTION_REQUIRED),
  // approved but not captured, or captured with a capture still under review.
  const inProgress =
    ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(
      paypalOrder.status ?? "",
    ) || Boolean(unit?.payments?.captures?.some((item) => item.status === "PENDING"));
  if (inProgress) {
    return { status: "pending", verified: false, captureId: null };
  }
  return { status: "failed", verified: false, captureId: null };
}


export type PayPalCheckCode =
  | "ok"
  | "not_configured"
  | "auth_failed"
  | "merchant_mismatch"
  | "merchant_unavailable"
  | "paypal_error"
  | "network_error";

export interface PayPalCheckResult {
  ok: boolean;
  code: PayPalCheckCode;
  message: string;
  /** Names of missing environment variables. Never their values. */
  missing?: string[];
  paypalStatus?: number;
  /** Masked identifiers so the right Sandbox account can be recognised without exposing it. */
  configuredMerchantHint?: string;
  paypalMerchantHint?: string;
}

export function maskIdentifier(value: string): string {
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(value.length - 4, 6))}${value.slice(-2)}`;
}

/**
 * Diagnoses the Sandbox configuration end to end without returning any secret:
 * environment variables -> OAuth -> a throwaway order that is never approved or
 * captured -> comparison of the payee PayPal reports with PAYPAL_MERCHANT_ID.
 * It never claims anything about payments.
 */
export async function diagnosePayPalSandbox(): Promise<PayPalCheckResult> {
  const missing = missingPayPalConfiguration();
  if (missing.length > 0) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "Set the missing variables in Replit Secrets (Sandbox values only), then run the check again.",
      missing,
    };
  }

  try {
    await accessToken();
  } catch (error) {
    if (error instanceof PayPalSandboxError && error.kind === "auth") {
      return {
        ok: false,
        code: "auth_failed",
        paypalStatus: error.status,
        message:
          "PayPal rejected the Client ID and Secret. Confirm both come from the same Sandbox REST app (not Live) and re-enter them without extra spaces.",
      };
    }
    return networkOrPayPalFailure(error);
  }

  let payeeMerchantId: string | undefined;
  try {
    const order = await paypalRequest<PayPalOrderRecord>(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "paypilot-config-check",
            description:
              "PayPilot Sandbox configuration check (never approved or captured)",
            amount: { currency_code: "USD", value: "1.00" },
          },
        ],
      },
      `config-check-${randomUUID()}`,
    );
    payeeMerchantId = order.purchase_units?.[0]?.payee?.merchant_id;
  } catch (error) {
    return networkOrPayPalFailure(error);
  }

  const configured = process.env.PAYPAL_MERCHANT_ID ?? "";
  if (!payeeMerchantId) {
    return {
      ok: false,
      code: "merchant_unavailable",
      message:
        "Authentication works, but PayPal did not report a receiving merchant ID on a test order, so checkout verification cannot be satisfied.",
      configuredMerchantHint: maskIdentifier(configured),
    };
  }
  if (payeeMerchantId !== configured) {
    return {
      ok: false,
      code: "merchant_mismatch",
      message:
        "Authentication works, but PAYPAL_MERCHANT_ID does not match the account that receives payments for this REST app. Use the Account ID of the Sandbox business account the app is attached to.",
      configuredMerchantHint: maskIdentifier(configured),
      paypalMerchantHint: maskIdentifier(payeeMerchantId),
    };
  }
  return {
    ok: true,
    code: "ok",
    message:
      "Sandbox authentication succeeded and the configured merchant ID matches the receiving account. A test order was created but never approved or captured; no payment was made.",
    configuredMerchantHint: maskIdentifier(configured),
    paypalMerchantHint: maskIdentifier(payeeMerchantId),
  };
}

function networkOrPayPalFailure(error: unknown): PayPalCheckResult {
  if (error instanceof PayPalSandboxError) {
    return {
      ok: false,
      code: "paypal_error",
      paypalStatus: error.status,
      message:
        "PayPal answered but would not create a Sandbox test order. Check that the REST app is a Sandbox app with Checkout enabled.",
    };
  }
  return {
    ok: false,
    code: "network_error",
    message:
      "PayPal could not be reached from the server (network error or timeout). Try again shortly.",
  };
}
