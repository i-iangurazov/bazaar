import { createRateLimiter } from "@/server/middleware/rateLimiter";

export const loginRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  prefix: "login",
});
