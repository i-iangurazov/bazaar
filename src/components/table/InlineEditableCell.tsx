"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { EditIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/translateError";
import {
  executeOptimisticMutation,
  resolveInlineDraft,
  resolveInlineKeyAction,
  shouldBeginInlineEdit,
} from "@/components/table/inlineEditPolicy";
import type {
  InlineEditColumnDefinition,
  InlineMutationOperation,
  SessionRole,
} from "@/lib/inlineEdit/registry";

type InlineEditTableState = {
  activeCellId: string | null;
  setActiveCellId: (cellId: string | null) => void;
};

const InlineEditTableContext = createContext<InlineEditTableState | null>(null);

export const InlineEditTableProvider = ({ children }: { children: ReactNode }) => {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const value = useMemo(() => ({ activeCellId, setActiveCellId }), [activeCellId]);
  return <InlineEditTableContext.Provider value={value}>{children}</InlineEditTableContext.Provider>;
};

const useTouchDevice = () => {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => {
      setIsTouch(mediaQuery.matches || window.navigator.maxTouchPoints > 0);
    };
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isTouch;
};

const toEditorValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
};

type InlineCommitReason = "enter" | "blur" | "select";

type InlineEditableCellProps<TRow, TValue, TContext> = {
  rowId: string;
  row: TRow;
  value: TValue;
  definition: InlineEditColumnDefinition<TRow, TValue, TContext>;
  context: TContext;
  role: SessionRole;
  locale: string;
  columnLabel: string;
  tTable: (key: string) => string;
  tCommon: (key: string) => string;
  enabled: boolean;
  executeMutation: (operation: InlineMutationOperation) => Promise<void>;
  onMutationSuccess?: () => void;
  className?: string;
};

export const InlineEditableCell = <
  TRow,
  TValue,
  TContext extends Record<string, unknown> | Record<string, never>,
>({
  rowId,
  row,
  value,
  definition,
  context,
  role,
  locale,
  columnLabel,
  tTable,
  tCommon,
  enabled,
  executeMutation,
  onMutationSuccess,
  className,
}: InlineEditableCellProps<TRow, TValue, TContext>) => {
  const tableState = useContext(InlineEditTableContext);
  const { toast } = useToast();
  const tInline = useTranslations("inlineEditing");
  const tErrors = useTranslations("errors");
  const isTouch = useTouchDevice();

  const [localValue, setLocalValue] = useState<TValue>(value);
  const [draftValue, setDraftValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [standaloneEditing, setStandaloneEditing] = useState(false);

  const cellId = `${rowId}:${definition.columnKey}`;
  const activeCellId = tableState?.activeCellId ?? (standaloneEditing ? cellId : null);
  const isEditing = tableState ? activeCellId === cellId : standaloneEditing;
  const equals = useMemo(
    () => definition.equals ?? ((left: TValue, right: TValue) => Object.is(left, right)),
    [definition.equals],
  );

  const canEdit = enabled && definition.permissionCheck(role, row, context);
  const displayContext = useMemo(
    () => ({
      locale,
      notAvailableLabel: tCommon("notAvailable"),
      tTable,
      tCommon,
    }),
    [locale, tCommon, tTable],
  );

  useEffect(() => {
    if (isEditing || isSaving) {
      return;
    }
    setLocalValue(value);
  }, [value, isEditing, isSaving]);

  const closeEditor = useCallback(() => {
    if (tableState) {
      tableState.setActiveCellId(null);
      return;
    }
    setStandaloneEditing(false);
  }, [tableState]);

  const beginEdit = useCallback(
    (trigger: "doubleClick" | "mobileButton") => {
      if (
        !shouldBeginInlineEdit({
          trigger,
          isTouch,
          canEdit,
          isSaving,
          activeCellId,
          cellId,
        })
      ) {
        return;
      }
      if (isEditing) {
        return;
      }
      setDraftValue(toEditorValue(localValue));
      if (tableState) {
        tableState.setActiveCellId(cellId);
        return;
      }
      setStandaloneEditing(true);
    },
    [activeCellId, canEdit, cellId, isEditing, isSaving, isTouch, localValue, tableState],
  );

  const resolveParserError = useCallback(
    (key: string) => {
      if (tErrors.has?.(key)) {
        return tErrors(key);
      }
      return tErrors("validationError");
    },
    [tErrors],
  );

  const commitFromRawValue = useCallback(
    async (rawValue: string, reason: InlineCommitReason) => {
      const draftResolution = resolveInlineDraft({
        rawValue,
        currentValue: localValue,
        parser: (raw) => definition.parser(raw, row, context),
        equals,
      });

      if (draftResolution.kind === "invalid") {
        closeEditor();
        if (reason !== "blur") {
          toast({ variant: "error", description: resolveParserError(draftResolution.errorKey) });
        }
        return;
      }
      if (draftResolution.kind === "unchanged") {
        closeEditor();
        return;
      }

      const previousValue = localValue;
      setIsSaving(true);
      const operation = definition.mutation(row, draftResolution.value, context);
      const outcome = await executeOptimisticMutation({
        previousValue,
        nextValue: draftResolution.value,
        applyOptimistic: (nextValue) => setLocalValue(nextValue),
        rollback: (nextValue) => setLocalValue(nextValue),
        execute: async () => {
          await executeMutation(operation);
        },
      });
      setIsSaving(false);
      if (!outcome.ok) {
        closeEditor();
        toast({
          variant: "error",
          description: translateError(tErrors, outcome.error as never),
        });
        return;
      }
      closeEditor();
      onMutationSuccess?.();
    },
    [
      closeEditor,
      context,
      definition,
      equals,
      executeMutation,
      localValue,
      onMutationSuccess,
      resolveParserError,
      row,
      tErrors,
      toast,
    ],
  );

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const action = resolveInlineKeyAction(event.key);
      if (action === "cancel") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (action === "commit") {
        event.preventDefault();
        void commitFromRawValue(draftValue, "enter");
      }
    },
    [closeEditor, commitFromRawValue, draftValue],
  );

  const displayText = definition.formatter(localValue, row, context, displayContext);
  const editorType =
    definition.inputType === "money" ? "number" : definition.inputType === "date" ? "date" : "text";

  if (!enabled) {
    return <span className={cn("text-inherit", className)}>{displayText}</span>;
  }

  if (isEditing) {
    if (definition.inputType === "select") {
      const options = definition.selectOptions?.(row, context, displayContext) ?? [];
      const emptyOption =
        options.find((option) => option.value === "__none") ??
        options.find((option) => option.value === "none");
      const selectValue = draftValue || emptyOption?.value;
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <Select
            value={selectValue}
            onValueChange={(next) => {
              setDraftValue(next);
              void commitFromRawValue(next, "select");
            }}
            disabled={isSaving}
          >
            <SelectTrigger
              aria-label={tInline("editorAria", { field: columnLabel })}
              className="h-8 min-w-[120px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSaving ? <Spinner className="h-3.5 w-3.5" /> : null}
        </div>
      );
    }

    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Input
          autoFocus
          value={draftValue}
          type={editorType}
          inputMode={definition.inputType === "number" || definition.inputType === "money" ? "decimal" : undefined}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={() => {
            if (isSaving) {
              return;
            }
            void commitFromRawValue(draftValue, "blur");
          }}
          className="h-8 min-w-[120px]"
          aria-label={tInline("editorAria", { field: columnLabel })}
        />
        {isSaving ? <Spinner className="h-3.5 w-3.5" aria-label={tInline("savingAria")} /> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-1",
        canEdit && !isTouch ? "cursor-text" : undefined,
        className,
      )}
      onDoubleClick={() => {
        if (!isTouch) {
          beginEdit("doubleClick");
        }
      }}
      title={!canEdit ? tInline("noPermissionTooltip") : undefined}
    >
      <span>{displayText}</span>
      {isSaving ? <Spinner className="h-3.5 w-3.5" aria-label={tInline("savingAria")} /> : null}
      {canEdit && isTouch ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shadow-none"
          onClick={() => beginEdit("mobileButton")}
          aria-label={tInline("editButtonAria", { field: columnLabel })}
        >
          <EditIcon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
};
