"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { localizeWorkflowFields } from "@/lib/baam/workflowLabels";
import { CaretDown, Plus, X, ImageSquare } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc";
import { baamText, isBaamLink, type BaamActionResult } from "@/lib/baam/companion";
import {
  workflowGet,
  workflowSet,
  workflowTitle,
  type WorkflowField,
  type WorkflowValue,
  type WorkflowValues,
  type WorkflowPresentation,
  type WorkflowOperation,
  type WorkflowOption,
} from "@/lib/baam/workflows";
import { uploadBaamImage } from "@/lib/baam/mediaClient";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import type { BaamController } from "./use-baam-companion";

type Workflow = NonNullable<BaamController["data"]>["workflows"][number];
type FieldProps = {
  field: WorkflowField;
  path: string;
  values: WorkflowValues;
  change: (path: string, value: WorkflowValue | undefined) => void;
  wf: Workflow;
  c: BaamController;
  presentation: WorkflowPresentation;
  disabled: boolean;
  setMediaBusy: (busy: boolean) => void;
};
function LookupField({ field, path, values, change, wf, c, presentation, disabled }: FieldProps) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [term, setTerm] = useState("");
  const [selected, setSelected] = useState<WorkflowOption>();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const value = workflowGet(values, path);
  const parent = path.split(".").slice(0, -1).join(".");
  const scope: WorkflowValues = Object.fromEntries(
    [
      "storeId",
      "saleId",
      "originalSaleId",
      "purchaseOrderId",
      "customerOrderId",
      "saleReturnId",
      "stockCountId",
    ].flatMap((k) => (values[k] !== undefined ? [[k, values[k]]] : [])),
  );
  const productKey = field.key === "componentVariantId" ? "componentProductId" : "productId";
  const product = workflowGet(values, parent ? `${parent}.${productKey}` : productKey);
  const lookupValues = product
    ? workflowSet(scope, parent ? `${parent}.${productKey}` : productKey, product)
    : scope;
  const options = trpc.baam.workflowLookup.useQuery(
    {
      id: wf.id,
      path,
      query: term || undefined,
      locale: c.locale,
      selected: typeof value === "string" ? value : undefined,
      parameters: lookupValues,
    },
    {
      enabled: open || Boolean(value),
      retry: false,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  );
  const current =
    selected?.value === value
      ? selected
      : (options.data?.find((o) => o.value === value) ??
        presentation.choices[path]?.find((o) => o.value === value));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={`${wf.id}-${path}`}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={field.label}
          disabled={disabled}
          className="h-10 w-full justify-between px-3 text-left font-normal"
        >
          <span className="min-w-0 truncate">
            {current?.label ??
              (value ? presentation.labels[path] : undefined) ??
              baamText(c.locale, "Выберите…", "Select…", "Тандаңыз…")}
          </span>
          <CaretDown className="ml-2 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(320px,calc(100vw-40px))] p-2" align="start">
        <Input
          aria-label={baamText(c.locale, "Поиск", "Search", "Издөө")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              e.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>("[data-lookup-option]")
                ?.focus();
            }
          }}
        />
        <div className="mt-2 max-h-56 overflow-auto" role="listbox" aria-label={field.label}>
          {options.isFetching ? (
            <p role="status" className="p-2 text-sm">
              {c.t("loading")}
            </p>
          ) : null}
          {options.error ? (
            <p role="alert" className="p-2 text-sm text-destructive">
              {c.readableError(options.error)}
            </p>
          ) : null}
          {!options.isFetching && !options.data?.length ? (
            <p className="p-2 text-sm text-muted-foreground">
              {baamText(c.locale, "Ничего не найдено", "No matches", "Эч нерсе табылган жок")}
            </p>
          ) : null}
          {options.data?.map((o) => (
            <button
              data-lookup-option
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="block min-h-11 w-full rounded-md px-2 py-2 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline focus-visible:outline-2"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                }
              }}
              onClick={() => {
                setSelected(o);
                change(path, o.value);
                setOpen(false);
              }}
            >
              <span className="block">{o.label}</span>
              {o.detail ? (
                <span className="block text-xs text-muted-foreground">{o.detail}</span>
              ) : null}
            </button>
          ))}
        </div>
        {!field.required && value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              change(path, undefined);
              setOpen(false);
            }}
          >
            {baamText(c.locale, "Очистить", "Clear", "Тазалоо")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
function PhotoField({ path, values, change, wf, c, disabled, setMediaBusy }: FieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>(),
    [preview, setPreview] = useState(""),
    [progress, setProgress] = useState<number>(),
    [error, setError] = useState<string>();
  const id = workflowGet(values, path);
  const [uploaded, setUploaded] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function upload(f: File) {
    setFile(f);
    setError(undefined);
    setProgress(0);
    setMediaBusy(true);
    try {
      const image = await uploadBaamImage(f, wf.conversationId, c.locale, setProgress);
      setUploaded(image.url);
      change(path, image.id);
      change(
        wf.kind === "product_create" ? "imageChoice" : "photo",
        wf.kind === "product_create" ? "attached_photo" : "attach",
      );
    } catch (e) {
      setError(c.readableError(e));
    } finally {
      setProgress(undefined);
      setMediaBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
        className="hidden"
        aria-label={c.t("attach")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {preview || id ? (
        <Image
          unoptimized
          width={96}
          height={96}
          alt={baamText(c.locale, "Фотография товара", "Product photo", "Товардын сүрөтү")}
          src={
            preview || uploaded || `/api/baam/media?attachmentId=${encodeURIComponent(String(id))}`
          }
          className="h-24 w-24 rounded-lg border object-cover"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || progress !== undefined}
          onClick={() => ref.current?.click()}
        >
          <ImageSquare className="mr-2" />
          {id
            ? baamText(c.locale, "Заменить фото", "Replace photo", "Сүрөттү алмаштыруу")
            : c.t("attach")}
        </Button>
        {id || file ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || progress !== undefined}
            onClick={() => {
              setFile(undefined);
              setPreview("");
              setUploaded("");
              setError(undefined);
              change(path, undefined);
              change(
                wf.kind === "product_create" ? "imageChoice" : "photo",
                wf.kind === "product_create" ? "without_photo" : "remove",
              );
            }}
          >
            {baamText(c.locale, "Без фотографии", "Without photo", "Сүрөтсүз")}
          </Button>
        ) : null}
        {error && file ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void upload(file)}>
            {c.t("retry")}
          </Button>
        ) : null}
      </div>
      {progress !== undefined ? (
        <div role="status" className="text-xs">
          <progress value={progress} max={100} className="w-full" />
          {c.t("loading")} · {progress}%
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
function Field(props: FieldProps) {
  const { field, path, values, change, wf, c, presentation, disabled } = props;
  const value = workflowGet(values, path),
    id = `${wf.id}-${path}`,
    error = presentation.errors[path];
  if (field.kind === "array") {
    const entries = Array.isArray(value) ? value : [];
    return (
      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-2 text-sm font-medium">
          {field.label}
          {field.required ? " *" : ""}
        </legend>
        {entries.map((_, index) => (
          <div key={index} className="relative space-y-3 rounded-lg border bg-background p-3 pt-10">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1 h-8 w-8"
              aria-label={baamText(c.locale, "Удалить строку", "Remove item", "Сапты өчүрүү")}
              disabled={disabled}
              onClick={() =>
                change(
                  path,
                  entries.filter((_, i) => i !== index),
                )
              }
            >
              <X size={15} />
            </Button>
            {field.item?.fields ? (
              field.item.fields.map((child) => (
                <Field
                  key={child.key}
                  {...props}
                  field={child}
                  path={`${path}.${index}.${child.key}`}
                />
              ))
            ) : field.item ? (
              <Field {...props} field={field.item} path={`${path}.${index}`} />
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || entries.length >= (field.max ?? 40)}
          onClick={() => change(path, [...entries, field.item?.fields ? {} : ""])}
        >
          <Plus className="mr-1" />
          {baamText(c.locale, "Добавить строку", "Add item", "Сап кошуу")}
        </Button>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {c.readableError(error)}
          </p>
        ) : null}
      </fieldset>
    );
  }
  if (field.kind === "object")
    return (
      <fieldset className="space-y-3">
        <legend>{field.label}</legend>
        {field.fields?.map((child) => (
          <Field {...props} key={child.key} field={child} path={`${path}.${child.key}`} />
        ))}
      </fieldset>
    );
  return (
    <div
      className={`min-w-0 space-y-1.5 ${["name", "attachmentId"].includes(path) ? "sm:col-span-2" : ""}`}
      data-workflow-field={path}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {field.kind === "lookup" ? (
        <LookupField {...props} />
      ) : field.kind === "photo" ? (
        <PhotoField {...props} />
      ) : field.kind === "select" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => change(path, v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-invalid={Boolean(error)} className="h-10">
            <SelectValue placeholder={baamText(c.locale, "Выберите…", "Select…", "Тандаңыз…")} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === "boolean" ? (
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(v) => change(path, v === true)}
        />
      ) : (
        <Input
          id={id}
          type={
            field.kind === "number" ? "number" : field.kind === "date" ? "datetime-local" : "text"
          }
          inputMode={field.kind === "number" ? "decimal" : undefined}
          step={field.integer ? 1 : "any"}
          min={field.min}
          max={field.max}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(e) =>
            change(
              path,
              e.target.value === ""
                ? undefined
                : field.kind === "number"
                  ? Number(e.target.value)
                  : field.kind === "date"
                    ? new Date(e.target.value).toISOString()
                    : e.target.value,
            )
          }
          className="h-10"
        />
      )}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {c.readableError(error)}
        </p>
      ) : null}
    </div>
  );
}
export function BaamWorkflowCard({ workflowId, c }: { workflowId: string; c: BaamController }) {
  const original = c.workflows.find((w) => w.id === workflowId);
  if (!original) return null;
  return <WorkflowCard key={original.id} initial={original} c={c} />;
}
function WorkflowCard({ initial, c }: { initial: Workflow; c: BaamController }) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const [wf, setWf] = useState(initial),
    [values, setValues] = useState(initial.parameters as WorkflowValues),
    [error, setError] = useState<string>(),
    [saving, setSaving] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const utils = trpc.useUtils(),
    save = trpc.baam.saveWorkflow.useMutation(),
    submit = trpc.baam.submitWorkflow.useMutation(),
    recover = trpc.baam.recoverWorkflow.useMutation();
  const ref = useRef({ wf, values, dirty: false }),
    queue = useRef(Promise.resolve()),
    pending = useRef<Parameters<typeof submit.mutateAsync>[0]>();
  const submittingRef = useRef(false);
  const readableRef = useRef(c.readableError);
  readableRef.current = c.readableError;
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const storageKey = `baam-form:${wf.conversationId}:${wf.id}`;
  const active = c.data?.conversation.activeWorkflowId === wf.id;
  const editable =
    active && ["EDITING", "FAILED", "RECEIPT"].includes(wf.status) && !wf.pendingRequestId;
  useEffect(() => {
    if (!ref.current.dirty && !submitting) {
      setWf(initial);
      setValues(initial.parameters as WorkflowValues);
      ref.current = { wf: initial, values: initial.parameters as WorkflowValues, dirty: false };
    }
  }, [initial, submitting]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved?.pending) {
        pending.current = saved.pending;
        setError(readableRef.current("baamRecoverRequest"));
      }
      if (saved?.revision === ref.current.wf.revision && saved?.values) {
        setValues(saved.values);
        ref.current.values = saved.values;
        ref.current.dirty = true;
      }
    } catch {
      /* Server form is authoritative. */
    }
  }, [storageKey]);
  const flush = useCallback(async () => {
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (!ref.current.dirty) return;
        const snapshot = ref.current.values;
        setSaving(true);
        try {
          const out = await saveRef.current({
            id: ref.current.wf.id,
            revision: ref.current.wf.revision,
            parameters: snapshot,
          });
          setWf(out);
          ref.current.wf = out;
          if (ref.current.values === snapshot) {
            ref.current.dirty = false;
            sessionStorage.removeItem(storageKey);
          }
        } catch (e) {
          setError(readableRef.current(e));
          throw e;
        } finally {
          setSaving(false);
        }
      });
    await queue.current;
    queue.current = Promise.resolve();
  }, [storageKey]);
  function change(path: string, value: WorkflowValue | undefined) {
    const next = workflowSet(ref.current.values, path, value);
    ref.current.values = next;
    ref.current.dirty = true;
    setValues(next);
    setError(undefined);
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ revision: ref.current.wf.revision, values: next }),
      );
    } catch {
      /* optional local recovery */
    }
  }
  useEffect(() => {
    if (!ref.current.dirty || submitting) return;
    const timer = setTimeout(
      () =>
        void flush().catch(() => {
          queue.current = Promise.resolve();
        }),
      600,
    );
    return () => clearTimeout(timer);
  }, [values, submitting, flush]);
  async function run(operation: WorkflowOperation) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      if (!pending.current && !wf.pendingRequestId) {
        await flush();
        pending.current = {
          id: wf.id,
          revision: ref.current.wf.revision,
          parameters: ref.current.values,
          operation,
          clientRequestId: crypto.randomUUID(),
        };
        sessionStorage.setItem(storageKey, JSON.stringify({ pending: pending.current }));
      }
      const out = pending.current
        ? await submit.mutateAsync(pending.current)
        : await recover.mutateAsync({ id: wf.id });
      setWf(out);
      setValues(out.parameters as WorkflowValues);
      ref.current = { wf: out, values: out.parameters as WorkflowValues, dirty: false };
      if (out.status !== "RUNNING" && !out.pendingRequestId) {
        pending.current = undefined;
        sessionStorage.removeItem(storageKey);
      }
      await utils.baam.conversation.invalidate({ id: wf.conversationId });
      if (out.status === "COMPLETED" || out.status === "RECEIPT") {
        void utils.products.invalidate();
        void utils.inventory.invalidate();
        void utils.pos.invalidate();
      }
    } catch (e) {
      setError(c.readableError(e));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  const p = wf.presentation as unknown as WorkflowPresentation;
  const result = wf.result as unknown as BaamActionResult | null;
  const receipt = wf.kind === "pos_create_draft" && wf.resourceId;
  const fields = localizeWorkflowFields(p.fields, c.locale).filter(
    (f) => f.key !== "imageChoice" && !(f.key === "photo" && f.kind === "select"),
  );
  return (
    <section
      data-baam-workflow={wf.id}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold">{workflowTitle(wf.kind, c.locale)}</h3>
        <span className="shrink-0 text-xs text-muted-foreground" role="status">
          {submitting || wf.status === "RUNNING"
            ? c.t("running")
            : saving
              ? baamText(c.locale, "Сохраняем…", "Saving…", "Сакталууда…")
              : wf.status === "COMPLETED"
                ? c.t("completed")
                : wf.status === "FAILED"
                  ? c.t("failed")
                  : wf.status === "CANCELLED"
                    ? c.t("cancelled")
                    : !active || wf.status === "SUPERSEDED"
                      ? c.t("superseded")
                      : baamText(c.locale, "Черновик", "Draft", "Долбоор")}
        </span>
      </div>
      {p.number ? (
        <div className="space-y-2 rounded-lg bg-secondary/60 p-3">
          <p className="font-medium">
            {p.number} ·{" "}
            {p.documentStatus === "DRAFT"
              ? p.isHeld
                ? baamText(c.locale, "Отложен", "Held", "Кийинкиге калтырылган")
                : baamText(c.locale, "Не оплачен", "Unpaid", "Төлөнө элек")
              : p.documentStatus === "COMPLETED"
                ? c.t("completed")
                : c.t("cancelled")}
          </p>
          <p className="whitespace-pre-wrap text-sm">{p.note}</p>
          <p className="font-semibold">
            {baamText(c.locale, "Итого", "Total", "Жалпы")}: {p.totalKgs} KGS
          </p>
        </div>
      ) : null}
      {editable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(receipt ? "complete" : "execute");
          }}
          className="space-y-4"
        >
          <fieldset
            disabled={submitting || c.busy || mediaBusy}
            className={`min-w-0 ${["product_create", "product_update"].includes(wf.kind) ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "space-y-4"}`}
          >
            {fields
              .filter((f) => !f.advanced)
              .map((f) => (
                <Field
                  key={f.key}
                  setMediaBusy={setMediaBusy}
                  field={f}
                  path={f.key}
                  values={values}
                  change={change}
                  wf={wf}
                  c={c}
                  presentation={p}
                  disabled={submitting || c.busy || mediaBusy}
                />
              ))}
            {fields.some((f) => f.advanced) ? (
              <details className="sm:col-span-2">
                <summary className="min-h-10 cursor-pointer text-sm text-primary focus-visible:outline focus-visible:outline-2">
                  {baamText(
                    c.locale,
                    "Дополнительные поля",
                    "Additional fields",
                    "Кошумча талаалар",
                  )}
                </summary>
                <div className="space-y-4 pt-2">
                  {fields
                    .filter((f) => f.advanced)
                    .map((f) => (
                      <Field
                        key={f.key}
                        setMediaBusy={setMediaBusy}
                        field={f}
                        path={f.key}
                        values={values}
                        change={change}
                        wf={wf}
                        c={c}
                        presentation={p}
                        disabled={submitting || c.busy || mediaBusy}
                      />
                    ))}
                </div>
              </details>
            ) : null}
          </fieldset>
          {p.errors._form ? (
            <p role="alert" className="text-sm text-destructive">
              {c.readableError(p.errors._form)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={submitting || c.busy || mediaBusy || Boolean(pending.current)}
            >
              {submitting ? <Spinner /> : null}
              {receipt
                ? baamText(c.locale, "Завершить продажу", "Complete sale", "Сатууну бүтүрүү")
                : workflowTitle(wf.kind, c.locale)}
            </Button>
            {receipt && p.number ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitting || c.busy || mediaBusy}
                  onClick={() => void run(p.isHeld ? "resume" : "hold")}
                >
                  {p.isHeld
                    ? baamText(c.locale, "Продолжить чек", "Resume receipt", "Чекти улантуу")
                    : baamText(
                        c.locale,
                        "Отложить чек",
                        "Hold receipt",
                        "Чекти кийинкиге калтыруу",
                      )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting || c.busy || mediaBusy}
                  onClick={() => void run("refresh")}
                >
                  {baamText(c.locale, "Обновить чек", "Refresh receipt", "Чекти жаңыртуу")}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={submitting || c.busy || mediaBusy}
              onClick={() => void run(receipt ? "cancelReceipt" : "cancel")}
            >
              {receipt
                ? baamText(c.locale, "Отменить чек", "Cancel receipt", "Чекти жокко чыгаруу")
                : c.t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {!editable && !receipt && result ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {result.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
      {!editable && p.errors._form ? (
        <p role="alert" className="text-sm text-destructive">
          {c.readableError(p.errors._form)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {(pending.current || wf.pendingRequestId) && !submitting ? (
        <Button size="sm" variant="outline" onClick={() => void run("execute")}>
          {baamText(c.locale, "Проверить результат", "Check result", "Натыйжаны текшерүү")}
        </Button>
      ) : null}
      {wf.status === "COMPLETED" &&
      wf.resourceId &&
      ["product_create", "product_update"].includes(wf.kind) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={c.busy}
          onClick={() =>
            void c.ask(
              baamText(
                c.locale,
                "Добавить или заменить фото",
                "Add or replace photo",
                "Сүрөт кошуу же алмаштыруу",
              ),
              undefined,
              { kind: "action", action: "product_update", sourceWorkflowId: wf.id },
            )
          }
        >
          {baamText(
            c.locale,
            "Добавить или заменить фото",
            "Add or replace photo",
            "Сүрөт кошуу же алмаштыруу",
          )}
        </Button>
      ) : null}
      {editable && !wf.kind.startsWith("pos_") && (p.stockReview || p.reviews?.length) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting || c.busy || mediaBusy}
          onClick={() => void run("refresh")}
        >
          {baamText(c.locale, "Обновить данные", "Refresh data", "Маалыматты жаңыртуу")}
        </Button>
      ) : null}
      {!receipt && p.saleFingerprint && editable ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting || c.busy}
          onClick={() => void run("refresh")}
        >
          {baamText(c.locale, "Обновить чек", "Refresh receipt", "Чекти жаңыртуу")}
        </Button>
      ) : null}
      {receipt && editable ? (
        <div className="flex flex-wrap gap-2">
          {(["pos_add_line", "pos_update_line", "pos_remove_line"] as const).map((action) => (
            <Button
              type="button"
              key={action}
              size="sm"
              variant="outline"
              disabled={submitting || c.busy || mediaBusy}
              onClick={() =>
                void c.ask(workflowTitle(action, c.locale), undefined, {
                  kind: "action",
                  action,
                  sourceWorkflowId: wf.id,
                })
              }
            >
              {workflowTitle(action, c.locale)}
            </Button>
          ))}
        </div>
      ) : null}
      {wf.status === "COMPLETED" &&
      ["pos_add_line", "pos_update_line", "pos_remove_line"].includes(wf.kind) ? (
        <Button
          type="button"
          size="sm"
          disabled={c.busy}
          onClick={() =>
            void c.ask(workflowTitle("pos_complete", c.locale), undefined, {
              kind: "action",
              action: "pos_complete",
              sourceWorkflowId: wf.id,
            })
          }
        >
          {workflowTitle("pos_complete", c.locale)}
        </Button>
      ) : null}
      {result?.href && isBaamLink(result.href) ? (
        <Link
          prefetch={false}
          href={result.href}
          className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline"
        >
          {c.t("openResult")}
        </Link>
      ) : null}
    </section>
  );
}
