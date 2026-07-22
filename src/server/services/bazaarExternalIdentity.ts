import { createHash } from "node:crypto";

import { AppError } from "@/server/services/errors";

export const BAZAAR_EXTERNAL_ORDER_ID_MAX_LENGTH = 160;
export const BAZAAR_EXTERNAL_ORDER_ID_NOTE_PREFIX = "Bazaar API externalId:";

const remainingControlCharacterPattern = /[\u0000-\u001f\u007f]/u;

export type BazaarExternalIdInvalidReason =
  | "EMPTY"
  | "TOO_LONG"
  | "CONTROL_CHARACTER"
  | "MALFORMED_MARKER";

export type BazaarExternalIdNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; reason: Exclude<BazaarExternalIdInvalidReason, "MALFORMED_MARKER"> };

export type LegacyBazaarExternalIdParseResult =
  | { kind: "none"; markerCount: 0 }
  | { kind: "value"; value: string; markerCount: number }
  | { kind: "ambiguous"; values: string[]; markerCount: number }
  | { kind: "invalid"; reason: BazaarExternalIdInvalidReason; markerCount: number };

export type BazaarExternalIdentityAuditRow = {
  id: string;
  organizationId: string;
  storeId: string;
  notes: string | null;
  externalOrderId: string | null;
};

export type BazaarExternalIdentityWriteCandidate = {
  orderId: string;
  organizationId: string;
  storeId: string;
  externalOrderId: string;
  externalIdDigest: string;
};

export type BazaarExternalIdentityAuditIssue =
  | {
      kind: "LEGACY_MARKER_INVALID";
      orderId: string;
      organizationId: string;
      storeId: string;
      reason: BazaarExternalIdInvalidReason;
    }
  | {
      kind: "LEGACY_MARKER_AMBIGUOUS";
      orderId: string;
      organizationId: string;
      storeId: string;
      externalIdDigests: string[];
    }
  | {
      kind: "EXACT_FIELD_INVALID";
      orderId: string;
      organizationId: string;
      storeId: string;
      reason: Exclude<BazaarExternalIdInvalidReason, "MALFORMED_MARKER"> | "NON_CANONICAL";
    }
  | {
      kind: "FIELD_MARKER_MISMATCH";
      orderId: string;
      organizationId: string;
      storeId: string;
      fieldDigest: string;
      markerDigest: string;
    }
  | {
      kind: "DUPLICATE_EXTERNAL_ID";
      organizationId: string;
      storeId: string;
      externalIdDigest: string;
      orderIds: string[];
    };

export type BazaarExternalIdentityAudit = {
  scannedCount: number;
  withoutIdentityCount: number;
  alreadyPopulatedCount: number;
  candidateCount: number;
  issueCount: number;
  candidates: BazaarExternalIdentityWriteCandidate[];
  issues: BazaarExternalIdentityAuditIssue[];
};

export const tryNormalizeBazaarExternalOrderId = (
  value: string,
): BazaarExternalIdNormalizationResult => {
  if (remainingControlCharacterPattern.test(value)) {
    return { ok: false, reason: "CONTROL_CHARACTER" };
  }
  const normalized = value.trim();
  if (!normalized) return { ok: false, reason: "EMPTY" };
  if (normalized.length > BAZAAR_EXTERNAL_ORDER_ID_MAX_LENGTH) {
    return { ok: false, reason: "TOO_LONG" };
  }
  return { ok: true, value: normalized };
};

export const normalizeBazaarExternalOrderId = (value?: string | null) => {
  if (value === null || value === undefined) return null;
  const normalized = tryNormalizeBazaarExternalOrderId(value);
  if (!normalized.ok) {
    throw new AppError("invalidExternalOrderId", "BAD_REQUEST", 400);
  }
  return normalized.value;
};

export const formatBazaarExternalOrderIdNote = (externalOrderId: string) => {
  const normalized = normalizeBazaarExternalOrderId(externalOrderId);
  if (!normalized) {
    throw new AppError("invalidExternalOrderId", "BAD_REQUEST", 400);
  }
  return `${BAZAAR_EXTERNAL_ORDER_ID_NOTE_PREFIX} ${normalized}`;
};

export const parseLegacyBazaarExternalIdNotes = (
  notes?: string | null,
): LegacyBazaarExternalIdParseResult => {
  if (!notes) return { kind: "none", markerCount: 0 };

  const values: string[] = [];
  let markerCount = 0;
  let invalidReason: BazaarExternalIdInvalidReason | null = null;

  const exactMarkerPattern = /^Bazaar API externalId: (.+)$/u;
  for (const line of notes.split(/\r\n|\n|\r/u)) {
    const match = exactMarkerPattern.exec(line);
    if (!match) {
      if (line.trim().startsWith(BAZAAR_EXTERNAL_ORDER_ID_NOTE_PREFIX)) {
        markerCount += 1;
        invalidReason = "MALFORMED_MARKER";
      }
      continue;
    }
    markerCount += 1;
    const rawValue = match[1];
    if (line !== line.trim() || rawValue !== rawValue.trim()) {
      invalidReason = "MALFORMED_MARKER";
      continue;
    }
    const normalized = tryNormalizeBazaarExternalOrderId(rawValue);
    if (!normalized.ok) {
      invalidReason = normalized.reason;
      continue;
    }
    values.push(normalized.value);
  }

  if (markerCount === 0) return { kind: "none", markerCount: 0 };
  if (invalidReason) return { kind: "invalid", reason: invalidReason, markerCount };

  const uniqueValues = Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (uniqueValues.length === 1) {
    return { kind: "value", value: uniqueValues[0], markerCount };
  }
  if (uniqueValues.length > 1) {
    return { kind: "ambiguous", values: uniqueValues, markerCount };
  }
  return { kind: "invalid", reason: "EMPTY", markerCount };
};

export const bazaarExternalIdDigest = (externalOrderId: string) =>
  createHash("sha256").update(externalOrderId).digest("hex").slice(0, 16);

const identityGroupKey = (input: {
  organizationId: string;
  storeId: string;
  externalOrderId: string;
}) => JSON.stringify([input.organizationId, input.storeId, "API", input.externalOrderId]);

export const analyzeBazaarExternalIdentityRows = (
  rows: readonly BazaarExternalIdentityAuditRow[],
): BazaarExternalIdentityAudit => {
  const candidates: BazaarExternalIdentityWriteCandidate[] = [];
  const issues: BazaarExternalIdentityAuditIssue[] = [];
  const identityGroups = new Map<
    string,
    {
      organizationId: string;
      storeId: string;
      externalOrderId: string;
      orderIds: Set<string>;
    }
  >();
  let withoutIdentityCount = 0;
  let alreadyPopulatedCount = 0;

  for (const row of rows) {
    const parsed = parseLegacyBazaarExternalIdNotes(row.notes);
    let parsedValue: string | null = null;
    if (parsed.kind === "value") {
      parsedValue = parsed.value;
    } else if (parsed.kind === "invalid") {
      issues.push({
        kind: "LEGACY_MARKER_INVALID",
        orderId: row.id,
        organizationId: row.organizationId,
        storeId: row.storeId,
        reason: parsed.reason,
      });
    } else if (parsed.kind === "ambiguous") {
      issues.push({
        kind: "LEGACY_MARKER_AMBIGUOUS",
        orderId: row.id,
        organizationId: row.organizationId,
        storeId: row.storeId,
        externalIdDigests: parsed.values.map(bazaarExternalIdDigest),
      });
    }

    let fieldValue: string | null = null;
    if (row.externalOrderId !== null) {
      const normalizedField = tryNormalizeBazaarExternalOrderId(row.externalOrderId);
      if (!normalizedField.ok) {
        issues.push({
          kind: "EXACT_FIELD_INVALID",
          orderId: row.id,
          organizationId: row.organizationId,
          storeId: row.storeId,
          reason: normalizedField.reason,
        });
      } else {
        fieldValue = normalizedField.value;
        if (fieldValue !== row.externalOrderId) {
          issues.push({
            kind: "EXACT_FIELD_INVALID",
            orderId: row.id,
            organizationId: row.organizationId,
            storeId: row.storeId,
            reason: "NON_CANONICAL",
          });
        }
      }
    }

    if (fieldValue && parsedValue && fieldValue !== parsedValue) {
      issues.push({
        kind: "FIELD_MARKER_MISMATCH",
        orderId: row.id,
        organizationId: row.organizationId,
        storeId: row.storeId,
        fieldDigest: bazaarExternalIdDigest(fieldValue),
        markerDigest: bazaarExternalIdDigest(parsedValue),
      });
    }

    const effectiveValue = fieldValue ?? parsedValue;
    if (!effectiveValue) {
      withoutIdentityCount += 1;
      continue;
    }

    const groupKey = identityGroupKey({
      organizationId: row.organizationId,
      storeId: row.storeId,
      externalOrderId: effectiveValue,
    });
    const group = identityGroups.get(groupKey) ?? {
      organizationId: row.organizationId,
      storeId: row.storeId,
      externalOrderId: effectiveValue,
      orderIds: new Set<string>(),
    };
    group.orderIds.add(row.id);
    identityGroups.set(groupKey, group);

    if (fieldValue) {
      alreadyPopulatedCount += 1;
    } else if (parsedValue) {
      candidates.push({
        orderId: row.id,
        organizationId: row.organizationId,
        storeId: row.storeId,
        externalOrderId: parsedValue,
        externalIdDigest: bazaarExternalIdDigest(parsedValue),
      });
    }
  }

  for (const group of identityGroups.values()) {
    const orderIds = Array.from(group.orderIds).sort();
    if (orderIds.length < 2) continue;
    issues.push({
      kind: "DUPLICATE_EXTERNAL_ID",
      organizationId: group.organizationId,
      storeId: group.storeId,
      externalIdDigest: bazaarExternalIdDigest(group.externalOrderId),
      orderIds,
    });
  }

  candidates.sort((left, right) => left.orderId.localeCompare(right.orderId, "en"));
  issues.sort((left, right) => {
    const leftOrder = "orderId" in left ? left.orderId : left.orderIds[0];
    const rightOrder = "orderId" in right ? right.orderId : right.orderIds[0];
    return `${left.kind}:${leftOrder}`.localeCompare(`${right.kind}:${rightOrder}`, "en");
  });

  return {
    scannedCount: rows.length,
    withoutIdentityCount,
    alreadyPopulatedCount,
    candidateCount: candidates.length,
    issueCount: issues.length,
    candidates,
    issues,
  };
};
