import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";

import { prisma } from "@/server/db/prisma";
import { issueCardToken, requestJoinOtp, verifyCardToken, verifyJoinOtp } from "@/server/services/loyalty/memberAuth";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { renderQrPng } from "@/server/services/loyalty/qr";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

/** Decodes a rendered QR PNG back to its text, exactly like a scanner would. */
const decodeQr = async (png: Buffer) => {
  const { data, info } = await sharp(png)
    .flatten({ background: "#ffffff" })
    .resize(360, 360, { kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luminances = new Int32Array(info.width * info.height);
  for (let index = 0; index < luminances.length; index += 1) {
    const r = data[index * 4] ?? 0;
    const g = data[index * 4 + 1] ?? 0;
    const b = data[index * 4 + 2] ?? 0;
    luminances[index] = Math.round((r + g + b) / 3);
  }
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(luminances, info.width, info.height)),
  );
  return new QRCodeReader().decode(bitmap).getText();
};

describeDb("loyalty QR codes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("renders a decodable store QR and accepts the decoded card QR in the register handler", async () => {
    const base = await seedBase({ plan: "BUSINESS" });
    const program = await upsertLoyaltyProgram(prisma, base.org.id, {
      enabled: true,
      storeIds: [base.store.id],
    });
    const link = await prisma.loyaltyProgramStore.findFirstOrThrow({
      where: { programId: program.id, storeId: base.store.id },
    });

    // Store QR decodes to the public registration link.
    const joinUrl = `https://bazaar.kg/loyalty/join/${link.id}`;
    expect(await decodeQr(await renderQrPng(joinUrl))).toBe(joinUrl);

    // Customer QR decodes to an opaque token that the register handler accepts.
    const email = "qr-test@example.invalid";
    const requested = await requestJoinOtp({ programStoreId: link.id, email });
    const session = await verifyJoinOtp({ programStoreId: link.id, email, code: requested.code! });
    const card = await issueCardToken(session.token);
    const decoded = await decodeQr(await renderQrPng(card.token));
    expect(decoded).toBe(card.token);
    expect(decoded).not.toContain(email);

    const verified = await verifyCardToken(decoded, base.org.id);
    expect(verified.member.email).toBe(email);
  });
});
