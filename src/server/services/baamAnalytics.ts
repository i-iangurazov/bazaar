import type { Context } from "@/server/trpc/trpc";
import { prisma } from "@/server/db/prisma";
import { baamText, type BaamPart, type BaamSend } from "@/lib/baam/companion";
import { askBaam } from "./baamAssistant";
import { ownBaamConversation } from "./baamConversations";
import { baamReportPeriod } from "./baamPeriods";
import { readBaamContext } from "./baamConversation";

export type BaamAnalysisContext = {
  type: "analysisContext";
  token: string;
  dateFrom: string;
  dateTo: string;
  storeId?: string;
};

export async function latestBaamAnalysis(ctx: Context, conversationId: string) {
  const { scope, conversation } = await ownBaamConversation(ctx, conversationId);
  const messages = await prisma.baamMessage.findMany({
    where: {
      conversationId,
      role: "assistant",
      turn: { scopeRevision: conversation.revision },
    },
    orderBy: { sequence: "desc" },
    take: 12,
  });
  for (const message of messages) {
    for (const part of (Array.isArray(message.parts)
      ? message.parts
      : []) as unknown as BaamPart[]) {
      if (part.type !== "analysisContext") continue;
      const parsed = readBaamContext(
        part.token,
        {
          actorId: scope.actorId,
          organizationId: scope.organizationId,
          authorizationFingerprint: scope.authorizationFingerprint,
        },
        process.env.NEXTAUTH_SECRET?.trim() ?? "",
      );
      if (parsed) return { ...part, plan: parsed.plan };
    }
  }
  return null;
}

export async function answerBaamAnalytics(
  ctx: Context,
  input: BaamSend,
  selectedStoreId?: string,
  range?: { dateFrom: string; dateTo: string },
  simpleSummary = false,
) {
  const previous = await latestBaamAnalysis(ctx, input.conversationId);
  const period = previous
    ? { dateFrom: previous.dateFrom, dateTo: previous.dateTo }
    : (range ?? baamReportPeriod("month"));
  const productMatch = /^\/products\/([A-Za-z0-9_-]{1,128})$/.exec(input.page?.path ?? "");
  const result = await askBaam(
    {
      actorId: ctx.user!.id,
      question: input.text.slice(0, 1500),
      locale: input.locale,
      ...period,
      storeId: selectedStoreId ?? previous?.storeId,
      ...(previous ? { contextToken: previous.token } : {}),
      ...(productMatch ? { pageContext: { kind: "product" as const, id: productMatch[1] } } : {}),
    },
    { summary: simpleSummary },
  );
  const parts: BaamPart[] = [];
  if ("presentation" in result && result.presentation)
    parts.push({
      ...result.presentation,
      notes: [...result.presentation.notes, result.scope.reason],
    });
  for (const card of result.products) parts.push({ type: "record", ...card });
  for (const action of result.actions)
    parts.push({ type: "link", label: action.label, href: action.href });
  if (result.analyticsHref)
    parts.push({
      type: "link",
      label: baamText(input.locale, "Открыть отчёт", "Open report", "Отчётту ачуу"),
      href: result.analyticsHref,
    });
  const details =
    result.productEvidence?.details ??
    (result.evidence
      ? [
          `${result.scope.dateFrom} — ${result.scope.dateTo} · ${result.scope.timeZone}`,
          result.evidence.storeNames.join(", "),
          baamText(
            input.locale,
            "Источник: проведённые продажи и возвраты Bazaar",
            "Source: completed Bazaar sales and returns",
            "Булак: Bazaar ичиндеги аяктаган сатуулар жана кайтаруулар",
          ),
        ]
      : []);
  if (details.length) parts.push({ type: "evidence", details });
  if (result.contextToken)
    parts.push({
      type: "analysisContext",
      token: result.contextToken,
      dateFrom: result.scope.dateFrom,
      dateTo: result.scope.dateTo,
      ...(result.scope.storeId ? { storeId: result.scope.storeId } : {}),
    });
  if (result.followUps.length)
    parts.push({
      type: "choices",
      choices: result.followUps.slice(0, 4).map((value) => ({ label: value, value })),
    });
  return { text: result.answer, parts };
}
