import { z } from "zod";

export const searchGlobalInputSchema = z.object({
  q: z.string().min(2),
});

export type SearchGlobalInput = z.infer<typeof searchGlobalInputSchema>;
