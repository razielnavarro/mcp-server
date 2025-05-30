import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const items = sqliteTable("items", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
  });