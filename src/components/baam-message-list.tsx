"use client";
import { BaamWorkflowCard } from "./baam-workflow-card";
import { BaamSpeech } from "./baam-speech";
import { BaamAnswerText } from "./baam-answer-text";
import type { WorkflowAction } from "@/lib/baam/workflows";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Check, ImageSquare, Microphone } from "@phosphor-icons/react";
import { BaamIcon } from "./baam-icon";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { cn } from "@/lib/utils";
import { isBaamLink, type BaamActionSummary, type BaamPart } from "@/lib/baam/companion";
import type { BaamCopyKey } from "@/lib/baam/copy";
import type { BaamController } from "./use-baam-companion";

function ActionCard({ actionId, c }: { actionId: string; c: BaamController }) {
  const action = c.actions.find((a) => a.id === actionId);
  if (!action) return null;
  const summary = (action.result ?? action.summary) as unknown as BaamActionSummary;
  const active = action.status === "PROPOSED" || action.status === "FAILED" || action.canRecover;
  const statusKey =
    action.status === "COMPLETED"
      ? "completed"
      : action.status === "RUNNING"
        ? "running"
        : action.status === "CANCELLED"
          ? "cancelled"
          : action.status === "SUPERSEDED"
            ? "superseded"
            : action.status === "PROPOSED"
              ? "proposed"
              : "failed";
  return (
    <div
      data-baam-action={action.id}
      className="space-y-3 overflow-hidden break-words rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <p
        className={cn(
          "flex items-center gap-2 text-xs font-medium",
          action.status === "COMPLETED"
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground",
        )}
      >
        {action.status === "COMPLETED" ? <Check size={15} /> : null}
        {c.t(statusKey)}
      </p>
      <h3 className="text-sm font-semibold">{summary.title}</h3>
      <ul className="space-y-1 text-sm leading-5 text-muted-foreground">
        {summary.details.map((detail, i) => (
          <li key={i}>{detail}</li>
        ))}
      </ul>
      {action.errorCode ? (
        <p role="alert" className="text-sm text-destructive">
          {c.readableError(action.errorCode)}
        </p>
      ) : null}
      {active ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={c.busy || !c.available}
            onClick={() => void c.runAction(action.id)}
          >
            {c.executing === action.id ? <Spinner /> : null}
            {c.t(action.status === "FAILED" || action.canRecover ? "retry" : "execute")}
          </Button>
          {!action.canRecover ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={c.busy}
              onClick={() => void c.cancelAction(action.id)}
            >
              {c.t("cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {action.result && summary.href && isBaamLink(summary.href) ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={summary.href}
            prefetch={false}
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {c.t("openResult")}
            <ArrowUpRight size={14} />
          </Link>
          <button
            type="button"
            disabled={c.busy}
            className="min-h-9 text-sm font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2"
            onClick={() => void c.ask(c.t("continue"))}
          >
            {c.t("continue")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function BaamMessageList({ c }: { c: BaamController }) {
  const lastActionMessage = new Map<string, string>();
  const lastWorkflowMessage = new Map<string, string>();
  for (const message of c.messages)
    for (const part of Array.isArray(message.parts)
      ? (message.parts as unknown as BaamPart[])
      : []) {
      if (part.type === "action") lastActionMessage.set(part.actionId, message.id);
      if (part.type === "workflow") lastWorkflowMessage.set(part.workflowId, message.id);
    }
  const suggestions =
    c.pathname.startsWith("/inventory") || c.pathname.startsWith("/products")
      ? ["createProduct", "receive", "help"]
      : c.pathname.startsWith("/pos")
        ? ["sell", "sales", "help"]
        : ["topProducts", "sales", "help"];
  return (
    <>
      <div
        ref={c.scrollRef}
        data-baam-history
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
        onScroll={() => {
          const el = c.scrollRef.current;
          if (!el) return;
          c.nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          if (c.nearBottom.current) c.setUnread(false);
        }}
      >
        {c.hasOlder ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={c.loadingMore}
            onClick={() => void c.loadOlder()}
          >
            {c.t("earlier")}
          </Button>
        ) : null}
        {!c.messages.length && !c.optimistic && !c.fetching ? (
          <div className="py-5">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-primary/10 text-primary">
              <BaamIcon className="h-9 w-9" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">{c.t("welcome")}</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{c.t("intro")}</p>
            <div className="mt-7 grid gap-2">
              {suggestions.map((key) => (
                <button
                  type="button"
                  key={key}
                  disabled={!c.available || c.busy}
                  onClick={() =>
                    void c.ask(
                      c.t(key as BaamCopyKey),
                      undefined,
                      key === "topProducts"
                        ? undefined
                        : key === "help"
                          ? { kind: "help" }
                          : key === "sales"
                            ? { kind: "report", period: "week" }
                            : {
                                kind: "action",
                                action:
                                  key === "createProduct"
                                    ? "product_create"
                                    : key === "receive"
                                      ? "stock_receive"
                                      : "pos_create_draft",
                              },
                    )
                  }
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
                >
                  {c.t(key as BaamCopyKey)}
                  <ArrowUpRight size={16} className="shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ol
          aria-label={c.t("name")}
          className="space-y-6"
          aria-live="polite"
          aria-relevant="additions"
          role="log"
        >
          {c.messages.map((message) => (
            <li key={message.id} data-baam-entry className="min-w-0">
              {message.role === "user" ? (
                <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-6">
                  {message.text}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <BaamIcon className="h-5 w-5" />
                    BAAM
                  </p>
                  {message.role === "error" ? (
                    <p role="alert" className="break-words text-sm leading-6 text-destructive">
                      {c.readableError(message.text)}
                    </p>
                  ) : Array.isArray(message.parts) &&
                    (message.parts as unknown as BaamPart[]).some(
                      (part) => part.type === "metrics",
                    ) ? null : (
                    <BaamAnswerText
                      text={message.text}
                      links={(Array.isArray(message.parts)
                        ? (message.parts as unknown as BaamPart[])
                        : []
                      ).flatMap((part) => (part.type === "link" ? [part.href] : []))}
                    />
                  )}
                </div>
              )}
              {message.role === "error" &&
              [
                "baamProviderUnavailable",
                "baamProviderInvalidResponse",
                "baamInterrupted",
              ].includes(message.text) &&
              message.id === c.messages.at(-1)?.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={c.busy}
                  onClick={() => {
                    const previous = c.messages.find(
                      (m) => m.role === "user" && m.turnId === message.turnId,
                    );
                    if (previous) void c.ask(previous.text);
                  }}
                >
                  {c.t("retry")}
                </Button>
              ) : null}
              <div className="mt-3 space-y-3">
                {(Array.isArray(message.parts) ? (message.parts as unknown as BaamPart[]) : []).map(
                  (part, index) => {
                    if (part.type === "metrics")
                      return (
                        <section
                          key={index}
                          data-baam-metrics
                          className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
                        >
                          <div>
                            <h3 className="text-base font-semibold tracking-tight">{part.title}</h3>
                            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                              {part.period}
                            </p>
                            {part.stores.length ? (
                              <p className="break-words text-xs leading-5 text-muted-foreground">
                                {part.stores.join(" · ")}
                              </p>
                            ) : null}
                          </div>
                          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                            {part.cards.map((card, n) => (
                              <div key={n} className="min-w-0 rounded-xl bg-muted/50 p-3">
                                <dt className="text-xs leading-5 text-muted-foreground">
                                  {card.label}
                                </dt>
                                <dd className="mt-1 break-words text-xl font-semibold tabular-nums tracking-tight">
                                  {card.value}
                                </dd>
                                {card.comparison ? (
                                  <dd className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                                    {card.comparison}
                                  </dd>
                                ) : null}
                              </div>
                            ))}
                          </dl>
                          {part.notes.map((note, n) => (
                            <p key={n} className="text-xs leading-5 text-muted-foreground">
                              {note}
                            </p>
                          ))}
                        </section>
                      );
                    if (
                      part.type === "workflow" &&
                      lastWorkflowMessage.get(part.workflowId) === message.id
                    )
                      return (
                        <BaamWorkflowCard
                          key={part.workflowId}
                          workflowId={part.workflowId}
                          c={c}
                        />
                      );
                    if (part.type === "commands")
                      return (
                        <div key={index} className="flex flex-wrap gap-2">
                          {part.commands.map((command) => (
                            <Button
                              key={command.action}
                              size="sm"
                              variant="outline"
                              disabled={c.busy}
                              onClick={() =>
                                void c.ask(command.label, undefined, {
                                  kind: "action",
                                  action: command.action as WorkflowAction,
                                })
                              }
                            >
                              {command.label}
                            </Button>
                          ))}
                        </div>
                      );
                    if (
                      part.type === "action" &&
                      lastActionMessage.get(part.actionId) === message.id
                    )
                      return <ActionCard key={part.actionId} actionId={part.actionId} c={c} />;
                    if (part.type === "record" && isBaamLink(part.href))
                      return (
                        <article
                          key={`${part.id}-${index}`}
                          data-baam-record
                          className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4"
                        >
                          <Link
                            href={part.href}
                            prefetch={false}
                            className="inline-flex min-h-9 max-w-full items-center gap-2 break-words text-sm font-semibold text-primary hover:underline"
                          >
                            {part.title}
                            <ArrowUpRight size={14} className="shrink-0" />
                          </Link>
                          {part.sku ? (
                            <p className="break-all text-xs text-muted-foreground">{part.sku}</p>
                          ) : null}
                          <dl className="grid gap-2 text-sm sm:grid-cols-2">
                            {part.displayFields.map((field, n) => (
                              <div key={n} className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                                <dd className="break-words font-medium">{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </article>
                      );
                    if (part.type === "evidence")
                      return (
                        <details
                          key={index}
                          className="rounded-lg border px-3 py-2 text-xs text-muted-foreground"
                        >
                          <summary className="min-h-7 cursor-pointer py-1">
                            {c.t("dataSource")}
                          </summary>
                          <ul className="space-y-2 py-2">
                            {part.details.map((detail, n) => (
                              <li key={n}>{detail}</li>
                            ))}
                          </ul>
                        </details>
                      );
                    if (part.type === "choices")
                      return (
                        <div key={index} className="flex flex-wrap gap-2">
                          {part.choices.map((choice) => (
                            <Button
                              key={choice.value}
                              size="sm"
                              variant="outline"
                              className="h-auto min-h-10 max-w-full whitespace-normal text-left"
                              disabled={c.busy || !c.available}
                              onClick={() => void c.ask(choice.value)}
                            >
                              {choice.label}
                            </Button>
                          ))}
                        </div>
                      );
                    if (part.type === "link" && isBaamLink(part.href))
                      return (
                        <Link
                          key={index}
                          href={part.href}
                          prefetch={false}
                          className="mr-4 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {part.label}
                          <ArrowUpRight size={14} />
                        </Link>
                      );
                    if (part.type === "transcription")
                      return (
                        <details
                          key={part.id}
                          className="rounded-lg border px-3 py-2 text-xs text-muted-foreground"
                        >
                          <summary className="flex min-h-7 cursor-pointer items-center gap-2 focus-visible:outline focus-visible:outline-2">
                            <Microphone size={16} />
                            {c.t("transcription")}
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap break-words leading-5">
                            {part.text}
                          </p>
                        </details>
                      );
                    if (part.type === "attachment")
                      return (
                        <a
                          key={part.id}
                          href={`/api/baam/media?attachmentId=${encodeURIComponent(part.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
                        >
                          <ImageSquare size={17} />
                          <span className="truncate">{part.name}</span>
                          <ArrowUpRight size={14} />
                        </a>
                      );
                    return null;
                  },
                )}
              </div>
              {message.role === "assistant" && message.text ? (
                <BaamSpeech text={message.text} locale={c.locale} />
              ) : null}
            </li>
          ))}
        </ol>
        {c.optimistic && c.optimistic.conversationId === c.identity.activeId ? (
          <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-3 text-sm leading-6">
            {c.optimistic.text}
          </div>
        ) : null}
        {c.busy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner />
            {c.executing ? c.t("running") : c.t("thinking")}
          </div>
        ) : null}
      </div>
      {c.unread ? (
        <button
          type="button"
          className="absolute bottom-44 left-1/2 z-10 flex min-h-10 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-4 text-xs shadow-lg focus-visible:outline focus-visible:outline-2"
          onClick={c.bottom}
        >
          <ArrowDown size={15} />
          {c.t("latest")}
        </button>
      ) : null}
      {!c.messages.length && c.fetching ? (
        <p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Spinner />
          {c.t("loading")}
        </p>
      ) : null}
    </>
  );
}
