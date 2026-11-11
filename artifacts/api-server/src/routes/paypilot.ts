import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  AskAssistantBody,
  AskAssistantResponse,
  CaptureCheckoutOrderBody,
  CaptureCheckoutOrderParams,
  CaptureCheckoutOrderResponse,
  CheckPayPalSandboxResponse,
  CreateCheckoutOrderBody,
  CreateCheckoutOrderResponse,
  GetFxEstimateQueryParams,
  GetFxEstimateResponse,
  GetIntegrationStatusResponse,
  GetOverviewResponse,
  GetProductsResponse,
  GetSpendingAnalyticsQueryParams,
  GetSpendingAnalyticsResponse,
  GetTransactionParams,
  GetTransactionResponse,
  GetTransactionsQueryParams,
  GetTransactionsResponse,
  type FxEstimate,
  type Product,
  type Transaction,
} from "@workspace/api-zod";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { createRateLimiter } from "../middlewares/rate-limit";
import { db, pool, paypilotOrdersTable } from "@workspace/db";
import {
  captureAndVerifyPayPalSandboxOrder,
  getPayPalSandboxOrderStatus,
  createPayPalSandboxOrder,
  diagnosePayPalSandbox,
  isPayPalSandboxConfigured,
  PayPalSandboxError,
} from "../lib/paypal-sandbox";
import {
  buildOverviewActivity,
  buildSpendingAnalytics,
  currentMonthWindow,
  demoProducts,
  demoTransactions,
  findProducts,
  findTransactions,
  sortTransactions,
  sumCurrency,
} from "../lib/paypilot-data";

const router: IRouter = Router();
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function toOrderTransaction(order: {
  id: string;
  productName: string;
  amountMinor: number;
  currency: string;
  status: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  createdAt: Date;
}): Transaction {
  const status =
    order.status === "completed"
      ? "completed"
      : order.status === "failed" || order.status === "cancelled"
        ? "failed"
        : "pending";
  return {
    id: `paypilot-${order.id}`,
    date: order.createdAt,
    merchant: "PayPilot Demo Store",
    category: "Shopping",
    status,
    amountMinor: -order.amountMinor,
    currency: order.currency,
    source: "paypilot-order",
    description: `${order.productName} — PayPilot demo storefront`,
    reference: order.paypalCaptureId ?? order.paypalOrderId,
  };
}

type TransactionSnapshot = {
  items: Transaction[];
  databaseAvailable: boolean;
};

function safeDatabaseCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
  }
  return "DATABASE_QUERY_FAILED";
}

/**
 * Keep the read-only demo experience usable when PostgreSQL is temporarily
 * unavailable or its schema has not been pushed yet. The fallback is explicit:
 * only seeded synthetic rows are returned, and no write/payment path uses it.
 */
async function loadTransactions(req: Request): Promise<TransactionSnapshot> {
  try {
    const orders = await db
      .select()
      .from(paypilotOrdersTable)
      .orderBy(desc(paypilotOrdersTable.createdAt));
    return {
      items: sortTransactions([
        ...demoTransactions,
        ...orders.map(toOrderTransaction),
      ]),
      databaseAvailable: true,
    };
  } catch (error) {
    const code = safeDatabaseCode(error);
    req.log.warn(
      { databaseErrorCode: code },
      "Database unavailable while loading PayPilot transactions; serving labelled synthetic demo records only",
    );
    return { items: sortTransactions(demoTransactions), databaseAvailable: false };
  }
}

type AssistantProvider = "gemini" | "openai";

function hasRealApiKey(value: string | undefined): value is string {
  const key = value?.trim();
  return Boolean(key && !/^(replace-with|your-|paste-|<)/i.test(key));
}

function getAssistantProvider(): AssistantProvider | null {
  const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (requested === "gemini") {
    return hasRealApiKey(process.env.GEMINI_API_KEY) ? "gemini" : null;
  }
  if (requested === "openai") {
    return hasRealApiKey(process.env.OPENAI_API_KEY) ? "openai" : null;
  }
  if (requested) return null;
  // Gemini is the primary provider. Never silently switch to a different provider.
  if (hasRealApiKey(process.env.GEMINI_API_KEY)) return "gemini";
  return null;
}

function isAssistantConfigured(): boolean {
  return getAssistantProvider() !== null;
}

function getAssistantFacts(
  message: string,
  transactions: Transaction[],
): {
  products: Product[];
  transactions: Transaction[];
  analytics: ReturnType<typeof buildSpendingAnalytics> | null;
  sources: string[];
} {
  const normalized = message.toLowerCase();
  const isCatalogQuestion =
    /\b(find|recommend|buy|purchase|product|keyboard|store|catalog|under \$|budget)\b/i.test(
      message,
    );
  const products = isCatalogQuestion ? findProducts(message) : [];
  const isTransactionQuestion =
    /\b(transaction|payment|merchant|activity|received|receipt|spend|spending|account|revenue|income)\b/i.test(
      message,
    );
  const matchingTransactions = isTransactionQuestion
    ? findTransactions(transactions, "")
    : [];
  const isAnalyticsQuestion =
    /\b(spend|spending|category|compare|comparison|trend|weekly|monthly|revenue|received|income)\b/i.test(
      message,
    );
  const analytics = isAnalyticsQuestion
    ? buildSpendingAnalytics(transactions, "month")
    : null;
  const sources = new Set<string>();
  if (products.length > 0 || isCatalogQuestion) {
    sources.add("PayPilot curated demo catalog");
  }
  if (matchingTransactions.length > 0 || isTransactionQuestion) {
    sources.add(
      "Synthetic PayPilot demo records; not connected PayPal account activity",
    );
  }
  if (analytics) {
    sources.add(analytics.sourceLabel);
  }
  return {
    products,
    transactions: matchingTransactions.slice(0, 8),
    analytics,
    sources: [...sources],
  };
}

function deterministicAssistantReply(
  message: string,
  facts: ReturnType<typeof getAssistantFacts>,
): string {
  if (facts.products.length > 0) {
    const recommendation = facts.products[0];
    return `I found ${facts.products.length} available option${facts.products.length === 1 ? "" : "s"} in the PayPilot demo catalog. ${recommendation.name} is the best match at ${USD_FORMATTER.format(recommendation.priceMinor / 100)}. Review the product and total in Checkout; no purchase has been made.`;
  }
  if (facts.transactions.length > 0) {
    const latest = facts.transactions[0];
    return `I found ${facts.transactions.length} synthetic demo transaction records. The latest is ${latest.merchant} for ${USD_FORMATTER.format(Math.abs(latest.amountMinor) / 100)} on ${new Date(latest.date).toLocaleDateString("en-US")}. These are not live PayPal account records.`;
  }
  if (facts.analytics) {
    return `The synthetic demo records show ${USD_FORMATTER.format(facts.analytics.totalSpentMinor / 100)} in spending this month, compared with ${USD_FORMATTER.format(facts.analytics.priorPeriodSpentMinor / 100)} in the prior month. These are deterministic calculations over the labeled demo dataset, not connected account data.`;
  }
  return `I can help with the available demo transactions, spending summaries, the curated catalog, and indicative currency estimates. I only report information supported by PayPilot's available data.`;
}

function parseCurrencyQuestion(
  message: string,
): { amount: number; from: string; to: string } | null {
  const match = message.match(
    /(?:\$|USD\s*)?(\d+(?:\.\d{1,2})?)\s*(USD|INR|EUR|GBP|CAD|AUD|JPY)?\s*(?:to|in)\s*(USD|INR|EUR|GBP|CAD|AUD|JPY)\b/i,
  );
  if (!match) return null;
  const from = (match[2] ?? (message.includes("$") ? "USD" : "USD")).toUpperCase();
  const to = match[3].toUpperCase();
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, from, to };
}

const demoRates: Record<string, number> = {
  "USD:INR": 83.5,
  "INR:USD": 1 / 83.5,
  "EUR:USD": 1.08,
  "USD:EUR": 1 / 1.08,
  "GBP:USD": 1.27,
  "USD:GBP": 1 / 1.27,
};

async function resolveFxEstimate(
  amount: number,
  from: string,
  to: string,
): Promise<FxEstimate | null> {
  if (from === to) {
    return {
      amount,
      from,
      to,
      rate: 1,
      convertedAmount: amount,
      rateSource: "Same-currency calculation",
      timestamp: new Date(),
      kind: "indicative",
      feeNote: "No conversion is needed. No transfer fee or payment quote is included.",
    };
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
    const data = (await response.json()) as {
      date?: string;
      base?: string;
      rates?: Record<string, number>;
    };
    const rate = data.rates?.[to];
    if (!rate || !Number.isFinite(rate) || rate <= 0 || !data.date) {
      throw new Error("FX provider response did not include a valid rate");
    }
    return {
      amount,
      from,
      to,
      rate,
      convertedAmount: Math.round(amount * rate * 100) / 100,
      rateSource: "Frankfurter reference rate (ECB data)",
      timestamp: new Date(`${data.date}T00:00:00.000Z`),
      kind: "indicative",
      feeNote:
        "Indicative conversion only. No PayPal fee, transfer quote, eligibility, or delivery time was provided.",
    };
  } catch {
    const demoRate = demoRates[`${from}:${to}`];
    if (!demoRate) return null;
    return {
      amount,
      from,
      to,
      rate: demoRate,
      convertedAmount: Math.round(amount * demoRate * 100) / 100,
      rateSource: "PayPilot demonstration rate — not live",
      timestamp: new Date(),
      kind: "indicative",
      feeNote:
        "This is a labeled demonstration estimate, not a PayPal quote or executable transfer. Fees and recipient amount are unknown.",
    };
  }
}

router.get("/overview", async (req, res): Promise<void> => {
  const snapshot = await loadTransactions(req);
  const transactions = snapshot.items;
  const [monthStart, monthEnd] = currentMonthWindow();
  const currentSpent = sumCurrency(transactions, "out", monthStart, monthEnd);
  const overview = {
    mode: "sandbox-demo" as const,
    sourceLabel: snapshot.databaseAvailable
      ? "Synthetic demo data and PayPilot-created orders only — no connected PayPal account activity"
      : "Database unavailable — synthetic demo records only; PayPilot orders are temporarily unavailable",
    transactions: transactions.slice(0, 6),
    receivedThisMonthMinor: sumCurrency(
      transactions,
      "in",
      monthStart,
      monthEnd,
    ),
    spentThisMonthMinor: currentSpent,
    monthlyChangePercent: buildSpendingAnalytics(transactions, "month").changePercent,
    activity: buildOverviewActivity(transactions),
  };
  req.log.info("Loaded PayPilot demo overview");
  res.json(GetOverviewResponse.parse(overview));
});

router.get("/transactions", async (req, res): Promise<void> => {
  const parsed = GetTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let transactions = (await loadTransactions(req)).items;
  if (parsed.data.status) {
    transactions = transactions.filter(
      (item) => item.status === parsed.data.status,
    );
  }
  if (parsed.data.search) {
    transactions = findTransactions(transactions, parsed.data.search);
  }
  res.json(GetTransactionsResponse.parse(transactions));
});

router.get("/transactions/:transactionId", async (req, res): Promise<void> => {
  const params = GetTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const transaction = (await loadTransactions(req)).items.find(
    (item) => item.id === params.data.transactionId,
  );
  if (!transaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(GetTransactionResponse.parse(transaction));
});

router.get("/analytics/spending", async (req, res): Promise<void> => {
  const parsed = GetSpendingAnalyticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const period = parsed.data.period ?? "month";
  const snapshot = await loadTransactions(req);
  const summary = buildSpendingAnalytics(snapshot.items, period);
  if (!snapshot.databaseAvailable) {
    summary.sourceLabel = "Database unavailable — synthetic demo records only; PayPilot orders are temporarily unavailable";
  }
  res.json(GetSpendingAnalyticsResponse.parse(summary));
});

router.get("/catalog/products", (_req, res): void => {
  res.json(GetProductsResponse.parse(demoProducts));
});

router.get("/fx/estimate", async (req, res): Promise<void> => {
  const parsed = GetFxEstimateQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const estimate = await resolveFxEstimate(
    parsed.data.amount,
    parsed.data.from,
    parsed.data.to,
  );
  if (!estimate) {
    res.status(502).json({
      error:
        "A live rate was unavailable and no demonstration rate is configured for this currency pair.",
    });
    return;
  }
  res.json(GetFxEstimateResponse.parse(estimate));
});

const assistantRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many assistant requests. Please wait a minute and try again.",
});
const checkoutCreateRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 8,
  message: "Too many checkout attempts. Please wait a minute before trying again.",
});
const checkoutCaptureRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  message: "Too many capture attempts. Please wait a minute and try again.",
});
const checkoutStatusRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Too many order status refreshes. Please wait a minute and try again.",
});
const checkoutCancelRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many cancellation attempts. Please wait a minute and try again.",
});

router.post("/assistant", assistantRateLimit, async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const message = parsed.data.message.trim();
  if (!message) {
    res.status(400).json({ error: "Enter a question for the assistant." });
    return;
  }

  const snapshot = await loadTransactions(req);
  const transactions = snapshot.items;
  const facts = getAssistantFacts(message, transactions);
  if (!snapshot.databaseAvailable) {
    facts.sources.push("Database unavailable; synthetic demo records only (PayPilot orders not loaded)");
  }
  const currencyQuestion = parseCurrencyQuestion(message);
  let fxEstimate: FxEstimate | null = null;
  if (currencyQuestion) {
    fxEstimate = await resolveFxEstimate(
      currencyQuestion.amount,
      currencyQuestion.from,
      currencyQuestion.to,
    );
    if (fxEstimate) facts.sources.push(fxEstimate.rateSource);
  }

  let reply: string;
  let mode: "gemini" | "openai" | "demo-fallback";
  const provider = getAssistantProvider();
  if (provider) {
    try {
      const openai = new OpenAI({
        apiKey: provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
        ...(provider === "gemini"
          ? { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" }
          : {}),
      });
      const model = provider === "gemini"
        ? process.env.GEMINI_MODEL ?? "gemini-3.8-flash"
        : process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "search_demo_catalog",
            description:
              "Search the trusted PayPilot demo catalog. This only recommends products; it never creates an order.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Product type or features to search for.",
                },
                maxPriceMinor: {
                  type: "integer",
                  description: "Optional maximum price in USD cents.",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_available_transactions",
            description:
              "Search only the available synthetic PayPilot demo records and PayPilot-created orders.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Merchant, category, ID, or reference.",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "calculate_spending_summary",
            description:
              "Calculate deterministic spending totals from available records for a supported period.",
            parameters: {
              type: "object",
              properties: {
                period: { type: "string", enum: ["week", "month", "quarter"] },
              },
              required: ["period"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_indicative_currency_estimate",
            description:
              "Fetch an indicative published exchange-rate estimate. This is not a PayPal quote or a money transfer.",
            parameters: {
              type: "object",
              properties: {
                amount: {
                  type: "number",
                  exclusiveMinimum: 0,
                  maximum: 10000000,
                },
                from: { type: "string", pattern: "^[A-Z]{3}$" },
                to: { type: "string", pattern: "^[A-Z]{3}$" },
              },
              required: ["amount", "from", "to"],
              additionalProperties: false,
            },
          },
        },
      ];
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content:
            "You are PayPilot AI, an independent financial demo, not an official PayPal product. Use only supplied facts and the constrained workspace tools. Transaction data is synthetic unless explicitly labeled otherwise. Never invent amounts, rates, fees, payment eligibility, or delivery times. Never initiate a payment or claim one succeeded. A product recommendation is not a purchase: the user must review the exact server-priced total and approve through PayPal Sandbox. Clearly state source and data limitations.",
        },
        ...(parsed.data.history ?? []).map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        {
          role: "user",
          content: JSON.stringify({
            question: message,
            facts: {
              transactions: facts.transactions,
              products: facts.products,
              spending: facts.analytics,
              indicativeFxEstimate: fxEstimate,
              sourceScope:
                "Synthetic PayPilot demo records; no connected personal PayPal account history.",
            },
          }),
        },
      ];
      let result = await openai.chat.completions.create({
        model,
        max_tokens: 1024,
        messages,
        tools,
        tool_choice: "auto",
      });

      for (let round = 0; round < 2; round += 1) {
        const assistantMessage = result.choices[0]?.message;
        const calls = assistantMessage?.tool_calls;
        if (!assistantMessage || !calls?.length) break;
        messages.push(assistantMessage);

        for (const call of calls) {
          if (call.type !== "function") continue;
          let args: Record<string, unknown> = {};
          try {
            const parsedArgs: unknown = JSON.parse(call.function.arguments);
            if (
              parsedArgs &&
              typeof parsedArgs === "object" &&
              !Array.isArray(parsedArgs)
            ) {
              args = parsedArgs as Record<string, unknown>;
            }
          } catch {
            args = {};
          }

          let output: unknown = { error: "Unsupported or invalid tool request." };
          if (
            call.function.name === "search_demo_catalog" &&
            typeof args.query === "string" &&
            args.query.length <= 120 &&
            (args.maxPriceMinor === undefined ||
              (Number.isInteger(args.maxPriceMinor) &&
                Number(args.maxPriceMinor) >= 0))
          ) {
            facts.products = findProducts(args.query)
              .filter(
                (product) =>
                  args.maxPriceMinor === undefined ||
                  product.priceMinor <= Number(args.maxPriceMinor),
              )
              .slice(0, 5);
            facts.sources.push("PayPilot curated demo catalog");
            output = { products: facts.products };
          } else if (
            call.function.name === "search_available_transactions" &&
            typeof args.query === "string" &&
            args.query.length <= 120
          ) {
            facts.transactions = findTransactions(
              transactions,
              args.query,
            ).slice(0, 8);
            facts.sources.push(
              "Synthetic PayPilot demo records; not connected PayPal account activity",
            );
            output = { transactions: facts.transactions };
          } else if (
            call.function.name === "calculate_spending_summary" &&
            (args.period === "week" ||
              args.period === "month" ||
              args.period === "quarter")
          ) {
            facts.analytics = buildSpendingAnalytics(
              transactions,
              args.period,
            );
            facts.sources.push(facts.analytics.sourceLabel);
            output = { spending: facts.analytics };
          } else if (
            call.function.name === "get_indicative_currency_estimate" &&
            typeof args.amount === "number" &&
            Number.isFinite(args.amount) &&
            args.amount > 0 &&
            args.amount <= 10000000 &&
            typeof args.from === "string" &&
            /^[A-Z]{3}$/.test(args.from) &&
            typeof args.to === "string" &&
            /^[A-Z]{3}$/.test(args.to)
          ) {
            const estimate = await resolveFxEstimate(
              args.amount,
              args.from,
              args.to,
            );
            if (estimate) {
              facts.sources.push(estimate.rateSource);
              output = { estimate };
            } else {
              output = {
                error:
                  "No supported estimate is available for that currency pair.",
              };
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(output),
          });
        }

        result = await openai.chat.completions.create({
          model,
          max_tokens: 1024,
          messages,
          tools,
          tool_choice: "auto",
        });
      }

      reply =
        result.choices[0]?.message.content?.trim() ||
        deterministicAssistantReply(message, facts);
      mode = provider;
    } catch (error) {
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : undefined;
      req.log.warn({ status, provider }, "AI assistant provider call failed");
      reply = `${deterministicAssistantReply(message, facts)} The AI provider was unavailable, so this is a deterministic demo summary.`;
      mode = "demo-fallback";
    }
  } else {
    reply = `${deterministicAssistantReply(message, facts)} The AI provider is not configured; this is a deterministic demo response.`;
    mode = "demo-fallback";
  }

  res.json(
    AskAssistantResponse.parse({
      reply,
      mode,
      sources: facts.sources,
      products: facts.products,
      transactions: facts.transactions,
    }),
  );
});

router.get("/settings/status", (_req, res): void => {
  const paypalConfigured = isPayPalSandboxConfigured();
  res.json(
    GetIntegrationStatusResponse.parse({
      environment: "sandbox-demo",
      aiConfigured: isAssistantConfigured(),
      paypalConfigured,
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      accountDataLabel:
        "Synthetic demo records only. PayPal account history is not connected.",
    }),
  );
});

// Developer diagnostics expose operational state, never credentials or raw provider errors.
router.get("/settings/diagnostics", async (req, res): Promise<void> => {
  const provider = getAssistantProvider();
  const model = provider === "gemini"
    ? process.env.GEMINI_MODEL ?? "gemini-3.8-flash"
    : provider === "openai"
      ? process.env.OPENAI_MODEL ?? "configured-openai-model"
      : null;

  let databaseReachable = false;
  let ordersTableAvailable = false;
  let databaseErrorCode: string | null = null;
  if (process.env.DATABASE_URL) {
    try {
      await pool.query({ text: "SELECT 1", query_timeout: 3000 });
      databaseReachable = true;
      try {
        await pool.query({ text: "SELECT 1 FROM paypilot_orders LIMIT 1", query_timeout: 3000 });
        ordersTableAvailable = true;
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        databaseErrorCode = typeof code === "string" ? code : "orders_table_check_failed";
        req.log.warn({ databaseErrorCode }, "PayPilot database is reachable but the orders table check failed");
      }
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      databaseErrorCode = typeof code === "string" ? code : "database_connection_failed";
      req.log.warn({ databaseErrorCode }, "PayPilot database connectivity check failed");
    }
  }

  res.json({
    status: "diagnostic-only",
    ai: { configured: Boolean(provider), provider: provider ?? "none", model },
    paypal: { configured: isPayPalSandboxConfigured(), environment: "sandbox" },
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      reachable: databaseReachable,
      ordersTableAvailable,
      errorCode: databaseErrorCode,
    },
    dataScope: "Synthetic demo records and PayPilot-created Sandbox orders only; no connected PayPal account history.",
    warnings: [
      "No user authentication is configured. Do not expose this instance with real or private customer data.",
      "Rate limiting is in-memory per server process and is not a substitute for a shared production limiter.",
    ],
  });
});

let lastPayPalCheckAt = 0;
router.post("/settings/paypal-check", async (req, res): Promise<void> => {
  const now = Date.now();
  if (now - lastPayPalCheckAt < 5000) {
    res.status(429).json({
      error: "The PayPal check ran moments ago. Wait a few seconds and try again.",
    });
    return;
  }
  lastPayPalCheckAt = now;
  const result = await diagnosePayPalSandbox();
  req.log.info(
    { code: result.code, paypalStatus: result.paypalStatus },
    "PayPal Sandbox configuration check",
  );
  res.json(CheckPayPalSandboxResponse.parse(result));
});

router.post("/checkout/orders", checkoutCreateRateLimit, async (req, res): Promise<void> => {
  const parsed = CreateCheckoutOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const product = demoProducts.find(
    (candidate) => candidate.id === parsed.data.productId,
  );
  if (!product || !product.available) {
    res.status(400).json({ error: "This product is not available." });
    return;
  }
  const id = randomUUID();
  const amountMinor = product.priceMinor * parsed.data.quantity;
  if (!isPayPalSandboxConfigured()) {
    res.status(503).json({
      error:
        "PayPal Sandbox is not configured. No order has been sent to PayPal.",
    });
    return;
  }
  const [order] = await db
    .insert(paypilotOrdersTable)
    .values({
      id,
      productId: product.id,
      productName: product.name,
      quantity: parsed.data.quantity,
      amountMinor,
      currency: product.currency,
      status: "prepared",
      paypalOrderId: null,
      paypalCaptureId: null,
    })
    .returning();

  if (!order) {
    res.status(500).json({ error: "The demo order could not be saved." });
    return;
  }

  let paypalOrder: { paypalOrderId: string; approveUrl: string };
  try {
    paypalOrder = await createPayPalSandboxOrder({
      orderId: id,
      productName: product.name,
      amountMinor,
      currency: product.currency,
    });
  } catch (error) {
    await db
      .update(paypilotOrdersTable)
      .set({ status: "failed" })
      .where(eq(paypilotOrdersTable.id, id));
    const status =
      error instanceof PayPalSandboxError ? error.status : undefined;
    req.log.warn({ orderId: id, status }, "PayPal Sandbox order creation failed");
    res.status(503).json({
      error:
        "PayPal Sandbox could not prepare an approval order. No payment was captured.",
    });
    return;
  }

  const [updatedOrder] = await db
    .update(paypilotOrdersTable)
    .set({
      status: "approval-pending",
      paypalOrderId: paypalOrder.paypalOrderId,
    })
    .where(eq(paypilotOrdersTable.id, id))
    .returning();
  if (!updatedOrder) {
    res.status(500).json({ error: "The order state could not be saved." });
    return;
  }

  req.log.info(
    { orderId: id, productId: product.id },
    "Created PayPal Sandbox buyer-approval order",
  );
  res.status(201).json(
    CreateCheckoutOrderResponse.parse({
      id: updatedOrder.id,
      productId: updatedOrder.productId,
      productName: updatedOrder.productName,
      quantity: updatedOrder.quantity,
      amountMinor: updatedOrder.amountMinor,
      currency: updatedOrder.currency,
      status: "approval-pending",
      paypalOrderId: paypalOrder.paypalOrderId,
      approveUrl: paypalOrder.approveUrl,
    }),
  );
});

router.get("/checkout/orders/:orderId", checkoutStatusRateLimit, async (req, res): Promise<void> => {
  const params = CaptureCheckoutOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db
    .select()
    .from(paypilotOrdersTable)
    .where(eq(paypilotOrdersTable.id, params.data.orderId))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  let providerStatus: string | null = null;
  let verified = order.status === "completed" && Boolean(order.paypalCaptureId);
  let currentStatus = order.status;
  let currentCaptureId = order.paypalCaptureId;
  if (order.paypalOrderId && isPayPalSandboxConfigured() && order.status !== "completed") {
    try {
      const result = await getPayPalSandboxOrderStatus({
        orderId: order.id,
        paypalOrderId: order.paypalOrderId,
        amountMinor: order.amountMinor,
        currency: order.currency,
      });
      providerStatus = result.providerStatus;
      if (result.verified && result.captureId) {
        const [updated] = await db
          .update(paypilotOrdersTable)
          .set({ status: "completed", paypalCaptureId: result.captureId })
          .where(eq(paypilotOrdersTable.id, order.id))
          .returning();
        if (updated) {
          currentStatus = updated.status;
          currentCaptureId = updated.paypalCaptureId;
        }
        verified = Boolean(updated);
      } else if (result.status === "failed" && order.status !== "cancelled") {
        const [updated] = await db
          .update(paypilotOrdersTable)
          .set({ status: "failed" })
          .where(eq(paypilotOrdersTable.id, order.id))
          .returning();
        if (updated) currentStatus = updated.status;
      } else if (result.status === "pending" && order.status !== "cancelled" && order.status !== "completed") {
        const [updated] = await db
          .update(paypilotOrdersTable)
          .set({ status: "approval-pending" })
          .where(eq(paypilotOrdersTable.id, order.id))
          .returning();
        if (updated) currentStatus = updated.status;
      }
    } catch (error) {
      req.log.warn(
        { orderId: order.id, paypalStatus: error instanceof PayPalSandboxError ? error.status : undefined },
        "Could not refresh PayPal order status; returning last persisted state",
      );
    }
  }
  res.json({
    orderId: order.id,
    paypalOrderId: order.paypalOrderId,
    status: currentStatus,
    providerStatus,
    amountMinor: order.amountMinor,
    currency: order.currency,
    verified,
    captureId: currentStatus === "completed" ? currentCaptureId : null,
    refreshedAt: new Date().toISOString(),
  });
});

router.post("/checkout/orders/:orderId/cancel", checkoutCancelRateLimit, async (req, res): Promise<void> => {
  const params = CaptureCheckoutOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db
    .select()
    .from(paypilotOrdersTable)
    .where(eq(paypilotOrdersTable.id, params.data.orderId))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (order.status === "completed" || order.paypalCaptureId) {
    res.status(409).json({ error: "This order already has a verified capture and cannot be marked cancelled." });
    return;
  }
  const [cancelled] = await db
    .update(paypilotOrdersTable)
    .set({ status: "cancelled" })
    .where(eq(paypilotOrdersTable.id, order.id))
    .returning();
  if (!cancelled) {
    res.status(500).json({ error: "The cancellation state could not be saved." });
    return;
  }
  req.log.info({ orderId: order.id }, "Buyer returned from PayPal approval without completing checkout");
  res.json({ orderId: cancelled.id, status: "cancelled", paymentCaptured: false });
});

router.post(
  "/checkout/orders/:orderId/capture",
  checkoutCaptureRateLimit,
  async (req, res): Promise<void> => {
    const params = CaptureCheckoutOrderParams.safeParse(req.params);
    const body = CaptureCheckoutOrderBody.safeParse(req.body);
    if (!params.success || !body.success) {
      const errorMessage = !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Invalid capture request.";
      res.status(400).json({ error: errorMessage });
      return;
    }
    const [order] = await db
      .select()
      .from(paypilotOrdersTable)
      .where(eq(paypilotOrdersTable.id, params.data.orderId))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (!order.paypalOrderId || order.paypalOrderId !== body.data.paypalOrderId) {
      res.status(400).json({
        error:
          "This order has no matching PayPal approval reference. No payment was captured.",
      });
      return;
    }
    if (order.status === "completed" && order.paypalCaptureId) {
      const transaction = toOrderTransaction(order);
      res.json(
        CaptureCheckoutOrderResponse.parse({
          orderId: order.id,
          paypalOrderId: order.paypalOrderId,
          status: "completed",
          amountMinor: order.amountMinor,
          currency: order.currency,
          verified: true,
          transaction,
        }),
      );
      return;
    }

    if (!isPayPalSandboxConfigured()) {
      res.status(503).json({
        error:
          "PayPal Sandbox verification is not configured. No payment will be reported as complete.",
      });
      return;
    }
    let result: Awaited<ReturnType<typeof captureAndVerifyPayPalSandboxOrder>>;
    try {
      result = await captureAndVerifyPayPalSandboxOrder({
        orderId: order.id,
        paypalOrderId: order.paypalOrderId,
        amountMinor: order.amountMinor,
        currency: order.currency,
      });
    } catch (error) {
      const status =
        error instanceof PayPalSandboxError ? error.status : undefined;
      req.log.warn({ orderId: order.id, status }, "PayPal capture verification failed");
      res.status(503).json({
        error:
          "PayPal Sandbox could not verify the approved order. No payment success is claimed.",
      });
      return;
    }

    if (result.verified && result.captureId) {
      const [completedOrder] = await db
        .update(paypilotOrdersTable)
        .set({
          status: "completed",
          paypalCaptureId: result.captureId,
        })
        .where(eq(paypilotOrdersTable.id, order.id))
        .returning();
      if (!completedOrder) {
        res.status(500).json({
          error:
            "The PayPal capture was verified but the local order state could not be saved.",
        });
        return;
      }
      res.json(
        CaptureCheckoutOrderResponse.parse({
          orderId: completedOrder.id,
          paypalOrderId: completedOrder.paypalOrderId,
          status: "completed",
          amountMinor: completedOrder.amountMinor,
          currency: completedOrder.currency,
          verified: true,
          transaction: toOrderTransaction(completedOrder),
        }),
      );
      return;
    }

    const status = result.status;
    if (status === "failed") {
      await db
        .update(paypilotOrdersTable)
        .set({ status: "failed" })
        .where(eq(paypilotOrdersTable.id, order.id));
    }
    res.json(
      CaptureCheckoutOrderResponse.parse({
        orderId: order.id,
        paypalOrderId: order.paypalOrderId,
        status,
        amountMinor: order.amountMinor,
        currency: order.currency,
        verified: false,
        transaction: null,
      }),
    );
  },
);

export default router;
