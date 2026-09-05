"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ArrowRightIcon, SendIcon, SparklesIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type BaamConversationEntry = {
  id: string;
  question: string;
  answer: string;
  followUps?: string[];
  evidence?: { summary: string; details: string[] };
  links?: Array<{ label: string; href: string }>;
  products?: Array<{ id: string; title: string; href: string; sku: string | null; displayFields: Array<{ label: string; value: string }> }>;
  productEvidence?: { summary: string; details: string[] };
  status?: "answer" | "clarification" | "unsupported";
  scope?: { dateFrom: string; dateTo: string; timeZone: string; storeNames: string[]; reason: string };
};

export type BaamAssistantPanelProps = {
  entries: BaamConversationEntry[];
  onAsk: (question: string) => void;
  pending: boolean;
  available: boolean;
  availabilityLabel: string;
  error?: string;
  scopeControls?: ReactNode;
  compact?: boolean;
  question: string;
  onQuestionChange: (question: string) => void;
  onRetryAvailability?: () => void;
  onNewConversation?: () => void;
  hasContext?: boolean;
  suggestions?: string[];
  pageContextLabel?: string;
};

/** Presentation only: every answer and availability state comes from the caller. */
export function BaamAssistantPanel({
  entries, onAsk, pending, available, availabilityLabel, error, scopeControls, compact = false,
  question, onQuestionChange, onRetryAvailability, onNewConversation, hasContext = false, suggestions, pageContextLabel,
}: BaamAssistantPanelProps) {
  const t = useTranslations("baam.assistant");
  const tBaam = useTranslations("baam");
  const inputId = useId();
  const historyRef = useRef<HTMLDivElement>(null);
  const previousEntryCount = useRef(0);
  useEffect(() => {
    const history = historyRef.current;
    if (history) {
      if (!entries.length && !pending && !error) history.scrollTop = 0;
      else if (entries.length > previousEntryCount.current) {
        const latest = history.querySelector<HTMLElement>("[data-baam-entry]:last-child");
        if (latest) history.scrollTop += latest.getBoundingClientRect().top - history.getBoundingClientRect().top - 16;
      } else if (pending || error) history.scrollTop = history.scrollHeight;
    }
    previousEntryCount.current = entries.length;
  }, [entries.length, pending, error]);
  const ask = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || pending || !available) return;
    onQuestionChange(trimmed);
    onAsk(trimmed);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
  };

  return <div className={cn("flex min-h-0 flex-col", compact ? "h-full" : "h-[min(44rem,75dvh)] min-h-[30rem]")}>
    <div className="max-h-[40%] shrink-0 space-y-3 overflow-y-auto border-b border-border/70 px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {availabilityLabel}
      </p>
      {onNewConversation && entries.length ? <Button variant="ghost" size="sm" className="h-auto shrink-0 px-2 py-0 text-xs"
        disabled={pending} onClick={onNewConversation}>{t("newConversation")}</Button> : null}
      </div>
      {onRetryAvailability ? <Button variant="outline" size="sm" onClick={onRetryAvailability}>{tBaam("retry")}</Button> : null}
      {scopeControls}
      {!entries.length && pageContextLabel ? <p className="text-[11px] leading-4 text-muted-foreground">{pageContextLabel}</p> : null}
    </div>
    <div ref={historyRef} data-baam-history className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
      {!entries.length && !pending ? <div className={cn("space-y-4", compact ? "py-0" : "py-3")}>
        <div className={cn("h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary", compact ? "hidden" : "flex")}>
          <SparklesIcon className="h-6 w-6" aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className={cn("font-semibold tracking-tight", compact ? "text-lg" : "text-xl")}>{t("welcome")}</h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{t(compact ? "welcomeCompact" : "welcomeBody")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {(suggestions ?? [t("briefPrompt"), t("changePrompt"), t("nextPrompt")]).map(value => <Button
            key={value} variant="outline" className="h-auto min-h-11 justify-between whitespace-normal px-3 py-3 text-left"
            disabled={!available || pending} onClick={() => ask(value)}
          >
            <span>{value}</span><ArrowRightIcon className="h-4 w-4 shrink-0" aria-hidden />
          </Button>)}
        </div>
      </div> : null}
      <ol className="space-y-5" aria-label={t("conversation")} aria-live="polite" aria-relevant="additions" role="log">
        {entries.map((entry, entryIndex) => <li key={entry.id} data-baam-entry className="space-y-3">
          <div className="ml-auto max-w-[90%] break-words rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-6">
            <span className="sr-only">{t("you")}: </span>{entry.question}
          </div>
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-primary"><SparklesIcon className="h-4 w-4" aria-hidden />{tBaam("title")}</p>
            {entry.status && entry.status !== "answer" ? <p className="text-xs font-medium text-muted-foreground">
              {t(entry.status === "clarification" ? "clarification" : "unsupported")}
            </p> : null}
            {entry.scope ? <div className="space-y-1 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-5" data-baam-answer-scope>
              <p className="font-medium">{entry.scope.dateFrom} — {entry.scope.dateTo} · {entry.scope.timeZone}</p>
              <details>
                <summary className="cursor-pointer">{t("storesInScope", { count: entry.scope.storeNames.length })}</summary>
                <p className="mt-1 break-words">{entry.scope.storeNames.join(", ") || tBaam("noStoresShort")}</p>
                <p className="mt-1 text-muted-foreground">{entry.scope.reason}</p>
              </details>
            </div> : null}
            <p className="whitespace-pre-line break-words text-sm leading-7">{entry.answer}</p>
            {entry.products?.length ? <ul className="space-y-2" aria-label={t("productResults")}>
              {entry.products.map(product => <li key={product.id} className="min-w-0 rounded-xl border border-border/80 p-3">
                <Link href={product.href} prefetch={false} className="button-focus-ring flex min-h-9 items-center justify-between gap-3 rounded-md text-sm font-medium text-primary hover:underline">
                  <span className="break-words">{product.title}</span><ArrowRightIcon className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
                {product.sku ? <p className="break-words text-xs leading-5 text-muted-foreground">{t("productSku", { sku: product.sku })}</p> : null}
                <dl className="mt-2 space-y-1 text-xs leading-5">
                  {product.displayFields.map((field, index) => <div key={index} className="flex flex-wrap justify-between gap-x-3">
                    <dt className="text-muted-foreground">{field.label}</dt><dd className="break-words font-medium tabular-nums">{field.value}</dd>
                  </div>)}
                </dl>
              </li>)}
            </ul> : null}
            {entry.productEvidence ? <details className="break-words rounded-xl border border-border/80 bg-secondary/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">{entry.productEvidence.summary}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">{entry.productEvidence.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
            </details> : null}
            {entry.evidence ? <details className="break-words rounded-xl border border-border/80 bg-secondary/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">{entry.evidence.summary}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">{entry.evidence.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
            </details> : null}
            {entry.links?.length ? <div className="flex flex-wrap gap-2">{entry.links.map(link => <Link
              key={link.href} href={link.href} prefetch={false}
              className="button-focus-ring inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
            >{link.label}<ArrowRightIcon className="h-3 w-3" aria-hidden /></Link>)}</div> : null}
            {entryIndex === entries.length - 1 && entry.followUps?.length ? <div className="flex flex-wrap gap-2">
              {entry.followUps.map(value => <Button key={value} variant="outline" size="sm"
                className="h-auto min-h-9 whitespace-normal text-left" disabled={pending || !available}
                onClick={() => ask(value)}>{value}</Button>)}
            </div> : null}
          </div>
        </li>)}
      </ol>
      {pending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" />{t("thinking")}</p> : null}
      {error ? <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm leading-6">{error}</div> : null}
    </div>
    <form onSubmit={submit} className={cn(
      "shrink-0 space-y-2 border-t border-border/70 bg-card px-4 py-3 sm:px-5",
      // Keep the fixed workspace circle clear of Send on phone and tablet layouts.
      !compact && "pr-20 sm:pr-20 xl:pr-5",
    )}>
      {hasContext ? <p className="text-[11px] leading-4 text-primary">{t("contextActive")}</p> : null}
      <label htmlFor={inputId} className="sr-only">{t("questionLabel")}</label>
      <div className="flex items-end gap-2">
        <Textarea
          id={inputId} value={question} maxLength={1500} rows={2}
          onChange={event => onQuestionChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
                !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              ask(question);
            }
          }}
          enterKeyHint="send"
          placeholder={t("questionPlaceholder")}
          className="min-h-[4.5rem] max-h-36 resize-y rounded-xl"
          disabled={!available}
        />
        <Button type="submit" size="icon" className="mb-0.5 h-11 w-11 shrink-0 rounded-xl"
          disabled={!available || pending || !question.trim()} aria-label={t("send")}>
          {pending ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-5 w-5" aria-hidden />}
        </Button>
      </div>
      <p className="hidden text-[11px] leading-4 text-muted-foreground sm:block">{t("keyboardHint")}</p>
      <p className="text-[11px] leading-4 text-muted-foreground">{t("readOnly")}</p>
    </form>
  </div>;
}
