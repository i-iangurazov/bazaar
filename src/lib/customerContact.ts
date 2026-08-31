import { isCompleteInternationalPhone } from "@/lib/phoneCountries";

export const CUSTOMER_PHONE_MAX_LENGTH = 64;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const CUSTOMER_ADDRESS_MIN_LENGTH = 2;
export const CUSTOMER_ADDRESS_MAX_LENGTH = 500;

const customerEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trimToNull = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const normalizeCustomerContactEmail = (value?: string | null) => {
  const normalized = trimToNull(value)?.toLowerCase() ?? null;
  return normalized &&
    normalized.length <= CUSTOMER_EMAIL_MAX_LENGTH &&
    customerEmailPattern.test(normalized)
    ? normalized
    : null;
};

export const isValidOptionalCustomerEmail = (value?: string | null) => {
  const normalized = trimToNull(value);
  return !normalized || normalizeCustomerContactEmail(normalized) !== null;
};

export const normalizeCustomerContactPhone = (value?: string | null) => {
  const raw = trimToNull(value);
  if (!raw || raw.length > CUSTOMER_PHONE_MAX_LENGTH) {
    return null;
  }
  const normalized = raw?.replace(/^[\uFEFF\u200B\u200C\u200D'’‘`´]+/, "").trim();
  if (!normalized || !isCompleteInternationalPhone(normalized)) {
    return null;
  }
  const digits = normalized.replace(/\D/g, "");
  return `+${digits}`;
};

export const isValidOptionalCustomerPhone = (value?: string | null) => {
  const normalized = trimToNull(value);
  return (
    !normalized ||
    (normalized.length <= CUSTOMER_PHONE_MAX_LENGTH &&
      normalizeCustomerContactPhone(normalized) !== null)
  );
};

export const normalizeCustomerContactAddress = (value?: string | null) => {
  const normalized = trimToNull(value)?.replace(/\s+/g, " ") ?? null;
  return normalized &&
    normalized.length >= CUSTOMER_ADDRESS_MIN_LENGTH &&
    normalized.length <= CUSTOMER_ADDRESS_MAX_LENGTH &&
    /[\p{L}\p{N}]/u.test(normalized) &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
    ? normalized
    : null;
};

export const isValidOptionalCustomerAddress = (value?: string | null) => {
  const normalized = trimToNull(value);
  return (
    !normalized ||
    (normalized.length <= CUSTOMER_ADDRESS_MAX_LENGTH &&
      normalizeCustomerContactAddress(normalized) !== null)
  );
};
