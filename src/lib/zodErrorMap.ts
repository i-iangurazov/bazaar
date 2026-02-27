import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import { z, type ZodErrorMap } from "zod";

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
};

const formatValue = (value: number | bigint) =>
  typeof value === "bigint" ? value.toString() : Number.isInteger(value) ? String(value) : String(value);

export const createLocalizedZodErrorMap = (localeInput?: string | null): ZodErrorMap => {
  const locale = normalizeLocale(localeInput) ?? defaultLocale;
  const messages = localeMessages[locale];

  return (issue, ctx) => {
    switch (issue.code) {
      case z.ZodIssueCode.invalid_type: {
        if (issue.received === "undefined") {
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
      case z.ZodIssueCode.invalid_string: {
        if (issue.validation === "email") {
          return { message: messages.invalidEmail };
        }
        if (issue.validation === "url") {
          return { message: messages.invalidUrl };
        }
        return { message: messages.invalidString };
      }
      case z.ZodIssueCode.invalid_enum_value:
      case z.ZodIssueCode.invalid_literal:
      case z.ZodIssueCode.unrecognized_keys:
      case z.ZodIssueCode.invalid_union:
      case z.ZodIssueCode.invalid_union_discriminator:
      case z.ZodIssueCode.invalid_arguments:
      case z.ZodIssueCode.invalid_return_type:
      case z.ZodIssueCode.invalid_date:
      case z.ZodIssueCode.invalid_intersection_types:
      case z.ZodIssueCode.not_multiple_of:
      case z.ZodIssueCode.not_finite:
        return { message: messages.invalidOption };
      case z.ZodIssueCode.too_small: {
        if (issue.type === "number" || issue.type === "bigint" || issue.type === "date") {
          return { message: messages.minNumber(formatValue(issue.minimum)) };
        }
        if (issue.type === "string") {
          return { message: messages.minString(formatValue(issue.minimum)) };
        }
        if (issue.type === "array" || issue.type === "set") {
          return { message: messages.minItems(formatValue(issue.minimum)) };
        }
        return { message: messages.invalidInput };
      }
      case z.ZodIssueCode.too_big: {
        if (issue.type === "number" || issue.type === "bigint" || issue.type === "date") {
          return { message: messages.maxNumber(formatValue(issue.maximum)) };
        }
        if (issue.type === "string") {
          return { message: messages.maxString(formatValue(issue.maximum)) };
        }
        if (issue.type === "array" || issue.type === "set") {
          return { message: messages.maxItems(formatValue(issue.maximum)) };
        }
        return { message: messages.invalidInput };
      }
      case z.ZodIssueCode.custom:
        return { message: issue.message || ctx.defaultError || messages.invalidInput };
      default:
        return { message: messages.invalidInput };
    }
  };
};
