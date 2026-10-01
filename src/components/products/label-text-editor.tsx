"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { LABEL_TEXT_FIELDS, LABEL_SPACING_FIELDS, type LabelTextStyles } from "@/lib/labelTextStyles";
import { fetchLabelPreview, type LabelPreviewInput } from "@/lib/labelPreview";

export function LabelTextEditor({ value, onChange, disabled }: { value: LabelTextStyles; onChange: (value: LabelTextStyles) => void; disabled: boolean }) {
  const t = useTranslations("printingSettings.textStyles");
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">{t("scope")}</p>
    <fieldset className="rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t("spacingTitle")}</legend>
      <p className="mb-3 text-xs text-muted-foreground">{t("spacingHint")}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{LABEL_SPACING_FIELDS.map(field => <label key={field} className="text-xs">{t("gapAfter", { field: t(field) })}<Input aria-label={t("gapAfter", { field: t(field) })} type="number" min={0} max={20} step={0.1} value={value.spacing[field]} onChange={event => onChange({ ...value, spacing: { ...value.spacing, [field]: Number(event.target.value) } })} /></label>)}</div>
    </fieldset>
    <p className="text-xs text-muted-foreground">{t("priceCurrencyHint")}</p>
    {LABEL_TEXT_FIELDS.map((field) => {
    const style = value[field];
    return <fieldset key={field} className="rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t(field)}</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["fontSize", "minFontSize", "maxLines", "paddingMm", "widthPercent"] as const).filter(key => key !== "maxLines" || (field !== "price" && field !== "currency")).map((key) => <label key={key} className="text-xs">{t(key)}<Input aria-label={[t(field), t(key)].join(": ")} type="number" step={key === "maxLines" ? 1 : 0.25} value={style[key]} onChange={(e) => onChange({ ...value, [field]: { ...style, [key]: Number(e.target.value) } })} /></label>)}
        {([ ["weight", ["normal", "bold"]], ["align", ["left", "center", "right"]], ["overflow", ["wrap", "truncate", "shrink"]] ] as const).filter(([key]) => field !== "currency" || key !== "align").map(([key, options]) => <label key={key} className="text-xs">{t(key)}<select aria-label={[t(field), t(key)].join(": ")} className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={style[key]} onChange={(e) => onChange({ ...value, [field]: { ...style, [key]: e.target.value } })}>{options.map((option) => <option key={option} value={option}>{t(option === "wrap" && (field === "price" || field === "currency") ? "singleLine" : option)}</option>)}</select></label>)}
      </div>
    </fieldset>;
  })}</div>;
}

export function LabelPdfPreview({ input }: { input: LabelPreviewInput }) {
  const t = useTranslations("printingSettings.textStyles");
  const errors = useTranslations("errors");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const serialized = JSON.stringify(input);
  useEffect(() => {
    if (!input.storeId) return;
    const abort = new AbortController(); let objectUrl = "";
    setUrl(""); setError(""); setWarnings([]);
    const timer = setTimeout(() => {
      void fetchLabelPreview(JSON.parse(serialized), abort.signal).then((result) => {
        objectUrl = URL.createObjectURL(result.blob); setUrl(objectUrl); setWarnings(result.warnings);
      }).catch((err: unknown) => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "genericMessage"); });
    }, 400);
    return () => { clearTimeout(timer); abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [serialized, input.storeId]);
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{t("previewHint")}</p>
    {error ? <p role="alert" className="text-destructive">{errors.has(error) ? errors(error) : errors("genericMessage")}</p> : null}
    {warnings.length ? <p role="alert" className="text-destructive">{errors("labelLayoutOverflow")} {warnings.map((warning) => warning.split(":")[1]).filter((field, i, fields) => fields.indexOf(field) === i).map((field) => t.has(field!) ? t(field!) : field).join(", ")}</p> : null}
    {url ? <><iframe title={t("pdfPreview")} src={`${url}#toolbar=0&navpanes=0&view=FitH`} className="h-[420px] w-full border bg-white" /><a className="text-sm underline" href={url} download="label-preview.pdf">{t("download")}</a></> : null}
  </div>;
}
