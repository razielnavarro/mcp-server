import z from "zod";
  
  export const CartItemSchema = z.object({
    userId: z.string(),
    itemId: z.string(),
    quantity: z.number(),
  });