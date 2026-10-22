import { waitUntil } from "@vercel/functions";

// Next 14 has no after(). Retain already-handled work after the HTTP response.
// Local Node services keep running without a hosting request context.
export function keepBackgroundTaskAlive(task: Promise<unknown>) {
  if (process.env.VERCEL === "1") waitUntil(task);
  void task;
}
