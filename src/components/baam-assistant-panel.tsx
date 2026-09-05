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
};

/** Presentation only: every answer and availability state comes from the caller. */
export function BaamAssistantPanel({
  entries, onAsk, pending, available, availabilityLabel, error, scopeControls, compact = false,
  question, onQuestionChange, onRetryAvailability,
}: BaamAssistantPanelProps) {
  const t = useTranslations("baam.assistant");
  const tBaam = useTranslations("baam");
  const inputId = useId();
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
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
    <div className="shrink-0 space-y-3 border-b border-border/70 px-4 py-3 sm:px-5">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {availabilityLabel}
      </p>
      {onRetryAvailability ? <Button variant="outline" size="sm" onClick={onRetryAvailability}>{tBaam("retry")}</Button> : null}
      {scopeControls}
    </div>
    <div ref={historyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
      {!entries.length && !pending ? <div className="space-y-4 py-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
          <SparklesIcon className="h-6 w-6" aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{t("welcome")}</h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{t("welcomeBody")}</p>
        </div>
        <div className="flex flex-col gap-2">
          {["briefPrompt", "changePrompt", "nextPrompt"].map(key => <Button
            key={key} variant="outline" className="h-auto min-h-11 justify-between whitespace-normal px-3 py-3 text-left"
            disabled={!available || pending} onClick={() => ask(t(key))}
          >
            <span>{t(key)}</span><ArrowRightIcon className="h-4 w-4 shrink-0" aria-hidden />
          </Button>)}
        </div>
      </div> : null}
      <ol className="space-y-5" aria-label={t("conversation")} aria-live="polite" aria-relevant="additions" role="log">
        {entries.map((entry, entryIndex) => <li key={entry.id} className="space-y-3">
          <div className="ml-auto max-w-[90%] break-words rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-6">
            <span className="sr-only">{t("you")}: </span>{entry.question}
          </div>
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-primary"><SparklesIcon className="h-4 w-4" aria-hidden />{tBaam("title")}</p>
            <p className="whitespace-pre-line break-words text-sm leading-7">{entry.answer}</p>
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
    <form onSubmit={submit} className="shrink-0 space-y-2 border-t border-border/70 bg-card px-4 py-3 sm:px-5">
      <label htmlFor={inputId} className="sr-only">{t("questionLabel")}</label>
      <div className="flex items-end gap-2">
        <Textarea
          id={inputId} value={question} maxLength={1500} rows={2}
          onChange={event => onQuestionChange(event.target.value)}
          placeholder={t("questionPlaceholder")}
          className="min-h-[4.5rem] max-h-36 resize-y rounded-xl"
          disabled={!available}
        />
        <Button type="submit" size="icon" className="mb-0.5 h-11 w-11 shrink-0 rounded-xl"
          disabled={!available || pending || !question.trim()} aria-label={t("send")}>
          {pending ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-5 w-5" aria-hidden />}
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">{t("readOnly")}</p>
    </form>
  </div>;
}
