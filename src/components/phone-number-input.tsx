"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultPhoneCountryCode,
  detectPhoneCountryCode,
  extractNationalPhoneDigits,
  formatInternationalPhone,
  formatNationalPhone,
  getPhoneCountry,
  phoneCountries,
  type PhoneCountryCode,
} from "@/lib/phoneCountries";

type PhoneNumberInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputId?: string;
  placeholder?: string;
  countrySelectLabel: string;
};

export const PhoneNumberInput = ({
  value,
  onChange,
  disabled,
  inputId,
  placeholder,
  countrySelectLabel,
}: PhoneNumberInputProps) => {
  const [selectedCountryCode, setSelectedCountryCode] =
    useState<PhoneCountryCode>(defaultPhoneCountryCode);

  useEffect(() => {
    if (!value.trim()) {
      return;
    }
    setSelectedCountryCode((current) => detectPhoneCountryCode(value, current));
  }, [value]);

  const selectedCountry = getPhoneCountry(selectedCountryCode);
  const nationalValue = useMemo(
    () =>
      formatNationalPhone(
        extractNationalPhoneDigits(value, selectedCountryCode),
        selectedCountryCode,
      ),
    [selectedCountryCode, value],
  );

  const handleCountryChange = (nextValue: string) => {
    const nextCountryCode = nextValue as PhoneCountryCode;
    const nextCountry = getPhoneCountry(nextCountryCode);
    const nationalDigits = extractNationalPhoneDigits(value, selectedCountryCode).slice(
      0,
      nextCountry.nationalDigits,
    );
    setSelectedCountryCode(nextCountryCode);
    onChange(formatInternationalPhone(nextCountryCode, nationalDigits));
  };

  const handleNationalChange = (nextValue: string) => {
    const nationalDigits = extractNationalPhoneDigits(nextValue, selectedCountryCode);
    onChange(formatInternationalPhone(selectedCountryCode, nationalDigits));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[8.5rem_1fr]">
      <Select
        value={selectedCountryCode}
        onValueChange={handleCountryChange}
        disabled={disabled}
      >
        <SelectTrigger aria-label={countrySelectLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {phoneCountries.map((country) => (
            <SelectItem key={country.code} value={country.code}>
              {country.code} {country.dialCode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={inputId}
        inputMode="tel"
        autoComplete="tel-national"
        value={nationalValue}
        onChange={(event) => handleNationalChange(event.target.value)}
        placeholder={placeholder ?? selectedCountry.example}
        maxLength={selectedCountry.example.length}
        disabled={disabled}
      />
    </div>
  );
};
