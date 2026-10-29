import { baamReadPlanSchema, type BaamReadPlan } from "./baamReadPlan";
import { baamReportPeriod } from "./baamPeriods";
import { resolveBaamQuestionScope } from "./baamQuestionScope";

// Only a fully recognized scope-only utterance inherits an analysis. A new
// subject (overview, customers, product ranking...) must go through the planner.
export function continueBaamRead(
  question: string,
  previous: unknown,
  stores: Array<{ id: string; name: string }>,
  selectedStoreId?: string,
  now?: Date,
): BaamReadPlan | null {
  const parsed = baamReadPlanSchema.safeParse(previous);
  if (!parsed.success || !parsed.data.requests.length) return null;
  const plan = parsed.data,
    first = plan.requests[0];
  const range =
    first.dateFrom && first.dateTo
      ? { dateFrom: first.dateFrom, dateTo: first.dateTo }
      : baamReportPeriod("month", now);
  const previousStoreId =
    first.store === "*"
      ? undefined
      : (stores.find((s) => s.id === first.store || s.name === first.store)?.id ?? selectedStoreId);
  const resolution = resolveBaamQuestionScope({
    question,
    selected: { ...range, storeId: previousStoreId },
    stores,
    now,
  });
  if (resolution.status !== "resolved" || !resolution.explicit) return null;
  const remaining = resolution.question.replace(/[?!.,]/g, " ").trim();
  if (
    !/^(?:(?:а|за|в|по|и|ну|тогда|как|теперь|and|what about|how about|now|for|then|in|at|ал|эми|үчүн)\s*)*$/iu.test(
      remaining,
    )
  )
    return null;
  const changedPeriod = resolution.reason !== "controls";
  const dated = (r: BaamReadPlan["requests"][number]) =>
    !["inventory", "stores"].includes(r.dataset) &&
    !(r.dataset === "products" && ["list", "catalog_details"].includes(r.mode));
  if (changedPeriod && !plan.requests.some(dated)) return null;
  return {
    ...plan,
    requests: plan.requests.map((r) => ({
      ...r,
      ...(resolution.namedStore
        ? {
            store: resolution.storeId ? stores.find((s) => s.id === resolution.storeId)!.name : "*",
          }
        : {}),
      ...(changedPeriod && dated(r)
        ? { dateFrom: resolution.range.dateFrom, dateTo: resolution.range.dateTo }
        : {}),
    })),
  };
}
