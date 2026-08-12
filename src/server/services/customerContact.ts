import {
  normalizeCustomerContactAddress,
  normalizeCustomerContactPhone,
} from "@/lib/customerContact";
import { AppError } from "@/server/services/errors";

const trimToNull = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const normalizeOptionalCustomerPhone = (value?: string | null) => {
  const raw = trimToNull(value);
  if (!raw) {
    return null;
  }
  const phone = normalizeCustomerContactPhone(raw);
  if (!phone) {
    throw new AppError("customerPhoneInvalid", "BAD_REQUEST", 400);
  }
  return phone;
};

export const normalizeOptionalCustomerAddress = (value?: string | null) => {
  const raw = trimToNull(value);
  if (!raw) {
    return null;
  }
  const address = normalizeCustomerContactAddress(raw);
  if (!address) {
    throw new AppError("customerAddressInvalid", "BAD_REQUEST", 400);
  }
  return address;
};

export const normalizeUpdatedCustomerPhone = (
  value: string | null | undefined,
  existingValue: string | null | undefined,
) => {
  if (trimToNull(value) === trimToNull(existingValue)) {
    return trimToNull(existingValue);
  }
  return normalizeOptionalCustomerPhone(value);
};

export const normalizeUpdatedCustomerAddress = (
  value: string | null | undefined,
  existingValue: string | null | undefined,
) => {
  if (trimToNull(value) === trimToNull(existingValue)) {
    return trimToNull(existingValue);
  }
  return normalizeOptionalCustomerAddress(value);
};
