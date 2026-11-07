import { prisma } from "../src/server/db/prisma";
try {
  const worker = await prisma.whatsAppWorkerState.findUnique({ where: { id: "worker" } });
  if (!worker || Date.now() - worker.heartbeatAt.getTime() > 90000) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
