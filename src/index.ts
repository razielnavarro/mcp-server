import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import * as entities from "./entities";
import { ItemSchema } from "./schemas/items.schema";
import { CartItemSchema } from "./schemas/carts.schema";
import { BulkCartSchema } from "./schemas/bulk.schema";
import { eq, and } from "drizzle-orm";

interface Env {
  DB: D1Database;
}

interface CartItem {
  userId: string;
  itemId: string;
  quantity: number;
}

// const items = [
//   { id: "apple", name: "Apple", price: 1 },
//   { id: "bread", name: "Bread", price: 2 },
//   { id: "milk", name: "Milk", price: 3 },
// ];

const carts: Record<string, { id: string; quantity: number }[]> = {};

function getDb(env: Env) {
  return drizzle(env.DB, { schema: entities });
}

async function listItems(env: Env) {
  const db = getDb(env);
  return await db.select().from(entities.items).all();
}

async function addToCart(env: Env, input: z.infer<typeof CartItemSchema>) {
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

async function removeFromCart(env: Env, input: z.infer<typeof CartItemSchema>) {
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

async function viewCart(env: Env, userId: string) {
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

async function checkout(env: Env, userId: string) {
  const cart = await viewCart(env, userId);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const db = getDb(env);
  await db
    .delete(entities.carts)
    .where(eq(entities.carts.userId, userId))
    .run();
  return { total, message: "Checkout complete!" };
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Authless Calculator",
    version: "1.0.0",
  });

  async init() {
    // Supermarket tools:

    // 1. List items
    this.server.tool("listItems", { schema: z.object({}) }, async (_args) => {
      const items = await listItems(this.env);
      return {
        content: [{ type: "text", text: JSON.stringify(items) }],
      };
    });

    // 2. Add to cart
    this.server.tool("addToCart", { schema: CartItemSchema }, async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await addToCart(this.env, args.schema)),
        },
      ],
    }));

    // add multiple items to cart
    this.server.tool(
      "addMultipleToCart",
      { schema: BulkCartSchema },
      async (args) => {
        const { userId, items } = args.schema;
        for (const { itemId, quantity } of items) {
          // Re-use your existing single-item addToCart logic:
          await addToCart(this.env, { userId, itemId, quantity });
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

    // 3. Remove from cart
    this.server.tool(
      "removeFromCart",
      { schema: CartItemSchema },
      async (args) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await removeFromCart(this.env, args.schema)),
          },
        ],
      })
    );

    // 4. View cart
    this.server.tool(
      "viewCart",
      { schema: z.object({ userId: z.string() }) },
      async (userId) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await viewCart(this.env, userId.schema.userId)
            ),
          },
        ],
      })
    );

    // 5. Checkout
    this.server.tool(
      "checkout",
      { schema: z.object({ userId: z.string() }) },
      async (userId) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await checkout(this.env, userId.schema.userId)
            ),
          },
        ],
      })
    );

    // 6. Add item
    this.server.tool(
      "addItem",
      {
        schema: z.object({
          id: z.string(),
          name: z.string(),
          price: z.number(),
        }),
      },
      async (args) => {
        const db = getDb(this.env);
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

    // 7. Update item
    this.server.tool(
      "updateItem",
      {
        schema: z.object({
          id: z.string(),
          name: z.string().optional(),
          price: z.number().optional(),
        }),
      },
      async (args) => {
        const db = getDb(this.env);
        const { id, name, price } = args.schema;

        // Build update object
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

    // 8. Remove item
    this.server.tool(
      "removeItem",
      {
        schema: z.object({
          id: z.string(),
        }),
      },
      async (args) => {
        const db = getDb(this.env);
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

    // 9. Remove multiple items from cart
    this.server.tool(
      "removeMultipleFromCart",
      { schema: BulkCartSchema },
      async (args) => {
        const { userId, items } = args.schema;
        for (const { itemId, quantity } of items) {
          // Re-use your existing single-item removeFromCart logic:
          await removeFromCart(this.env, { userId, itemId, quantity });
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
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
