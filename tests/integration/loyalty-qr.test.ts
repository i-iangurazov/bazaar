import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";

import { prisma } from "@/server/db/prisma";
import { issueCardToken, requestJoinOtp, verifyCardToken, verifyJoinOtp } from "@/server/services/loyalty/memberAuth";
import { upsertLoyaltyProgram } from "@/server/services/loyalty/program";
import { renderQrPng } from "@/server/services/loyalty/qr";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

/** Decode the generated, unrotated PNG using ZXing's pure-image mode. */
const decodeQr = async (png: Buffer) => {
  const sizes = [null, 400, 300, 600, 800];
  let lastError: unknown;
  for (const size of sizes) {
    try {
      let pipeline = sharp(png).flatten({ background: "#ffffff" });
      if (size) pipeline = pipeline.resize(size, size, { kernel: "nearest" });
      const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      // Int32Array would be interpreted as packed RGB instead of grayscale bytes.
      const luminances = new Uint8ClampedArray(info.width * info.height);
      for (let index = 0; index < luminances.length; index += 1) {
        const r = data[index * 4] ?? 0;
        const g = data[index * 4 + 1] ?? 0;
        const b = data[index * 4 + 2] ?? 0;
        luminances[index] = Math.round((r + g + b) / 3);
      }
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(luminances, info.width, info.height)),
      );
      return new QRCodeReader().decode(bitmap, new Map([[DecodeHintType.PURE_BARCODE, true]])).getText();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

describeDb("loyalty QR codes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("renders a decodable store QR and accepts the decoded card QR in the register handler", async () => {
    // These valid payloads can confuse the camera finder-pattern detector on a clean PNG.
    for (const id of ["cmdfa0cfa073b89b61e6bec111", "cm861e45e62a1e23669c54e7ed", "cmc1afe39bc6ffcdf123527799"]) {
      const url = `https://bazaar.kg/loyalty/join/${id}`;
      expect(await decodeQr(await renderQrPng(url))).toBe(url);
    }
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
