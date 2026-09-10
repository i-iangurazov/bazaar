import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { baamText, type BaamPart, type BaamSend } from "@/lib/baam/companion";
import { workflowTitle, type WorkflowValues } from "@/lib/baam/workflows";
import {
  appendBaamMessage,
  assertBaamTurnActive,
  baamAccess,
  claimBaamTurn,
  readBaamConversation,
} from "./baamConversations";
import { baamActions, businessCaller } from "./baamBusiness";
import { baamHelp, baamSearch, baamInspect } from "./baamReadTools";
import { getBaamSalesMetrics } from "./baamMetrics";
import { AppError } from "./errors";
import { parseBaamFastIntent, understandBaamIntent, baamChoiceText } from "./baamWorkflowIntent";
import {
  createBaamWorkflow,
  submitBaamWorkflow,
  cleanWorkflowInput,
  cancelActiveWorkflow,
} from "./baamWorkflows";
import { workflowCatalog } from "./baamWorkflowCatalog";
export { baamToolSchema, baamOptionalValues } from "./baamToolContract";
const controllers = new Map<string, AbortController>();
export const abortBaamGeneration = (conversationId: string) =>
  controllers.get(conversationId)?.abort();
export async function baamCompanionCapabilities(ctx: Context) {
  const { scope } = await baamAccess(ctx);
  return {
    stores: scope.availableStores,
    role: scope.role,
    organizationId: scope.organizationId,
    actorId: scope.actorId,
    configured: Boolean(process.env.OPENAI_API_KEY),
    voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
    actions: Object.values(baamActions)
      .filter((a) => a.roles.includes(scope.role))
      .map((a) => a.name),
    workflows: workflowCatalog(scope.role, "ru").map(({ kind }) => kind),
  };
}
export function baamReportPeriod(period: string, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const end = new Date(`${date}T00:00:00Z`);
  const start = new Date(end);
  if (period === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() - 1);
  } else if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  else if (period === "month") start.setUTCDate(1);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}
export async function sendBaamMessage(ctx: Context, input: BaamSend) {
  const started = performance.now();
  let modelCalls = 0;
  const claimed = await claimBaamTurn(ctx, input);
  const { turn, conversation } = claimed;
  if (!claimed.fresh)
    return {
      turnId: turn.id,
      status: turn.status,
      replayed: true,
      data: await readBaamConversation(ctx, conversation.id),
    };
  const controller = new AbortController();
  controllers.set(conversation.id, controller);
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const active = conversation.activeWorkflowId
      ? await prisma.baamWorkflow.findUnique({ where: { id: conversation.activeWorkflowId } })
      : null;
    const current =
      active && ["EDITING", "FAILED", "RECEIPT"].includes(active.status)
        ? { kind: active.kind, parameters: active.parameters as WorkflowValues }
        : undefined;
    let intent = parseBaamFastIntent(input.text, input.command, current);
    if (!intent) {
      const history = await prisma.baamMessage.findMany({
        where: {
          conversationId: conversation.id,
          turn: { scopeRevision: turn.scopeRevision },
          role: "user",
          turnId: { not: turn.id },
        },
        orderBy: { sequence: "desc" },
        take: 4,
      });
      modelCalls = process.env.OPENAI_API_KEY ? 1 : 0;
      intent = await understandBaamIntent({
        text: input.text,
        locale: input.locale,
        history: history.reverse().map((m) => m.text.slice(0, 800)),
        active: current,
        signal: controller.signal,
        record: (details) => {
          console.info("baam.intent", { turnId: turn.id, ...details });
        },
      });
    }
    await assertBaamTurnActive(ctx, turn.id);
    if (input.command?.sourceWorkflowId) {
      const source = await prisma.baamWorkflow.findFirst({
        where: {
          id: input.command.sourceWorkflowId,
          conversationId: conversation.id,
          scopeRevision: conversation.revision,
          status: { in: ["COMPLETED", "RECEIPT", "SUPERSEDED"] },
        },
      });
      if (!source?.resourceId) throw new AppError("baamActionNotFound", "NOT_FOUND", 404);
      if (
        intent.action === "product_update" &&
        ["product_create", "product_update"].includes(source.kind)
      )
        intent.parameters = { productId: source.resourceId };
      else if (intent.action?.startsWith("pos_") && source.kind.startsWith("pos_"))
        intent.parameters = { saleId: source.resourceId };
      else throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    let text = "",
      parts: BaamPart[] = [];
    let workflow: Awaited<ReturnType<typeof createBaamWorkflow>> | undefined;
    if (intent.confidence === "low" || intent.kind === "choice") {
      text = baamChoiceText(input.locale);
      parts = [
        {
          type: "commands",
          commands: ["product_create", "pos_create_draft", "stock_receive"].map((action) => ({
            action,
            label: workflowTitle(action, input.locale),
          })),
        },
      ];
    } else if (intent.kind === "action" || intent.kind === "correction") {
      if (!intent.action) throw new AppError("baamActionUnavailable", "BAD_REQUEST", 400);
      if (intent.kind === "correction" && active?.resourceId) {
        const edits = intent.parameters.lines;
        if (
          active.kind === "pos_create_draft" &&
          Array.isArray(edits) &&
          edits.length === 1 &&
          edits[0] &&
          typeof edits[0] === "object" &&
          !Array.isArray(edits[0]) &&
          typeof edits[0].qty === "number"
        ) {
          const sale = await businessCaller(ctx).pos.sales.get({ saleId: active.resourceId });
          const requested = edits[0];
          const matches =
            sale?.lines.filter(
              (l) => !requested.productId || l.productId === requested.productId,
            ) ?? [];
          workflow = await createBaamWorkflow(ctx, turn.id, "pos_update_line", {
            saleId: active.resourceId,
            qty: requested.qty,
            ...(matches.length === 1 ? { lineId: matches[0].id } : {}),
          });
          text = baamText(
            input.locale,
            "Проверьте изменение количества в существующем чеке.",
            "Review the quantity change in the existing receipt.",
            "Учурдагы чектеги сандын өзгөрүшүн текшериңиз.",
          );
          parts = [{ type: "workflow", workflowId: workflow.id }];
        } else {
          text = baamText(
            input.locale,
            "Чек уже подготовлен. Используйте «Добавить товар», «Изменить строку» или «Убрать строку» в карточке. Магазин существующего чека не переносится автоматически.",
            "The receipt is prepared. Use Add, Edit or Remove item on the card. An existing receipt is not automatically moved to another store.",
            "Чек даярдалды. Карточкадан товар кошууну, сапты өзгөртүүнү же өчүрүүнү тандаңыз. Учурдагы чек башка дүкөнгө автоматтык которулбайт.",
          );
          parts = [{ type: "workflow", workflowId: active.id }];
        }
      } else {
        let parameters =
          intent.kind === "correction" && current
            ? { ...current.parameters, ...intent.parameters }
            : intent.parameters;
        if (
          input.attachmentIds.length &&
          ["product_create", "product_update"].includes(intent.action)
        )
          parameters = {
            ...parameters,
            attachmentId: input.attachmentIds[0],
            ...(intent.action === "product_create"
              ? { imageChoice: "attached_photo" }
              : { photo: "attach" }),
          };
        workflow = await createBaamWorkflow(ctx, turn.id, intent.action, parameters);
        text = baamText(
          input.locale,
          "Проверьте и заполните данные. Фотографию можно добавить или продолжить без неё.",
          "Review and fill in the details. A photo is optional.",
          "Маалыматтарды текшерип, толтуруңуз. Сүрөт кошсоңуз же сүрөтсүз улантсаңыз болот.",
        );
        if (!["product_create", "product_update"].includes(intent.action))
          text = baamText(
            input.locale,
            "Проверьте данные и выполните действие.",
            "Review the details and perform the action.",
            "Маалыматтарды текшерип, иш-аракетти аткарыңыз.",
          );
        parts = [{ type: "workflow", workflowId: workflow.id }];
      }
    } else if (intent.kind === "cancel") {
      if (active?.resourceId) {
        text = baamText(
          input.locale,
          "Документ уже существует. Для отмены чека используйте «Отменить чек» в карточке. Остановка ответа не отменяет продажу.",
          "The document already exists. Use Cancel receipt on its card. Stopping a response does not reverse a sale.",
          "Документ бар. Карточкадагы «Чекти жокко чыгаруу» баскычын колдонуңуз. Жоопту токтотуу сатууну жокко чыгарбайт.",
        );
        parts = [{ type: "workflow", workflowId: active.id }];
      } else {
        await cancelActiveWorkflow(ctx, conversation.id);
        text = baamText(
          input.locale,
          "Действие отменено.",
          "Action cancelled.",
          "Иш-аракет жокко чыгарылды.",
        );
      }
    } else if (intent.kind === "report" && !intent.period && !(intent.dateFrom && intent.dateTo)) {
      text = baamText(
        input.locale,
        "За какой период показать продажи? Можно написать точные даты.",
        "Which sales period? You can enter exact dates.",
        "Сатууларды кайсы мезгил үчүн көрсөтөлү? Так даталарды жазсаңыз болот.",
      );
      parts = [
        {
          type: "choices",
          choices: [
            ["Продажи за сегодня", "Sales today", "Бүгүнкү сатуулар"],
            ["Продажи за неделю", "Sales this week", "Бул аптада сатуулар кандай"],
            ["Продажи за месяц", "Sales this month", "Бул айдагы сатуулар"],
          ].map((v) => ({
            label: baamText(input.locale, v[0], v[1], v[2]),
            value: baamText(input.locale, v[0], v[1], v[2]),
          })),
        },
      ];
    } else if (intent.kind === "report") {
      const period =
        intent.dateFrom && intent.dateTo
          ? { dateFrom: intent.dateFrom, dateTo: intent.dateTo }
          : baamReportPeriod(intent.period ?? "today");
      const metrics = await getBaamSalesMetrics({
        ...period,
        storeId: conversation.storeId ?? undefined,
        actorId: ctx.user!.id,
      });
      const n = (v: number) =>
        new Intl.NumberFormat(input.locale === "kg" ? "ru" : input.locale, {
          maximumFractionDigits: 2,
        }).format(v);
      const t = metrics.totals;
      text =
        `${period.dateFrom} — ${period.dateTo} · Asia/Bishkek\n` +
        baamText(
          input.locale,
          `Продажи после возвратов: ${n(t.netSalesKgs)} KGS\nЧеков: ${t.receiptCount}\nВозвраты: ${n(t.returnsKgs)} KGS\nСредний чек: ${t.averageReceiptKgs === null ? "—" : n(t.averageReceiptKgs) + " KGS"}`,
          `Net sales: ${n(t.netSalesKgs)} KGS\nReceipts: ${t.receiptCount}\nReturns: ${n(t.returnsKgs)} KGS\nAverage receipt: ${t.averageReceiptKgs === null ? "—" : n(t.averageReceiptKgs) + " KGS"}`,
          `Кайтаруулардан кийинки сатуулар: ${n(t.netSalesKgs)} KGS\nЧектер: ${t.receiptCount}\nКайтаруулар: ${n(t.returnsKgs)} KGS\nОрточо чек: ${t.averageReceiptKgs === null ? "—" : n(t.averageReceiptKgs) + " KGS"}`,
        );
      if (!t.receiptCount && !t.returnCount)
        text +=
          "\n" +
          baamText(
            input.locale,
            "За этот период проведённых чеков и возвратов нет.",
            "There are no completed receipts or returns in this period.",
            "Бул мезгилде аяктаган чектер жана кайтаруулар жок.",
          );
      parts = [
        {
          type: "link",
          label: baamText(input.locale, "Открыть отчёт", "Open report", "Отчётту ачуу"),
          href: `/reports/analytics?${new URLSearchParams({ ...period, ...(conversation.storeId ? { storeId: conversation.storeId } : {}) })}`,
        },
      ];
    } else if (intent.kind === "search") {
      const found = (await baamSearch(ctx, {
        kind: "products",
        query: intent.query,
        storeId: conversation.storeId ?? undefined,
        offset: 0,
      })) as { items: Array<{ id: string; name: string; sku: string }> };
      text = baamText(
        input.locale,
        "Найденные товары. Остатки указаны в основных единицах.",
        "Matching products. Stock is in base units.",
        "Табылган товарлар. Калдыктар негизги бирдиктерде.",
      );
      if (found.items.length === 1) {
        const stock = (await baamInspect(ctx, {
          kind: "stock",
          id: found.items[0].id,
          storeId: conversation.storeId ?? undefined,
        })) as { snapshots: Array<{ storeId: string; onHand: number; variantId: string | null }> };
        const { scope } = await baamAccess(ctx);
        text =
          found.items[0].name +
          "\n" +
          stock.snapshots
            .map(
              (s) =>
                `${scope.availableStores.find((x) => x.id === s.storeId)?.name ?? ""}${s.variantId ? " · " + baamText(input.locale, "вариант", "variant", "вариант") : ""}: ${s.onHand}`,
            )
            .join("\n");
        if (!stock.snapshots.length)
          text +=
            "\n" +
            baamText(
              input.locale,
              "Нет сохранённых данных об остатке.",
              "No recorded stock data.",
              "Калдык жөнүндө маалымат жок.",
            );
      }
      if (!found.items.length)
        text = baamText(
          input.locale,
          "Товары не найдены. Уточните название или артикул.",
          "No products found. Refine the name or SKU.",
          "Товарлар табылган жок. Аталышын же артикулун тактаңыз.",
        );
      parts = found.items
        .slice(0, 10)
        .map((p) => ({ type: "link", label: `${p.name} · ${p.sku}`, href: `/products/${p.id}` }));
    } else {
      const guides = await baamHelp(
        ctx,
        {
          page: /reports|отч[её]т|прибыл|profit|report|отчет/i.test(intent.query ?? input.text)
            ? "/reports"
            : /товар|product|товарды/i.test(input.text)
              ? "/products"
              : input.page?.path,
        },
        input.locale,
      );
      const list = Array.isArray(guides) ? guides : [];
      text =
        list[0]?.summary ??
        baamText(
          input.locale,
          "Выберите нужную инструкцию или действие.",
          "Choose a guide or action.",
          "Нускаманы же иш-аракетти тандаңыз.",
        );
      parts = list.slice(0, 4).map((g) => ({ type: "link", label: g.title, href: g.href }));
      if (!parts.length)
        parts = [
          {
            type: "link",
            label: baamText(
              input.locale,
              "Инструкции Bazaar",
              "Bazaar guides",
              "Bazaar нускамалары",
            ),
            href: "/help",
          },
        ];
    }
    await finishBaamTurn(ctx, turn.id, "COMPLETED", text, parts);
    if (
      workflow &&
      intent.kind === "action" &&
      ["product_create", "customer_create", "supplier_create", "pos_create_draft"].includes(
        workflow.kind,
      ) &&
      Object.keys(intent.parameters).length > 0
    ) {
      const params = workflow.parameters as WorkflowValues;
      if (
        baamActions[workflow.kind].schema.safeParse(cleanWorkflowInput(workflow.kind, params))
          .success
      )
        await submitBaamWorkflow(ctx, {
          id: workflow.id,
          revision: workflow.revision,
          parameters: params,
          clientRequestId: randomUUID(),
          operation: "execute",
        });
    }
  } catch (error) {
    const latest = await prisma.baamTurn.findUnique({ where: { id: turn.id } });
    const stopped = latest?.cancelRequested || latest?.status === "CANCELLED";
    const code = stopped
      ? "baamStopped"
      : error instanceof AppError
        ? error.message
        : "baamProviderUnavailable";
    await prisma.$transaction(async (tx) => {
      const updated = await tx.baamTurn.updateMany({
        where: { id: turn.id, status: "RUNNING" },
        data: {
          status: stopped ? "CANCELLED" : "FAILED",
          errorCode: code,
          completedAt: new Date(),
        },
      });
      if (updated.count) {
        await tx.baamConversation.updateMany({
          where: { id: conversation.id, activeTurnId: turn.id },
          data: { activeTurnId: null },
        });
        await appendBaamMessage(tx, {
          conversationId: conversation.id,
          turnId: turn.id,
          role: "error",
          text: code,
        });
      }
    });
  } finally {
    clearTimeout(timeout);
    if (controllers.get(conversation.id) === controller) controllers.delete(conversation.id);
    console.info("baam.request", {
      turnId: turn.id,
      ms: Math.round(performance.now() - started),
      modelCalls,
    });
  }
  const data = await readBaamConversation(ctx, conversation.id);
  return {
    turnId: turn.id,
    status: (await prisma.baamTurn.findUniqueOrThrow({ where: { id: turn.id } })).status,
    replayed: false,
    data,
  };
}
async function finishBaamTurn(
  ctx: Context,
  turnId: string,
  status: string,
  text: string,
  parts: BaamPart[],
) {
  const { turn } = await assertBaamTurnActive(ctx, turnId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BaamConversation" WHERE "id" = ${turn.conversationId} FOR UPDATE`;
    const won = await tx.baamTurn.updateMany({
      where: { id: turnId, status: "RUNNING", cancelRequested: false },
      data: { status, completedAt: new Date() },
    });
    if (!won.count) throw new AppError("baamStopped", "CONFLICT", 409);
    await appendBaamMessage(tx, {
      conversationId: turn.conversationId,
      turnId,
      role: "assistant",
      text,
      parts,
    });
    await tx.baamConversation.updateMany({
      where: { id: turn.conversationId, activeTurnId: turnId },
      data: { activeTurnId: null },
    });
  });
}
