import { prisma } from "../src/server/db/prisma";
import { whatsappConfig } from "../src/server/whatsapp/config";
import { gupshupAppDetails } from "../src/server/whatsapp/gupshup";
import { writeAuditLog } from "../src/server/services/audit";

// Operator-only recovery after an ambiguous app creation. The merchant never
// supplies provider tokens or arbitrary app IDs through the public application.
const [connectionId, providerAppId] = process.argv.slice(2);
try {
  if (!connectionId || !providerAppId || !whatsappConfig().onboardingReady)
    throw new Error("Connection recovery requires configured transport and two IDs");
  const c = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  if (
    !c ||
    !["PROVISIONING", "PROVISIONING_REVIEW"].includes(c.state) ||
    c.providerAppId ||
    !c.providerAppName
  )
    throw new Error("Connection is not awaiting operator recovery");
  const app = await gupshupAppDetails(providerAppId);
  if (app.id !== providerAppId || app.name !== c.providerAppName)
    throw new Error("Provider application does not match this connection");
  await prisma.$transaction(async (tx) => {
    const changed = await tx.whatsAppConnection.updateMany({
      where: { id: c.id, providerAppId: null, state: c.state },
      data: { providerAppId: app.id, state: "CONNECTING", lastIssue: null },
    });
    if (!changed.count) throw new Error("Connection changed during verification");
    await writeAuditLog(tx, {
      organizationId: c.organizationId,
      action: "WHATSAPP_CONNECTION_RECOVER",
      entity: "WhatsAppConnection",
      entityId: c.id,
      requestId: "operator-recovery",
    });
  });
  console.log("Connection recovered. The owner can continue official onboarding in Bazaar.");
} finally {
  await prisma.$disconnect();
}
