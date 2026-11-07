import { prisma } from "../src/server/db/prisma";
import { runWhatsAppWorkerBatch, redactExpiredWhatsAppData } from "../src/server/whatsapp/worker";
import { reconcileWhatsAppPayments } from "../src/server/whatsapp/payments";

let stopping = false;
const stop = () => {
  stopping = true;
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
let lastMaintenance = 0,
  lastPaymentCheck = 0;
try {
  while (!stopping) {
    try {
      await runWhatsAppWorkerBatch(10, () => stopping);
      if (stopping) break;
      if (Date.now() - lastPaymentCheck > 60_000) {
        lastPaymentCheck = Date.now();
        await reconcileWhatsAppPayments();
      }
      if (Date.now() - lastMaintenance > 3600_000) {
        lastMaintenance = Date.now();
        await redactExpiredWhatsAppData();
      }
    } catch {
      // No payload, telephone, credentials or provider URL is written to worker logs.
      console.error("WhatsApp worker: batch failed; durable jobs remain queued");
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await prisma.whatsAppWorkerState
    .updateMany({ where: { id: "worker" }, data: { state: "DISABLED" } })
    .catch(() => undefined);
  await prisma.$disconnect();
}
