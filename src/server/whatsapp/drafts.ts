import { Prisma } from "@prisma/client";
import type { WhatsAppDb } from "./access";

export const WHATSAPP_DRAFT_STATE = "REVIEW";
export const WHATSAPP_DISCARDED_DRAFT_STATE = "REVIEW_DISCARDED";
export const WHATSAPP_DRAFT_STATES = [WHATSAPP_DRAFT_STATE, WHATSAPP_DISCARDED_DRAFT_STATE];

export async function discardWhatsAppDrafts(db: WhatsAppDb, where: Prisma.WhatsAppMessageWhereInput) {
  return db.whatsAppMessage.updateMany({
    where: { ...where, direction: "OUTBOUND", state: WHATSAPP_DRAFT_STATE },
    data: { state: WHATSAPP_DISCARDED_DRAFT_STATE, body: "", facts: Prisma.DbNull },
  });
}
