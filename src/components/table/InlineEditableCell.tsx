"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
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

type EditSession = {
  row: unknown;
  context: unknown;
  value: unknown;
  draft: string;
  saving: boolean;
  finished: boolean;
  operation?: InlineMutationOperation;
};

type InlineEditTableState = {
  activeCellId: string | null;
  setActiveCellId: Dispatch<SetStateAction<string | null>>;
  sessions: Map<string, EditSession>;
  refresh: () => void;
};

const InlineEditTableContext = createContext<InlineEditTableState | null>(null);

export const InlineEditTableProvider = ({ children }: { children: ReactNode }) => {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  // TanStack column callbacks can remount cells on query/mutation updates.
  // Keep the active draft and in-flight request outside that component lifetime.
  const sessions = useRef(new Map<string, EditSession>()).current;
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const value = useMemo(
    () => ({ activeCellId, setActiveCellId, sessions, refresh, revision }),
    [activeCellId, sessions, refresh, revision],
  );
  return (
    <InlineEditTableContext.Provider value={value}>{children}</InlineEditTableContext.Provider>
  );
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

  const cellId = `${definition.tableKey}:${String(context.storeId ?? "")}:${rowId}:${definition.columnKey}`;
  const sessionRef = useRef<EditSession | undefined>(tableState?.sessions.get(cellId));
  const [localValue, setLocalValue] = useState<TValue>(value);
  const [draftValue, setDraftValue] = useState(sessionRef.current?.draft ?? "");
  const [, renderSaving] = useState(false);
  const isSaving = sessionRef.current?.saving ?? false;
  const refreshTable = tableState?.refresh;
  const setIsSaving = useCallback(
    (saving: boolean) => {
      if (sessionRef.current) sessionRef.current.saving = saving;
      renderSaving(saving);
      refreshTable?.();
    },
    [refreshTable],
  );
  const [standaloneEditing, setStandaloneEditing] = useState(false);
  const selectEditorRef = useRef<HTMLDivElement | null>(null);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const keyboardSessionRef = useRef(false);

  const activeCellId = tableState?.activeCellId ?? (standaloneEditing ? cellId : null);
  const isEditing = tableState ? activeCellId === cellId : standaloneEditing;
  useEffect(() => {
    if (!isEditing && keyboardSessionRef.current) {
      keyboardSessionRef.current = false;
      cellRef.current?.focus();
    }
  }, [isEditing]);
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
    if (sessionRef.current) sessionRef.current.finished = true;
    if (tableState) {
      tableState.sessions.delete(cellId);
      tableState.setActiveCellId((active) => (active === cellId ? null : active));
      return;
    }
    setStandaloneEditing(false);
  }, [tableState, cellId]);

  const beginEdit = useCallback(
    (trigger: "doubleClick" | "mobileButton" | "keyboard") => {
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
      keyboardSessionRef.current = trigger === "keyboard";
      const draft = definition.editorValue
        ? definition.editorValue(localValue, row, context, displayContext)
        : toEditorValue(localValue);
      const session: EditSession = {
        row,
        context,
        value: localValue,
        draft,
        saving: false,
        finished: false,
      };
      sessionRef.current = session;
      tableState?.sessions.set(cellId, session);
      setDraftValue(draft);
      if (tableState) {
        tableState.setActiveCellId(cellId);
        return;
      }
      setStandaloneEditing(true);
    },
    [
      activeCellId,
      canEdit,
      cellId,
      context,
      definition,
      displayContext,
      isEditing,
      isSaving,
      isTouch,
      localValue,
      row,
      tableState,
    ],
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
      const session = sessionRef.current;
      if (!session || session.saving || session.finished || !canEdit) return;
      const editRow = session.row as TRow;
      const editContext = session.context as TContext;
      const draftResolution = resolveInlineDraft({
        rawValue,
        currentValue: session.value as TValue,
        parser: (raw) => definition.parser(raw, editRow, editContext),
        equals,
      });

      if (draftResolution.kind === "invalid") {
        if (reason === "blur") closeEditor();
        toast({ variant: "error", description: resolveParserError(draftResolution.errorKey) });
        return;
      }
      if (draftResolution.kind === "unchanged") {
        closeEditor();
        return;
      }

      const previousValue = session.value as TValue;
      setIsSaving(true);
      // Retain the same operation/key after a lost response. The server replays
      // it even if the first request committed before the connection failed.
      const operation =
        session.operation ?? definition.mutation(editRow, draftResolution.value, editContext);
      session.operation = operation;
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
        const error = outcome.error as { message?: string; data?: { code?: string } };
        if (error.message === "inventoryStockConflict" || error.data?.code === "CONFLICT")
          closeEditor();
        toast({
          variant: "error",
          description: translateError(tErrors, outcome.error as never),
        });
        return;
      }
      closeEditor();
      toast({ variant: "success", description: tInline("saved") });
      onMutationSuccess?.();
    },
    [
      closeEditor,
      canEdit,
      definition,
      equals,
      executeMutation,
      onMutationSuccess,
      resolveParserError,
      setIsSaving,
      tErrors,
      tInline,
      toast,
    ],
  );

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const action = resolveInlineKeyAction(event.key);
      if (action === "cancel") {
        event.preventDefault();
        event.stopPropagation();
        if (sessionRef.current?.saving) return;
        closeEditor();
        return;
      }
      if (action === "commit") {
        event.preventDefault();
        event.stopPropagation();
        void commitFromRawValue(event.currentTarget.value, "enter");
      }
    },
    [closeEditor, commitFromRawValue],
  );

  useEffect(() => {
    if (!isEditing || definition.inputType !== "select" || isSaving) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (selectEditorRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-inline-edit-select-content]")) {
        return;
      }
      closeEditor();
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeEditor();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeEditor, definition.inputType, isEditing, isSaving]);

  const displayText = definition.formatter(localValue, row, context, displayContext);
  const disabledHint = definition.disabledHintKey?.(row, context);
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
        <div ref={selectEditorRef} className={cn("flex items-center gap-2", className)}>
          <Select
            value={selectValue}
            onValueChange={(next) => {
              if (sessionRef.current) sessionRef.current.draft = next;
              setDraftValue(next);
              void commitFromRawValue(next, "select");
            }}
            disabled={isSaving}
          >
            <SelectTrigger
              aria-label={tInline("editorAria", { field: columnLabel })}
              className="h-8 min-w-[120px]"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeEditor();
                }
              }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-inline-edit-select-content>
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
      <div
        className={cn("flex items-center gap-2", className)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Input
          autoFocus
          readOnly={isSaving}
          value={draftValue}
          type={editorType}
          inputMode={
            definition.inputType === "number" || definition.inputType === "money"
              ? "decimal"
              : undefined
          }
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            if (sessionRef.current) {
              sessionRef.current.draft = event.target.value;
              sessionRef.current.operation = undefined;
            }
            setDraftValue(event.target.value);
          }}
          onKeyDown={onInputKeyDown}
          onBlur={(event) => {
            void commitFromRawValue(event.currentTarget.value, "blur");
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
        "flex min-h-8 items-center gap-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        canEdit ? "cursor-text select-none" : undefined,
        className,
      )}
      ref={cellRef}
      data-inline-cell={cellId}
      tabIndex={canEdit && !isTouch ? 0 : undefined}
      role={canEdit && !isTouch ? "button" : undefined}
      aria-label={
        canEdit && !isTouch
          ? `${tInline("editButtonAria", { field: columnLabel })}: ${displayText}`
          : undefined
      }
      onKeyDown={(event) => {
        if (canEdit && ["Enter", "F2", " "].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          beginEdit("keyboard");
        }
      }}
      onClick={(event) => {
        if (canEdit) event.stopPropagation();
        if (canEdit && !isTouch && event.detail === 0) beginEdit("keyboard");
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        beginEdit("doubleClick");
      }}
      title={
        !canEdit
          ? tInline(disabledHint ?? "noPermissionTooltip")
          : definition.columnKey === "onHand"
            ? tInline("stockAbsoluteHint")
            : undefined
      }
    >
      <span>{displayText}</span>
      {isSaving ? <Spinner className="h-3.5 w-3.5" aria-label={tInline("savingAria")} /> : null}
      {canEdit && isTouch ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 shadow-none"
          onClick={() => beginEdit("mobileButton")}
          aria-label={tInline("editButtonAria", { field: columnLabel })}
        >
          <EditIcon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
};
