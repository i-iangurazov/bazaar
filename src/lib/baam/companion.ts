import { z } from "zod";

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

// Only application links are rendered. Provider content can never create a URL.
export const isBaamLink = (value: string) =>
  /^\/(?:[a-z][a-z0-9-]*\/?)+(?:[a-zA-Z0-9_-]+)?(?:\?[a-zA-Z0-9_%=&.-]*)?$/.test(value) &&
  !value.startsWith("/api/");
