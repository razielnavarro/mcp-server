import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const carts = sqliteTable("carts", {
  userId: text("user_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull(),
});