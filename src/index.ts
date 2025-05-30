import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import * as entities from "./entities";
import { ItemSchema } from "./schemas/items.schema";
import { CartItemSchema } from "./schemas/carts.schema";
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

async function addToCart(
  env: Env,
  input: z.infer<typeof CartItemSchema.CartItemSchema>
) {
  CartItemSchema.CartItemSchema.parse(input);

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

async function removeFromCart(
  env: Env,
  input: z.infer<typeof CartItemSchema.CartItemSchema>
) {
  CartItemSchema.CartItemSchema.parse(input);

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
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Authless Calculator",
    version: "1.0.0",
  });

  async init() {
    // Simple addition tool
    this.server.tool(
      "add",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      })
    );

    // Calculator tool with multiple operations
    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: Cannot divide by zero",
                  },
                ],
              };
            result = a / b;
            break;
        }
        return { content: [{ type: "text", text: String(result) }] };
      }
    );

    // Supermarket tools:

    // 1. List items
    this.server.tool(
      "listItems",
      { schema: z.object({}) },
      async (_args, { env }) => {
        const items = await listItems(env);
        return {
          content: [{ type: "text", text: JSON.stringify(items) }],
        };
      }
    );

    // 2. Add to cart
    this.server.tool(
      "addToCart",
      { schema: CartItemSchema },
      async (args, { env }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await addToCart(env, args)),
          },
        ],
      })
    );

    // 3. Remove from cart
    this.server.tool(
      "removeFromCart",
      { schema: CartItemSchema },
      async (args, { env }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await removeFromCart(env, args)),
          },
        ],
      })
    );

    // 4. View cart
    this.server.tool(
      "viewCart",
      { schema: z.object({ userId: z.string() }) },
      async ({ userId }, { env }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await viewCart(env, userId)),
          },
        ],
      })
    );

    // 5. Checkout
    this.server.tool(
      "checkout",
      { schema: z.object({ userId: z.string() }) },
      async ({ userId }, { env }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await checkout(env, userId)),
          },
        ],
      })
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
