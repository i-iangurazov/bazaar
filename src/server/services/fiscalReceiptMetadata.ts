import type { PosKkmStatus } from "@prisma/client";

import type { FiscalReceiptResult } from "@/server/kkm/adapter";

export type FiscalMetadata = {
  kkmFactoryNumber: string | null;
  kkmRegistrationNumber: string | null;
  fiscalModeStatus: PosKkmStatus | null;
  upfdOrFiscalMemory: string | null;
  qrPayload: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
};

const readPath = (source: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const pickFirstString = (source: unknown, paths: string[]): string | null => {
  const record = asRecord(source);
  if (!record) {
    return null;
  }
  for (const path of paths) {
    const value = toNullableString(readPath(record, path));
    if (value) {
      return value;
    }
  }
  return null;
};

const parseFiscalModeStatus = (value: unknown): PosKkmStatus | null => {
  if (typeof value === "boolean") {
    return value ? "SENT" : "NOT_SENT";
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "SENT" || normalized === "SUCCESS" || normalized === "OK") {
    return "SENT";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "FAILED";
  }
  if (normalized === "NOT_SENT" || normalized === "PENDING" || normalized === "QUEUED") {
    return "NOT_SENT";
  }
  return null;
};

const FACTORY_NUMBER_PATHS = [
  "kkmFactoryNumber",
  "kkm_factory_number",
  "factoryNumber",
  "factoryNo",
  "serialNumber",
  "kkmSerialNumber",
];
const REGISTRATION_NUMBER_PATHS = [
  "kkmRegistrationNumber",
  "kkm_registration_number",
  "registrationNumber",
  "registrationNo",
];
const STATUS_PATHS = ["fiscalModeStatus", "sentToOFD", "sentToGNS", "ofdStatus", "gnsStatus"];
const UPFD_PATHS = [
  "upfdOrFiscalMemory",
  "upfd",
  "fiscalMemoryNumber",
  "fiscalMemorySerial",
  "fnNumber",
  "fiscalStorageNumber",
];
const QR_PATHS = ["qrPayload", "qr", "qrCode", "qrValue", "ofdQr", "ofdLink"];

export const extractFiscalMetadata = (source: unknown): FiscalMetadata => {
  const modeRaw = (() => {
    const record = asRecord(source);
    if (!record) {
      return null;
    }
    for (const path of STATUS_PATHS) {
      const value = readPath(record, path);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return null;
  })();

  return {
    kkmFactoryNumber: pickFirstString(source, FACTORY_NUMBER_PATHS),
    kkmRegistrationNumber: pickFirstString(source, REGISTRATION_NUMBER_PATHS),
    fiscalModeStatus: parseFiscalModeStatus(modeRaw),
    upfdOrFiscalMemory: pickFirstString(source, UPFD_PATHS),
    qrPayload: pickFirstString(source, QR_PATHS),
  };
};

export const resolveFiscalMetadataFromResult = (input: {
  result: FiscalReceiptResult;
  fallbackStatus: PosKkmStatus;
}): FiscalMetadata => {
  const raw = extractFiscalMetadata(input.result.rawJson ?? null);
  const explicitModeStatus = input.result.fiscalModeStatus ?? null;

  return {
    kkmFactoryNumber: input.result.kkmFactoryNumber ?? raw.kkmFactoryNumber,
    kkmRegistrationNumber:
      input.result.kkmRegistrationNumber ?? raw.kkmRegistrationNumber,
    fiscalModeStatus: explicitModeStatus ?? raw.fiscalModeStatus ?? input.fallbackStatus,
    upfdOrFiscalMemory: input.result.upfdOrFiscalMemory ?? raw.upfdOrFiscalMemory,
    qrPayload: input.result.qrPayload ?? raw.qrPayload,
  };
};
