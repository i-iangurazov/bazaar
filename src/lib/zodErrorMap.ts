import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import { type ZodErrorMap } from "zod";

type ZodLocaleMessages = {
  invalidInput: string;
  required: string;
  invalidNumber: string;
  invalidString: string;
  invalidBoolean: string;
  invalidDate: string;
  invalidOption: string;
  minNumber: (value: string) => string;
  maxNumber: (value: string) => string;
  minString: (value: string) => string;
  maxString: (value: string) => string;
  minItems: (value: string) => string;
  maxItems: (value: string) => string;
  invalidEmail: string;
  invalidUrl: string;
};

const localeMessages: Record<Locale, ZodLocaleMessages> = {
  ru: {
    invalidInput: "Некорректные данные.",
    required: "Поле обязательно.",
    invalidNumber: "Введите число.",
    invalidString: "Введите текст.",
    invalidBoolean: "Выберите значение.",
    invalidDate: "Введите корректную дату.",
    invalidOption: "Выберите значение из списка.",
    minNumber: (value) => `Значение должно быть не меньше ${value}.`,
    maxNumber: (value) => `Значение должно быть не больше ${value}.`,
    minString: (value) => `Минимум ${value} символов.`,
    maxString: (value) => `Максимум ${value} символов.`,
    minItems: (value) => `Выберите минимум ${value}.`,
    maxItems: (value) => `Допустимо не больше ${value}.`,
    invalidEmail: "Введите корректный email.",
    invalidUrl: "Введите корректную ссылку.",
  },
  kg: {
    invalidInput: "Маалымат туура эмес.",
    required: "Талаа милдеттүү.",
    invalidNumber: "Санды киргизиңиз.",
    invalidString: "Текст киргизиңиз.",
    invalidBoolean: "Маанини тандаңыз.",
    invalidDate: "Туура датаны киргизиңиз.",
    invalidOption: "Тизмеден маанини тандаңыз.",
    minNumber: (value) => `Маани ${value} дан кем болбошу керек.`,
    maxNumber: (value) => `Маани ${value} дан көп болбошу керек.`,
    minString: (value) => `Кеминде ${value} белги керек.`,
    maxString: (value) => `Эң көп дегенде ${value} белги уруксат.`,
    minItems: (value) => `Кеминде ${value} тандаңыз.`,
    maxItems: (value) => `Эң көп дегенде ${value} уруксат.`,
    invalidEmail: "Туура email киргизиңиз.",
    invalidUrl: "Туура шилтеме киргизиңиз.",
  },
  en: {
    invalidInput: "Invalid data.",
    required: "This field is required.",
    invalidNumber: "Enter a number.",
    invalidString: "Enter text.",
    invalidBoolean: "Select a value.",
    invalidDate: "Enter a valid date.",
    invalidOption: "Select a value from the list.",
    minNumber: (value) => `Value must be at least ${value}.`,
    maxNumber: (value) => `Value must be at most ${value}.`,
    minString: (value) => `Minimum ${value} characters.`,
    maxString: (value) => `Maximum ${value} characters.`,
    minItems: (value) => `Select at least ${value}.`,
    maxItems: (value) => `No more than ${value} allowed.`,
    invalidEmail: "Enter a valid email.",
    invalidUrl: "Enter a valid URL.",
  },
};

const formatValue = (value: number | bigint) =>
  typeof value === "bigint" ? value.toString() : Number.isInteger(value) ? String(value) : String(value);

export const createLocalizedZodErrorMap = (localeInput?: string | null): ZodErrorMap => {
  const locale = normalizeLocale(localeInput) ?? defaultLocale;
  const messages = localeMessages[locale];

  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        if (issue.input === undefined) {
          return { message: messages.required };
        }
        if (issue.expected === "number" || issue.expected === "bigint") {
          return { message: messages.invalidNumber };
        }
        if (issue.expected === "string") {
          return { message: messages.invalidString };
        }
        if (issue.expected === "boolean") {
          return { message: messages.invalidBoolean };
        }
        if (issue.expected === "date") {
          return { message: messages.invalidDate };
        }
        return { message: messages.invalidInput };
      }
      case "invalid_format": {
        if (issue.format === "email") {
          return { message: messages.invalidEmail };
        }
        if (issue.format === "url") {
          return { message: messages.invalidUrl };
        }
        return { message: messages.invalidString };
      }
      case "invalid_value":
      case "unrecognized_keys":
      case "invalid_union":
      case "invalid_key":
      case "invalid_element":
      case "not_multiple_of":
        return { message: messages.invalidOption };
      case "too_small": {
        if (issue.origin === "number" || issue.origin === "bigint" || issue.origin === "date") {
          return { message: messages.minNumber(formatValue(issue.minimum)) };
        }
        if (issue.origin === "string") {
          return { message: messages.minString(formatValue(issue.minimum)) };
        }
        if (issue.origin === "array" || issue.origin === "set") {
          return { message: messages.minItems(formatValue(issue.minimum)) };
        }
        return { message: messages.invalidInput };
      }
      case "too_big": {
        if (issue.origin === "number" || issue.origin === "bigint" || issue.origin === "date") {
          return { message: messages.maxNumber(formatValue(issue.maximum)) };
        }
        if (issue.origin === "string") {
          return { message: messages.maxString(formatValue(issue.maximum)) };
        }
        if (issue.origin === "array" || issue.origin === "set") {
          return { message: messages.maxItems(formatValue(issue.maximum)) };
        }
        return { message: messages.invalidInput };
      }
      case "custom":
        return { message: issue.message || messages.invalidInput };
      default:
        return { message: messages.invalidInput };
    }
  };
};
