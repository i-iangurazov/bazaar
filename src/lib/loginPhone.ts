import { getPhoneCountry, isCompleteInternationalPhone, stripPhoneDigits } from "@/lib/phoneCountries";

const kyrgyzPhone = getPhoneCountry("KG");
export const loginPhoneExample = `${kyrgyzPhone.dialCode} ${kyrgyzPhone.example}`;

export const normalizeLoginPhone = (value?: string | null): string | null => {
  const input = value?.trim();
  if (!input || input.length > 40 || !/^\+?[\d\s().-]+$/.test(input)) return null;

  const digits = stripPhoneDigits(input);
  const kg = kyrgyzPhone;
  const kgPrefix = stripPhoneDigits(kg.dialCode);
  let international: string;
  if (input.startsWith("+")) international = `+${digits}`;
  else if (digits.startsWith("00")) international = `+${digits.slice(2)}`;
  else if (digits.length === kgPrefix.length + kg.nationalDigits && digits.startsWith(kgPrefix)) {
    international = `+${digits}`;
  } else {
    const national = digits.length === kg.nationalDigits + 1 && digits.startsWith("0")
      ? digits.slice(1)
      : digits;
    if (national.length !== kg.nationalDigits) return null;
    international = `${kg.dialCode}${national}`;
  }

  if (international.startsWith(`${kg.dialCode}0`)) return null;
  return isCompleteInternationalPhone(international) ? international : null;
};
