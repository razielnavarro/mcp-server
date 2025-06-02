import z from "zod";

export const BulkCartSchema = z.object({
    userId: z.string(),
    items: z.array(
      z.object({
        itemId: z.string(),
        quantity: z.number(),
      })
    ),
  });