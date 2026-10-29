import { z } from "zod";
import type { BaamReadPlan } from "@/server/services/baamReadPlan";

export const baamLocaleSchema = z.enum(["ru", "en", "kg"]);
export type BaamLocale = z.infer<typeof baamLocaleSchema>;
export const baamPageSchema = z
  .object({
    path: z
      .string()
      .max(180)
      .regex(/^\/[a-zA-Z0-9/_-]*$/),
    registerId: z.string().max(100).optional(),
  })
  .strict();
export const baamSendSchema = z
  .object({
    conversationId: z.string().min(1),
    clientRequestId: z.string().uuid(),
    text: z.string().trim().min(1).max(6000),
    locale: baamLocaleSchema,
    revision: z.number().int().nonnegative(),
    page: baamPageSchema.optional(),
    attachmentIds: z.array(z.string()).max(4).default([]),
    transcriptionId: z.string().optional(),
    command: z
      .object({
        kind: z.enum(["action", "report", "help", "search"]),
        action: z.string().max(80).optional(),
        sourceWorkflowId: z.string().max(100).optional(),
        query: z.string().max(160).optional(),
        period: z.enum(["today", "yesterday", "week", "month"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BaamSend = z.infer<typeof baamSendSchema>;
export type BaamChoice = { label: string; value: string };
export type BaamPart =
  | {
      type: "metrics";
      title: string;
      period: string;
      stores: string[];
      cards: Array<{ label: string; value: string; comparison?: string }>;
      notes: string[];
    }
  | { type: "analysisContext"; token: string; dateFrom: string; dateTo: string; storeId?: string }
  | {
      type: "record";
      id: string;
      title: string;
      href: string;
      sku: string | null;
      compact?: boolean;
      hidden?: boolean;
      displayFields: Array<{ label: string; value: string }>;
    }
  | { type: "readContext"; plan: BaamReadPlan; narration?: "generated" | "facts_only" }
  | { type: "evidence"; details: string[] }
  | { type: "workflow"; workflowId: string }
  | { type: "commands"; commands: Array<{ label: string; action: string }> }
  | { type: "choices"; choices: BaamChoice[] }
  | { type: "link"; label: string; href: string }
  | { type: "attachment"; id: string; name: string; url: string }
  | { type: "action"; actionId: string }
  | { type: "transcription"; id: string; text: string };
export type BaamActionSummary = { title: string; details: string[]; href?: string };
export type BaamActionResult = {
  title: string;
  details: string[];
  href: string;
  resourceId?: string;
};

export const baamText = (locale: string, ru: string, en: string, kg: string) =>
  locale === "en" ? en : locale === "kg" ? kg : ru;

// RFC 3986 also escapes parentheses/apostrophes left intact by encodeURIComponent;
// supplier names must remain valid in allowlisted URLs and Markdown links.
export const baamUriComponent = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );

// Only application links are rendered. Provider content can never create a URL.
export const isBaamLink = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("/api/")) return false;
  const parts = value.split("?");
  if (parts.length > 2 || (parts.length === 2 && !/^[a-zA-Z0-9_%=&.-]*$/.test(parts[1]))) return false;
  const segments = parts[0].slice(1).split("/");
  // Validate each segment once. Nested optional separators in a whole-path
  // regex permit exponential backtracking on a long, invalid model response.
  if (segments.length === 1) return /^[a-z](?:[a-zA-Z0-9_-]|%3[aA])*$/.test(segments[0]);
  return segments.slice(0, -1).every((segment) => /^[a-z][a-z0-9-]*$/.test(segment)) &&
    /^(?:[a-zA-Z0-9_-]|%3[aA])*$/.test(segments[segments.length - 1]);
};
