import type { InlineParseResult } from "@/lib/inlineEdit/registry";

export type InlineEditTrigger = "doubleClick" | "mobileButton";

type ShouldBeginInlineEditInput = {
  trigger: InlineEditTrigger;
  isTouch: boolean;
  canEdit: boolean;
  isSaving: boolean;
  activeCellId: string | null;
  cellId: string;
};

export const shouldBeginInlineEdit = ({
  trigger,
  isTouch,
  canEdit,
  isSaving,
  activeCellId,
  cellId,
}: ShouldBeginInlineEditInput) => {
  if (!canEdit || isSaving) {
    return false;
  }
  if (activeCellId && activeCellId !== cellId) {
    return false;
  }
  if (trigger === "doubleClick") {
    return !isTouch;
  }
  return isTouch;
};

export const resolveInlineKeyAction = (key: string) => {
  if (key === "Enter") {
    return "commit" as const;
  }
  if (key === "Escape") {
    return "cancel" as const;
  }
  return "noop" as const;
};

type ResolveInlineDraftInput<TValue> = {
  rawValue: string;
  currentValue: TValue;
  parser: (raw: string) => InlineParseResult<TValue>;
  equals: (left: TValue, right: TValue) => boolean;
};

export const resolveInlineDraft = <TValue>({
  rawValue,
  currentValue,
  parser,
  equals,
}: ResolveInlineDraftInput<TValue>) => {
  const parsed = parser(rawValue);
  if (!parsed.ok) {
    return { kind: "invalid" as const, errorKey: parsed.errorKey };
  }
  if (equals(parsed.value, currentValue)) {
    return { kind: "unchanged" as const };
  }
  return { kind: "changed" as const, value: parsed.value };
};

type ExecuteOptimisticMutationInput<TValue> = {
  previousValue: TValue;
  nextValue: TValue;
  applyOptimistic: (value: TValue) => void;
  rollback: (value: TValue) => void;
  execute: () => Promise<void>;
};

export const executeOptimisticMutation = async <TValue>({
  previousValue,
  nextValue,
  applyOptimistic,
  rollback,
  execute,
}: ExecuteOptimisticMutationInput<TValue>) => {
  applyOptimistic(nextValue);
  try {
    await execute();
    return { ok: true as const };
  } catch (error) {
    rollback(previousValue);
    return { ok: false as const, error };
  }
};
