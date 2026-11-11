import type {
  ActivityPoint,
  CategoryTotal,
  Product,
  SpendingAnalytics,
  Transaction,
} from "@workspace/api-zod";

const ago = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

export const demoTransactions: Transaction[] = [
  {
    id: "demo-txn-1001",
    date: ago(1),
    merchant: "Northstar Audio",
    category: "Electronics",
    status: "completed",
    amountMinor: -6899,
    currency: "USD",
    source: "seeded-demo",
    description: "Wireless earbuds — synthetic demo record",
    reference: "DEMO-64021",
  },
  {
    id: "demo-txn-1002",
    date: ago(3),
    merchant: "Juniper Coffee",
    category: "Dining",
    status: "completed",
    amountMinor: -1460,
    currency: "USD",
    source: "seeded-demo",
    description: "Cafe purchase — synthetic demo record",
    reference: "DEMO-64022",
  },
  {
    id: "demo-txn-1003",
    date: ago(5),
    merchant: "Studio Field",
    category: "Income",
    status: "completed",
    amountMinor: 21250,
    currency: "USD",
    source: "seeded-demo",
    description: "Incoming project payment — synthetic demo record",
    reference: "DEMO-64023",
  },
  {
    id: "demo-txn-1004",
    date: ago(8),
    merchant: "Everyday Market",
    category: "Groceries",
    status: "completed",
    amountMinor: -5238,
    currency: "USD",
    source: "seeded-demo",
    description: "Market purchase — synthetic demo record",
    reference: "DEMO-64024",
  },
  {
    id: "demo-txn-1005",
    date: ago(11),
    merchant: "Streamline Media",
    category: "Subscriptions",
    status: "completed",
    amountMinor: -1299,
    currency: "USD",
    source: "seeded-demo",
    description: "Monthly media subscription — synthetic demo record",
    reference: "DEMO-64025",
  },
  {
    id: "demo-txn-1006",
    date: ago(17),
    merchant: "Studio Field",
    category: "Income",
    status: "completed",
    amountMinor: 8000,
    currency: "USD",
    source: "seeded-demo",
    description: "Incoming project payment — synthetic demo record",
    reference: "DEMO-64026",
  },
  {
    id: "demo-txn-1007",
    date: ago(24),
    merchant: "Juniper Coffee",
    category: "Dining",
    status: "completed",
    amountMinor: -2150,
    currency: "USD",
    source: "seeded-demo",
    description: "Cafe purchase — synthetic demo record",
    reference: "DEMO-64027",
  },
  {
    id: "demo-txn-1008",
    date: ago(35),
    merchant: "Westward Outfitters",
    category: "Shopping",
    status: "completed",
    amountMinor: -12000,
    currency: "USD",
    source: "seeded-demo",
    description: "Outdoor gear purchase — synthetic demo record",
    reference: "DEMO-64028",
  },
  {
    id: "demo-txn-1009",
    date: ago(39),
    merchant: "Studio Field",
    category: "Income",
    status: "completed",
    amountMinor: 27500,
    currency: "USD",
    source: "seeded-demo",
    description: "Incoming project payment — synthetic demo record",
    reference: "DEMO-64029",
  },
];

export const demoProducts: Product[] = [
  {
    id: "aerokeys-k75",
    name: "AeroKeys K75",
    category: "Keyboards",
    description:
      "A compact wireless mechanical keyboard with tactile switches and a quiet, sturdy aluminum frame.",
    priceMinor: 6900,
    currency: "USD",
    available: true,
    accent: "blue",
  },
  {
    id: "northstar-mouse",
    name: "Northstar M2",
    category: "Accessories",
    description:
      "A precise, dual-mode wireless mouse with a comfortable low-profile shape and USB-C charging.",
    priceMinor: 4200,
    currency: "USD",
    available: true,
    accent: "violet",
  },
  {
    id: "orbit-desk-lamp",
    name: "Orbit Desk Lamp",
    category: "Workspace",
    description:
      "A dimmable task light with warm and cool settings, designed for long work sessions.",
    priceMinor: 5800,
    currency: "USD",
    available: true,
    accent: "amber",
  },
  {
    id: "arc-usb-hub",
    name: "Arc USB-C Hub",
    category: "Accessories",
    description:
      "A travel-friendly six-port USB-C hub with HDMI, USB-A, and pass-through power.",
    priceMinor: 3499,
    currency: "USD",
    available: true,
    accent: "mint",
  },
  {
    id: "field-notes-stand",
    name: "Field Notes Stand",
    category: "Workspace",
    description:
      "A fold-flat, adjustable aluminum stand for laptops and tablets.",
    priceMinor: 4600,
    currency: "USD",
    available: true,
    accent: "rose",
  },
];

export function sortTransactions(items: Transaction[]): Transaction[] {
  return [...items].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function sumCurrency(
  items: Transaction[],
  direction: "in" | "out",
  start: Date,
  end: Date,
): number {
  return items
    .filter((item) => {
      const time = new Date(item.date).getTime();
      return (
        item.status === "completed" &&
        item.currency === "USD" &&
        time >= start.getTime() &&
        time < end.getTime() &&
        (direction === "in" ? item.amountMinor > 0 : item.amountMinor < 0)
      );
    })
    .reduce(
      (total, item) =>
        total + (direction === "in" ? item.amountMinor : -item.amountMinor),
      0,
    );
}

export function currentMonthWindow(now = new Date()): [Date, Date] {
  return [
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  ];
}

export function getAnalyticsWindow(
  period: "week" | "month" | "quarter",
  now = new Date(),
): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
  const end = new Date(now);
  let start: Date;
  let previousStart: Date;
  let previousEnd: Date;

  if (period === "week") {
    const day = (now.getUTCDay() + 6) % 7;
    start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day),
    );
    previousEnd = new Date(start);
    previousStart = new Date(start);
    previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  } else if (period === "quarter") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    previousEnd = new Date(start);
    previousStart = new Date(
      Date.UTC(now.getUTCFullYear(), quarterStartMonth - 3, 1),
    );
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    previousEnd = new Date(start);
    previousStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
  }

  if (period === "week") {
    end.setTime(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    previousEnd = new Date(start);
  } else if (period === "month") {
    end.setTime(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
  } else {
    end.setTime(
      Date.UTC(
        now.getUTCFullYear(),
        Math.floor(now.getUTCMonth() / 3) * 3 + 3,
        1,
      ),
    );
  }

  const previousDuration = end.getTime() - start.getTime();
  if (period === "quarter") {
    previousEnd = new Date(start);
  }
  if (period === "month") {
    previousEnd = new Date(start);
  }
  if (period === "week") {
    previousEnd = new Date(start);
  }
  if (period === "quarter" && previousStart.getTime() >= previousEnd.getTime()) {
    previousStart = new Date(start.getTime() - previousDuration);
  }

  return { start, end, previousStart, previousEnd };
}

function activityFor(
  items: Transaction[],
  start: Date,
  end: Date,
  days: number,
): ActivityPoint[] {
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getTime() - (days - index) * 24 * 60 * 60 * 1000);
    return {
      date,
      label: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      receivedMinor: 0,
      spentMinor: 0,
    };
  });

  for (const item of items) {
    if (item.status !== "completed" || item.currency !== "USD") continue;
    const time = new Date(item.date).getTime();
    if (time < start.getTime() || time >= end.getTime()) continue;
    const bucket = buckets.find(
      (candidate) =>
        candidate.date.toISOString().slice(0, 10) ===
        item.date.toISOString().slice(0, 10),
    );
    if (!bucket) continue;
    if (item.amountMinor > 0) bucket.receivedMinor += item.amountMinor;
    if (item.amountMinor < 0) bucket.spentMinor += -item.amountMinor;
  }

  return buckets.map(({ label, receivedMinor, spentMinor }) => ({
    label,
    receivedMinor,
    spentMinor,
  }));
}

export function buildOverviewActivity(items: Transaction[]): ActivityPoint[] {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return activityFor(items, start, end, 7);
}

export function buildSpendingAnalytics(
  items: Transaction[],
  period: "week" | "month" | "quarter",
): SpendingAnalytics {
  const now = new Date();
  const { start, end, previousStart, previousEnd } = getAnalyticsWindow(period, now);
  const totalSpentMinor = sumCurrency(items, "out", start, end);
  const priorPeriodSpentMinor = sumCurrency(items, "out", previousStart, previousEnd);
  const changePercent =
    priorPeriodSpentMinor === 0
      ? totalSpentMinor === 0
        ? 0
        : 100
      : Math.round(
          ((totalSpentMinor - priorPeriodSpentMinor) / priorPeriodSpentMinor) *
            100,
        );

  const categoryMap = new Map<string, number>();
  for (const item of items) {
    const time = new Date(item.date).getTime();
    if (
      item.status !== "completed" ||
      item.amountMinor >= 0 ||
      item.currency !== "USD" ||
      time < start.getTime() ||
      time >= end.getTime()
    ) {
      continue;
    }
    categoryMap.set(
      item.category,
      (categoryMap.get(item.category) ?? 0) - item.amountMinor,
    );
  }

  const categories: CategoryTotal[] = [...categoryMap.entries()]
    .map(([category, amountMinor]) => ({
      category,
      amountMinor,
      currency: "USD",
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const durationDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    period,
    currency: "USD",
    totalSpentMinor,
    priorPeriodSpentMinor,
    changePercent,
    sourceLabel: "Synthetic demo data and PayPilot-created orders only; no connected PayPal account activity",
    categories,
    activity: buildOverviewActivity(items),
  };
}

export function findProducts(message: string): Product[] {
  const normalized = message.toLowerCase();
  const budgetMatch = normalized.match(
    /(?:under|below|less than|budget(?: of)?|up to)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  );
  const budgetMinor = budgetMatch ? Math.round(Number(budgetMatch[1]) * 100) : null;
  const terms = normalized
    .replace(/\b(under|below|less than|budget|of|up to|find|best|option|help|me|purchase|buy|a|an|the|for|my|need|want|show|please)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);

  // Relevance first (name and category matches outweigh description matches),
  // then price. Sorting by price alone surfaced a cheaper mouse for the query
  // "wireless keyboard" because "wireless" appears in its description.
  const relevance = (product: Product): number => {
    const name = product.name.toLowerCase();
    const category = product.category.toLowerCase();
    const description = product.description.toLowerCase();
    return terms.reduce(
      (score, term) =>
        score +
        (name.includes(term) ? 3 : 0) +
        (category.includes(term) ? 3 : 0) +
        (description.includes(term) ? 1 : 0),
      0,
    );
  };

  return demoProducts
    .filter(
      (product) =>
        product.available &&
        (budgetMinor === null || product.priceMinor <= budgetMinor) &&
        (terms.length === 0 || relevance(product) > 0),
    )
    .sort(
      (a, b) =>
        relevance(b) - relevance(a) || a.priceMinor - b.priceMinor,
    )
    .slice(0, 3);
}

export function findTransactions(
  items: Transaction[],
  search = "",
): Transaction[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return sortTransactions(items);
  return sortTransactions(
    items.filter((item) =>
      [
        item.id,
        item.merchant,
        item.category,
        item.description,
        item.reference ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    ),
  );
}
