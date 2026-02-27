import { createHash } from "node:crypto";

export type BarcodeGenerationMode = "EAN13" | "CODE128";
export type BarcodeRenderSpec = {
  bcid: "ean13" | "code128";
  text: string;
};

const INTERNAL_EAN_PREFIX = "29";
const ORG_HASH_LENGTH = 4;
const EAN_SEQUENCE_LENGTH = 6;
const CODE128_SEQUENCE_LENGTH = 8;

const normalizeSequence = (sequence: number, modulus: number) => {
  const normalized = Math.trunc(sequence) % modulus;
  return normalized >= 0 ? normalized : normalized + modulus;
};

const padNumber = (value: number, length: number) => String(value).padStart(length, "0");

const hashToDigits = (value: string, length: number) => {
  const digest = createHash("sha1").update(value).digest("hex");
  let result = "";
  for (let index = 0; index < digest.length && result.length < length; index += 1) {
    const next = parseInt(digest[index] ?? "0", 16);
    result += String(next % 10);
  }
  while (result.length < length) {
    result += "0";
  }
  return result.slice(0, length);
};

export const normalizeBarcodeValue = (value: string) => value.replace(/\s+/g, "").trim();

export const computeEan13CheckDigit = (digits12: string) => {
  if (!/^\d{12}$/.test(digits12)) {
    throw new Error("EAN13_CHECK_DIGIT_REQUIRES_12_DIGITS");
  }
  let sum = 0;
  for (let index = 0; index < digits12.length; index += 1) {
    const next = Number(digits12[index]);
    sum += index % 2 === 0 ? next : next * 3;
  }
  return String((10 - (sum % 10)) % 10);
};

export const isValidEan13 = (value: string) => {
  const normalized = normalizeBarcodeValue(value);
  if (!/^\d{13}$/.test(normalized)) {
    return false;
  }
  return computeEan13CheckDigit(normalized.slice(0, 12)) === normalized[12];
};

export const resolveBarcodeRenderSpec = (value: string): BarcodeRenderSpec | null => {
  const normalized = normalizeBarcodeValue(value);
  if (!normalized) {
    return null;
  }

  if (isValidEan13(normalized)) {
    return { bcid: "ean13", text: normalized };
  }

  return { bcid: "code128", text: normalized };
};

export const selectPrimaryBarcodeValue = (values: string[]) => {
  const normalized = values.map(normalizeBarcodeValue).filter(Boolean);
  if (!normalized.length) {
    return "";
  }
  const eanFirst = normalized.find((value) => resolveBarcodeRenderSpec(value)?.bcid === "ean13");
  return eanFirst ?? normalized[0];
};

export const buildGeneratedBarcodeCandidate = (input: {
  organizationId: string;
  mode: BarcodeGenerationMode;
  sequence: number;
}) => {
  const orgHash = hashToDigits(input.organizationId, ORG_HASH_LENGTH);
  if (input.mode === "EAN13") {
    const modulus = 10 ** EAN_SEQUENCE_LENGTH;
    const normalizedSequence = normalizeSequence(input.sequence, modulus);
    const body = `${INTERNAL_EAN_PREFIX}${orgHash}${padNumber(normalizedSequence, EAN_SEQUENCE_LENGTH)}`;
    return `${body}${computeEan13CheckDigit(body)}`;
  }

  const modulus = 10 ** CODE128_SEQUENCE_LENGTH;
  const normalizedSequence = normalizeSequence(input.sequence, modulus);
  return `BZ${orgHash}${padNumber(normalizedSequence, CODE128_SEQUENCE_LENGTH)}`;
};

export const resolveUniqueGeneratedBarcode = async (input: {
  organizationId: string;
  mode: BarcodeGenerationMode;
  isTaken: (value: string) => Promise<boolean>;
  maxAttempts?: number;
  startSequence?: number;
}) => {
  const maxAttempts = input.maxAttempts ?? 500;
  const startSequence = input.startSequence ?? Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildGeneratedBarcodeCandidate({
      organizationId: input.organizationId,
      mode: input.mode,
      sequence: startSequence + attempt,
    });
    if (!(await input.isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error("BARCODE_GENERATION_EXHAUSTED");
};
