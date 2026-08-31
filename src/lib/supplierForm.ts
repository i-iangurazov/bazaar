export type SupplierFormValues = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export const SUPPLIER_NAME_MAX_LENGTH = 180;
export const SUPPLIER_EMAIL_MAX_LENGTH = 254;
export const SUPPLIER_PHONE_MAX_LENGTH = 80;
export const SUPPLIER_NOTES_MAX_LENGTH = 2_000;

const optionalTrimmedValue = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeSupplierMutationInput = (values: SupplierFormValues) => ({
  name: values.name.trim(),
  email: optionalTrimmedValue(values.email),
  phone: optionalTrimmedValue(values.phone),
  notes: optionalTrimmedValue(values.notes),
});
