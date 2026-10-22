import { baamReportPeriod } from "./baamPeriods";
export { baamReportPeriod } from "./baamPeriods";
import { resolveTextAiConfig } from "./aiProvider";
import { readBaamImages } from "./baamVision";
import { answerBaamAnalytics, latestBaamAnalysis } from "./baamAnalytics";
import { answerBaamRecords } from "./baamRecordAnswers";
import { baamGuideContext } from "./baamGuideContext";
import { parseLocalBaamProductPlan } from "./baamProductPlan";
import { diagnosticBaamPlan } from "./baamLocalIntent";
import { bindBaamRecentRecord, type BaamRecentRecord } from "./baamRecentRecords";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { baamText, type BaamPart, type BaamSend } from "@/lib/baam/companion";
import { workflowTitle, mergeWorkflowCorrection, type WorkflowValues } from "@/lib/baam/workflows";
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
import {
  parseBaamFastIntent,
  understandBaamIntent,
  baamChoiceText,
  isBaamExecutionConfirmation,
} from "./baamWorkflowIntent";
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
    configured: Boolean(resolveTextAiConfig()),
    provider: resolveTextAiConfig()?.provider ?? null,
    voiceConfigured: Boolean(process.env.OPENAI_API_KEY),
    actions: Object.values(baamActions)
      .filter((a) => a.roles.includes(scope.role))
      .map((a) => a.name),
    workflows: workflowCatalog(scope.role, "ru").map(({ kind }) => kind),
  };
}

export async function sendBaamMessage(ctx: Context, input: BaamSend) {
  const started = performance.now();
  let modelCalls = 0;
  let analyzedAttachment = false;
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
    if (!intent && active?.status === "COMPLETED" && isBaamExecutionConfirmation(input.text))
      intent = { kind: "confirm", parameters: {}, confidence: "high", source: "grammar" };
    let recentRecords: BaamRecentRecord[] = [];
    if (intent?.kind === "help" && !input.command && resolveTextAiConfig()) intent = null;
    // Reuse the existing read planner for obvious product analytics, including
    // top-N. Keep action/correction parsing ahead of this read-only shortcut.
    if (!intent && (parseLocalBaamProductPlan(input.text) || diagnosticBaamPlan(input.text))) {
      intent = { kind: "analytics", parameters: {}, confidence: "high", source: "grammar" };
    }
    if (!intent) {
      const history = await prisma.baamMessage.findMany({
        where: {
          conversationId: conversation.id,
          turn: { scopeRevision: turn.scopeRevision },
          role: { in: ["user", "assistant"] },
          turnId: { not: turn.id },
        },
        orderBy: { sequence: "desc" },
        take: 12,
      });
      const dialogue = history.reverse().map((m) => ({
        role: m.role,
        // The model gets explanations and task context, never authoritative
        // sales totals or record contents from the server's read results.
        text:
          m.role === "assistant" &&
          Array.isArray(m.parts) &&
          (m.parts as Array<{ type?: string }>).some((p) =>
            ["analysisContext", "salesMetrics", "record", "evidence", "attachment"].includes(
              p.type ?? "",
            ),
          )
            ? "[The application displayed authorized business data; use the supplied analytical context for follow-ups.]"
            : m.text.slice(0, 1200),
      }));
      const images = await readBaamImages(ctx, conversation.id, input.attachmentIds);
      analyzedAttachment = images.length > 0;
      const recentWorkflows = await prisma.baamWorkflow.findMany({
        where: {
          conversationId: conversation.id,
          scopeRevision: conversation.revision,
          status: { in: ["COMPLETED", "RECEIPT"] },
          resourceId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { kind: true, resourceId: true, parameters: true },
      });
      recentRecords = recentWorkflows.map((w) => ({
        kind: w.kind,
        resourceId: w.resourceId!,
        ...(typeof (w.parameters as WorkflowValues).name === "string"
          ? { name: (w.parameters as WorkflowValues).name as string }
          : {}),
      }));
      intent = await understandBaamIntent({
        text: input.text,
        locale: input.locale,
        history: dialogue
          .filter((m) => m.role === "user")
          .slice(-4)
          .map((m) => m.text.slice(0, 800)),
        dialogue,
        active: current,
        previousAnalysis: (await latestBaamAnalysis(ctx, conversation.id))?.plan,
        page: input.page?.path,
        recentRecords,
        images,
        signal: controller.signal,
        record: (details) => {
          modelCalls++;
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
    let confirmation: typeof active | undefined;
    if (intent.kind === "confirm" && active) {
      parts = [{ type: "workflow", workflowId: active.id }];
      const complete = baamActions[active.kind]?.schema.safeParse(
        cleanWorkflowInput(active.kind, active.parameters as WorkflowValues),
      ).success;
      const presentation = active.presentation as unknown as {
        choices?: Record<string, unknown[]>;
      };
      const unresolved = Object.values(presentation.choices ?? {}).some(
        (choices) => choices.length > 0,
      );
      if (["EDITING", "FAILED"].includes(active.status) && complete && !unresolved) {
        confirmation = active;
        text = baamText(
          input.locale,
          "Подтверждение получено. Результат выполнения — в карточке ниже.",
          "Confirmation received. See the execution result below.",
          "Ырастоо алынды. Аткаруунун жыйынтыгы төмөнкү карточкада.",
        );
      } else if (active.status === "COMPLETED")
        text = baamText(
          input.locale,
          "Это действие уже выполнено. Повторно ничего не создано; результат — в карточке ниже.",
          "This action has already completed. Nothing was created again; see its result below.",
          "Бул аракет мурда аткарылган. Эч нерсе кайра түзүлгөн жок; жыйынтыгы төмөнкү карточкада.",
        );
      else
        text = baamText(
          input.locale,
          "Проверьте текущую карточку: сначала заполните недостающие поля и уточните позиции. Уже выполненное действие повторно не запускается.",
          "Review the current card: complete missing fields and resolve selections first. An already executed action is not run again.",
          "Учурдагы карточканы текшериңиз: жетишпеген талааларды толтуруп, позицияларды тактаңыз. Аткарылган аракет кайра иштетилбейт.",
        );
    } else if (
      intent.kind === "analytics" ||
      (intent.kind === "report" && (intent.period || (intent.dateFrom && intent.dateTo)))
    ) {
      const answer = await answerBaamAnalytics(
        ctx,
        input,
        conversation.storeId ?? undefined,
        intent.dateFrom && intent.dateTo
          ? { dateFrom: intent.dateFrom, dateTo: intent.dateTo }
          : intent.period
            ? baamReportPeriod(intent.period)
            : undefined,
        intent.kind === "report",
      );
      text = answer.text;
      parts = answer.parts;
    } else if (intent.kind === "records" && intent.recordKind) {
      const answer = await answerBaamRecords(ctx, {
        kind: intent.recordKind,
        query: intent.query,
        storeId: conversation.storeId ?? undefined,
        locale: input.locale,
      });
      text = answer.text;
      parts = answer.parts;
    } else if ((intent.kind === "answer" || intent.kind === "help") && intent.reply?.trim()) {
      text = intent.reply.trim();
      parts = baamGuideContext(input.text, input.locale, input.page?.path)
        .filter((guide) => guide.relevant)
        .slice(0, 2)
        .map((guide) => ({ type: "link", label: guide.title, href: guide.page }));
    } else if (intent.confidence === "low" || intent.kind === "choice") {
      text = intent.reply?.trim() || baamChoiceText(input.locale);
      parts = intent.reply?.trim()
        ? []
        : [
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
            ? mergeWorkflowCorrection(current.parameters, intent.parameters)
            : intent.parameters;
        if (intent.kind === "action")
          parameters = bindBaamRecentRecord(input.text, intent.action, parameters, recentRecords);
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
    await assertBaamTurnActive(ctx, turn.id);
    await finishBaamTurn(ctx, turn.id, "COMPLETED", text, parts);
    const reportExecution = async (completed: Awaited<ReturnType<typeof submitBaamWorkflow>>) => {
      const message =
        completed.status === "COMPLETED"
          ? baamText(
              input.locale,
              "Готово. Действие выполнено; результат и ссылка — в карточке ниже.",
              "Done. The action completed; see the result and link below.",
              "Даяр. Аракет аткарылды; жыйынтык жана шилтеме төмөнкү карточкада.",
            )
          : completed.status === "RECEIPT"
            ? baamText(
                input.locale,
                "Чек подготовлен и пока не оплачен. Его можно проверить и продолжить в карточке ниже.",
                "The receipt is prepared and remains unpaid. Review or continue it below.",
                "Чек даярдалды, бирок төлөнө элек. Аны төмөнкү карточкадан текшерип, улантсаңыз болот.",
              )
            : completed.status === "FAILED"
              ? baamText(
                  input.locale,
                  "Действие не выполнено. В карточке ниже указано, что нужно исправить.",
                  "The action did not complete. The card below explains what to fix.",
                  "Аракет аткарылган жок. Төмөнкү карточкада эмнени оңдоо керектиги көрсөтүлгөн.",
                )
              : null;
      if (message)
        await prisma.baamMessage.updateMany({
          where: { conversationId: conversation.id, turnId: turn.id, role: "assistant" },
          data: { text: message },
        });
    };
    if (confirmation)
      await reportExecution(
        await submitBaamWorkflow(ctx, {
          id: confirmation.id,
          revision: confirmation.revision,
          parameters: confirmation.parameters as WorkflowValues,
          clientRequestId: input.clientRequestId,
          operation: "execute",
        }),
      );
    if (
      workflow &&
      !analyzedAttachment &&
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
        await reportExecution(
          await submitBaamWorkflow(ctx, {
            id: workflow.id,
            revision: workflow.revision,
            parameters: params,
            clientRequestId: randomUUID(),
            operation: "execute",
          }),
        );
    }
  } catch (error) {
    // Do not log prompts, provider bodies, credentials or customer records.
    console.warn("baam.failure", {
      turnId: turn.id,
      errorType: error instanceof Error ? error.name : "unknown",
      code: error instanceof AppError ? error.message : undefined,
      ...(process.env.NODE_ENV !== "production" && error instanceof Error
        ? {
            frames: error.stack
              ?.split("\n")
              .filter((line) => /^\s+at /.test(line))
              .slice(0, 4),
          }
        : {}),
    });
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
