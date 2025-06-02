import { z } from "zod";
import * as entities from "./entities";
import { ItemSchema } from "./schemas/items.schema";
import { CartItemSchema } from "./schemas/carts.schema";
import { BulkCartSchema } from "./schemas/bulk.schema";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";

interface Env {
  DB: D1Database;
}

function getDb(env: any) {
  return drizzle(env.DB, { schema: entities });
}

async function listItems(env: any) {
  const db = getDb(env);
  return await db.select().from(entities.items).all();
}

async function addToCart(env: any, input: z.infer<typeof CartItemSchema>) {
  CartItemSchema.parse(input);
  const db = getDb(env);
  const { userId, itemId, quantity } = input;
  const existing = await db
    .select()
    .from(entities.carts)
    .where(
      and(eq(entities.carts.userId, userId), eq(entities.carts.itemId, itemId))
    )
    .get();
  if (existing) {
    await db
      .update(entities.carts)
      .set({ quantity: existing.quantity + quantity })
      .where(
        and(
          eq(entities.carts.userId, userId),
          eq(entities.carts.itemId, itemId)
        )
      )
      .run();
  } else {
    await db.insert(entities.carts).values({ userId, itemId, quantity }).run();
  }
  return { success: true };
}

async function removeFromCart(env: any, input: z.infer<typeof CartItemSchema>) {
  CartItemSchema.parse(input);
  const db = getDb(env);
  const { userId, itemId, quantity } = input;
  const existing = await db
    .select()
    .from(entities.carts)
    .where(
      and(eq(entities.carts.userId, userId), eq(entities.carts.itemId, itemId))
    )
    .get();
  if (!existing) return { success: false, message: "Item not in cart" };
  const newQty = existing.quantity - quantity;
  if (newQty > 0) {
    await db
      .update(entities.carts)
      .set({ quantity: newQty })
      .where(
        and(
          eq(entities.carts.userId, userId),
          eq(entities.carts.itemId, itemId)
        )
      )
      .run();
  } else {
    await db
      .delete(entities.carts)
      .where(
        and(
          eq(entities.carts.userId, userId),
          eq(entities.carts.itemId, itemId)
        )
      )
      .run();
  }
  return { success: true };
}

async function viewCart(env: any, userId: string) {
  const db = getDb(env);
  return await db
    .select({
      id: entities.items.id,
      name: entities.items.name,
      price: entities.items.price,
      quantity: entities.carts.quantity,
    })
    .from(entities.carts)
    .innerJoin(entities.items, eq(entities.carts.itemId, entities.items.id))
    .where(eq(entities.carts.userId, userId))
    .all();
}

async function checkout(env: any, userId: string) {
  const cart = await viewCart(env, userId);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const db = getDb(env);
  await db
    .delete(entities.carts)
    .where(eq(entities.carts.userId, userId))
    .run();
  return { total, message: "Checkout complete!" };
}

export function registerTools(server: any, env: any) {
  // 1. List items
  server.tool(
    "listItems",
    { schema: z.object({}) },
    async (_args: { schema: {} }) => {
      const items = await listItems(env);
      return {
        content: [{ type: "text", text: JSON.stringify(items) }],
      };
    }
  );

  // 2. Add to cart
  server.tool(
    "addToCart",
    { schema: CartItemSchema },
    async (args: { schema: z.infer<typeof CartItemSchema> }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await addToCart(env, args.schema)),
        },
      ],
    })
  );

  // 3. Add multiple items to cart
  server.tool(
    "addMultipleToCart",
    { schema: BulkCartSchema },
    async (args: { schema: z.infer<typeof BulkCartSchema> }) => {
      const { userId, items } = args.schema;
      for (const { itemId, quantity } of items) {
        await addToCart(env, { userId, itemId, quantity });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    }
  );

  // 4. Remove from cart
  server.tool(
    "removeFromCart",
    { schema: CartItemSchema },
    async (args: { schema: z.infer<typeof CartItemSchema> }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await removeFromCart(env, args.schema)),
        },
      ],
    })
  );

  // 5. Remove multiple items from cart
  server.tool(
    "removeMultipleFromCart",
    { schema: BulkCartSchema },
    async (args: { schema: z.infer<typeof BulkCartSchema> }) => {
      const { userId, items } = args.schema;
      for (const { itemId, quantity } of items) {
        await removeFromCart(env, { userId, itemId, quantity });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    }
  );

  // 6. View cart
  server.tool(
    "viewCart",
    { schema: z.object({ userId: z.string() }) },
    async (args: { schema: { userId: string } }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await viewCart(env, args.schema.userId)),
        },
      ],
    })
  );

  // 7. Checkout
  server.tool(
    "checkout",
    { schema: z.object({ userId: z.string() }) },
    async (args: { schema: { userId: string } }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await checkout(env, args.schema.userId)),
        },
      ],
    })
  );

  // 8. Add item
  server.tool(
    "addItem",
    {
      schema: z.object({
        id: z.string(),
        name: z.string(),
        price: z.number(),
      }),
    },
    async (args: { schema: { id: string; name: string; price: number } }) => {
      const db = getDb(env);
      await db
        .insert(entities.items)
        .values({
          id: args.schema.id,
          name: args.schema.name,
          price: args.schema.price,
        })
        .run();
      return {
        content: [{ type: "text", text: "Item added!" }],
      };
    }
  );

  // 9. Update item
  server.tool(
    "updateItem",
    {
      schema: z.object({
        id: z.string(),
        name: z.string().optional(),
        price: z.number().optional(),
      }),
    },
    async (args: { schema: { id: string; name?: string; price?: number } }) => {
      const db = getDb(env);
      const { id, name, price } = args.schema;
      const update: Record<string, any> = {};
      if (name !== undefined) update.name = name;
      if (price !== undefined) update.price = price;
      if (Object.keys(update).length === 0) {
        return {
          content: [{ type: "text", text: "No fields to update." }],
        };
      }
      const result = await db
        .update(entities.items)
        .set(update)
        .where(eq(entities.items.id, id))
        .run();
      return {
        content: [
          {
            type: "text",
            text: result.success ? "Item updated!" : "Item not found.",
          },
        ],
      };
    }
  );

  // 10. Remove item
  server.tool(
    "removeItem",
    {
      schema: z.object({ id: z.string() }),
    },
    async (args: { schema: { id: string } }) => {
      const db = getDb(env);
      const { id } = args.schema;
      const result = await db
        .delete(entities.items)
        .where(eq(entities.items.id, id))
        .run();
      return {
        content: [
          {
            type: "text",
            text: result.success ? "Item removed!" : "Item not found.",
          },
        ],
      };
    }
  );
}
