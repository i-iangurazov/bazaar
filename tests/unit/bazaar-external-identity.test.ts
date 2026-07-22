import { describe, expect, it } from "vitest";

import {
  analyzeBazaarExternalIdentityRows,
  bazaarExternalIdDigest,
  formatBazaarExternalOrderIdNote,
  normalizeBazaarExternalOrderId,
  parseLegacyBazaarExternalIdNotes,
  tryNormalizeBazaarExternalOrderId,
} from "@/server/services/bazaarExternalIdentity";
import { parseBazaarExternalIdBackfillOptions } from "../../scripts/bazaar-external-id-backfill";

describe("Bazaar external order identity", () => {
  it("trims outer spaces while preserving case and exact internal whitespace", () => {
    expect(normalizeBazaarExternalOrderId("  Ext-1  Part  ")).toBe("Ext-1  Part");
    expect(normalizeBazaarExternalOrderId("ext-1")).toBe("ext-1");
    expect(normalizeBazaarExternalOrderId("A  B")).not.toBe(normalizeBazaarExternalOrderId("A B"));
    expect(normalizeBazaarExternalOrderId("Case-ID")).not.toBe(
      normalizeBazaarExternalOrderId("case-id"),
    );
    expect(tryNormalizeBazaarExternalOrderId("")).toEqual({ ok: false, reason: "EMPTY" });
    expect(tryNormalizeBazaarExternalOrderId("x".repeat(161))).toEqual({
      ok: false,
      reason: "TOO_LONG",
    });
    expect(tryNormalizeBazaarExternalOrderId("EXT-1\u0000hidden")).toEqual({
      ok: false,
      reason: "CONTROL_CHARACTER",
    });
    expect(tryNormalizeBazaarExternalOrderId("EXT-1\nPart")).toEqual({
      ok: false,
      reason: "CONTROL_CHARACTER",
    });
  });

  it("parses only complete marker lines and distinguishes exact identities", () => {
    expect(parseLegacyBazaarExternalIdNotes("Comment Bazaar API externalId: EXT-1")).toEqual({
      kind: "none",
      markerCount: 0,
    });
    expect(
      parseLegacyBazaarExternalIdNotes(
        `Comment\n${formatBazaarExternalOrderIdNote("EXT-1")}\nBazaar API externalId: EXT-1`,
      ),
    ).toEqual({ kind: "value", value: "EXT-1", markerCount: 2 });
    expect(
      parseLegacyBazaarExternalIdNotes(
        `${formatBazaarExternalOrderIdNote("EXT-10")}\n${formatBazaarExternalOrderIdNote("EXT-1")}`,
      ),
    ).toEqual({ kind: "ambiguous", values: ["EXT-1", "EXT-10"], markerCount: 2 });
    expect(parseLegacyBazaarExternalIdNotes("Bazaar API externalId:EXT-1")).toEqual({
      kind: "invalid",
      reason: "MALFORMED_MARKER",
      markerCount: 1,
    });
    expect(parseLegacyBazaarExternalIdNotes(" Bazaar API externalId: EXT-1 ")).toEqual({
      kind: "invalid",
      reason: "MALFORMED_MARKER",
      markerCount: 1,
    });
    expect(parseLegacyBazaarExternalIdNotes("Bazaar API externalId: A  B")).toEqual({
      kind: "value",
      value: "A  B",
      markerCount: 1,
    });
  });

  it("plans a clean backfill and reports collisions without exposing raw identities", () => {
    const clean = analyzeBazaarExternalIdentityRows([
      {
        id: "order-1",
        organizationId: "org-1",
        storeId: "store-1",
        notes: "Bazaar API externalId: EXT-1",
        externalOrderId: null,
      },
      {
        id: "order-2",
        organizationId: "org-1",
        storeId: "store-1",
        notes: "ordinary comment",
        externalOrderId: null,
      },
    ]);
    expect(clean).toMatchObject({
      scannedCount: 2,
      candidateCount: 1,
      alreadyPopulatedCount: 0,
      withoutIdentityCount: 1,
      issueCount: 0,
    });
    expect(clean.candidates[0]).toMatchObject({
      orderId: "order-1",
      externalOrderId: "EXT-1",
      externalIdDigest: bazaarExternalIdDigest("EXT-1"),
    });

    const collision = analyzeBazaarExternalIdentityRows([
      {
        id: "order-1",
        organizationId: "org-1",
        storeId: "store-1",
        notes: "Bazaar API externalId: PRIVATE-EXT-1",
        externalOrderId: null,
      },
      {
        id: "order-2",
        organizationId: "org-1",
        storeId: "store-1",
        notes: "Bazaar API externalId: PRIVATE-EXT-1",
        externalOrderId: null,
      },
    ]);
    expect(collision.issueCount).toBe(1);
    expect(collision.issues[0]).toMatchObject({
      kind: "DUPLICATE_EXTERNAL_ID",
      orderIds: ["order-1", "order-2"],
      externalIdDigest: bazaarExternalIdDigest("PRIVATE-EXT-1"),
    });
    expect(JSON.stringify(collision.issues)).not.toContain("PRIVATE-EXT-1");
  });

  it("requires explicit mutually exclusive CLI modes and two write confirmations", () => {
    expect(parseBazaarExternalIdBackfillOptions(["--dry-run"], {})).toEqual({
      mode: "dry-run",
      batchSize: 200,
    });
    expect(() => parseBazaarExternalIdBackfillOptions([], {})).toThrow("MODE_REQUIRED");
    expect(() => parseBazaarExternalIdBackfillOptions(["--dry-run", "--write"], {})).toThrow(
      "MODE_MUST_BE_EXCLUSIVE",
    );
    expect(() => parseBazaarExternalIdBackfillOptions(["--write"], {})).toThrow(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(() =>
      parseBazaarExternalIdBackfillOptions(
        ["--write", "--confirm-write=BACKFILL_BAZAAR_EXTERNAL_ORDER_IDS"],
        {},
      ),
    ).toThrow("WRITE_ENV_FLAG_REQUIRED");
    expect(
      parseBazaarExternalIdBackfillOptions(
        ["--write", "--confirm-write=BACKFILL_BAZAAR_EXTERNAL_ORDER_IDS", "--batch-size=25"],
        { ALLOW_BAZAAR_EXTERNAL_ID_BACKFILL_WRITE: "1" },
      ),
    ).toEqual({ mode: "write", batchSize: 25 });
  });
});
