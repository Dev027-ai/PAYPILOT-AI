import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const paypilotOrdersTable = pgTable("paypilot_orders", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPaypilotOrderSchema = createInsertSchema(
  paypilotOrdersTable,
).omit({ createdAt: true });

export type InsertPaypilotOrder = typeof paypilotOrdersTable.$inferInsert;
export type PaypilotOrder = typeof paypilotOrdersTable.$inferSelect;
