export type PhoneCountryCode = "KG" | "KZ" | "RU" | "UZ" | "US" | "GB" | "TR" | "AE" | "CN" | "DE";

export type PhoneCountry = {
  code: PhoneCountryCode;
  dialCode: string;
  nationalDigits: number;
  groups: number[];
  example: string;
};

export const defaultPhoneCountryCode: PhoneCountryCode = "KG";

export const phoneCountries: PhoneCountry[] = [
  {
    code: "KG",
    dialCode: "+996",
    nationalDigits: 9,
    groups: [3, 3, 3],
    example: "555 123 456",
  },
  {
    code: "KZ",
    dialCode: "+7",
    nationalDigits: 10,
    groups: [3, 3, 4],
    example: "701 123 4567",
  },
  {
    code: "RU",
    dialCode: "+7",
    nationalDigits: 10,
    groups: [3, 3, 4],
    example: "901 123 4567",
  },
  {
    code: "UZ",
    dialCode: "+998",
    nationalDigits: 9,
    groups: [2, 3, 2, 2],
    example: "90 123 45 67",
  },
  {
    code: "US",
    dialCode: "+1",
    nationalDigits: 10,
    groups: [3, 3, 4],
    example: "555 123 4567",
  },
  {
    code: "GB",
    dialCode: "+44",
    nationalDigits: 10,
    groups: [4, 6],
    example: "7700 900123",
  },
  {
    code: "TR",
    dialCode: "+90",
    nationalDigits: 10,
    groups: [3, 3, 4],
    example: "532 123 4567",
  },
  {
    code: "AE",
    dialCode: "+971",
    nationalDigits: 9,
    groups: [2, 3, 4],
    example: "50 123 4567",
  },
  {
    code: "CN",
    dialCode: "+86",
    nationalDigits: 11,
    groups: [3, 4, 4],
    example: "138 0013 8000",
  },
  {
    code: "DE",
    dialCode: "+49",
    nationalDigits: 10,
    groups: [3, 3, 4],
    example: "151 123 4567",
  },
];

const countriesByCode = new Map(phoneCountries.map((country) => [country.code, country]));
const countriesByDialCode = [...phoneCountries].sort(
  (left, right) => right.dialCode.length - left.dialCode.length,
);

export const stripPhoneDigits = (value: string) => value.replace(/\D/g, "");

export const getPhoneCountry = (code: PhoneCountryCode) =>
  countriesByCode.get(code) ?? countriesByCode.get(defaultPhoneCountryCode)!;

export const detectPhoneCountryCode = (
  value?: string | null,
  fallback: PhoneCountryCode = defaultPhoneCountryCode,
) => {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const digits = stripPhoneDigits(normalized);
  const fallbackCountry = getPhoneCountry(fallback);
  if (digits.startsWith(stripPhoneDigits(fallbackCountry.dialCode))) {
    return fallback;
  }
  const match = countriesByDialCode.find((country) =>
    digits.startsWith(stripPhoneDigits(country.dialCode)),
  );
  return match?.code ?? fallback;
};

export const extractNationalPhoneDigits = (
  value: string,
  countryCode: PhoneCountryCode,
) => {
  const country = getPhoneCountry(countryCode);
  const digits = stripPhoneDigits(value);
  const dialDigits = stripPhoneDigits(country.dialCode);
  const nationalDigits = digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits;
  return nationalDigits.slice(0, country.nationalDigits);
};

export const formatNationalPhone = (value: string, countryCode: PhoneCountryCode) => {
  const country = getPhoneCountry(countryCode);
  const digits = stripPhoneDigits(value).slice(0, country.nationalDigits);
  const parts: string[] = [];
  let offset = 0;

  for (const groupSize of country.groups) {
    if (offset >= digits.length) {
      break;
    }
    parts.push(digits.slice(offset, offset + groupSize));
    offset += groupSize;
  }

  if (offset < digits.length) {
    parts.push(digits.slice(offset));
  }

  return parts.filter(Boolean).join(" ");
};

export const formatInternationalPhone = (
  countryCode: PhoneCountryCode,
  nationalValue: string,
) => {
  const country = getPhoneCountry(countryCode);
  const national = formatNationalPhone(nationalValue, countryCode);
  return national ? `${country.dialCode} ${national}` : "";
};

export const isCompleteInternationalPhone = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }
  const countryCode = detectPhoneCountryCode(normalized);
  const country = getPhoneCountry(countryCode);
  const digits = stripPhoneDigits(normalized);
  const dialDigits = stripPhoneDigits(country.dialCode);
  return (
    digits.startsWith(dialDigits) &&
    extractNationalPhoneDigits(normalized, countryCode).length === country.nationalDigits
  );
};
