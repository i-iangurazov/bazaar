"use client";
import { useState } from "react";
import { ClockCounterClockwise, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { BaamIdentity } from "./baam-assistant";
import { useBaamCompanion, type BaamController } from "./use-baam-companion";
import { BaamMessageList } from "./baam-message-list";
import { BaamComposer } from "./baam-composer";

function History({ c }: { c: BaamController }) {
  const history = trpc.baam.conversations.useInfiniteQuery(
    {},
    {
      getNextPageParam: (page) => page.next ?? undefined,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );
  // tRPC infinite queries use a `cursor` input; the server exposes a stable ID cursor.
  const [error, setError] = useState<string>();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-baam-dialogs>
      <h2 className="mb-4 text-lg font-semibold">{c.t("history")}</h2>
      {history.isLoading ? <Spinner /> : null}
      {!history.data?.pages[0].items.length && !history.isLoading ? (
        <p className="text-sm text-muted-foreground">{c.t("emptyHistory")}</p>
      ) : null}
      {error || history.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? c.readableError(history.error)}
        </p>
      ) : null}
      <ul className="space-y-1">
        {history.data?.pages
          .flatMap((p) => p.items)
          .map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  "w-full rounded-xl p-3 text-left transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2",
                  item.id === c.identity.activeId && "bg-secondary",
                )}
                onClick={() => {
                  c.identity.setActiveId(item.id);
                  c.setShowHistory(false);
                }}
              >
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <time
                  className="mt-1 block text-xs text-muted-foreground"
                  dateTime={item.updatedAt.toISOString()}
                >
                  {new Intl.DateTimeFormat(c.locale === "kg" ? "ky" : c.locale, {
                    dateStyle: "medium",
                  }).format(item.updatedAt)}
                </time>
              </button>
            </li>
          ))}
      </ul>
      {history.hasNextPage ? (
        <Button
          variant="ghost"
          className="mt-3"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage().catch((e) => setError(c.readableError(e)))}
        >
          {c.t("more")}
        </Button>
      ) : null}
    </div>
  );
}
export function BaamCompanionPanel({
  identity,
  compact,
}: {
  identity: BaamIdentity;
  compact: boolean;
}) {
  const c = useBaamCompanion(identity);
  return (
    <section
      data-baam-chat
      className={cn(
        "relative flex min-h-0 flex-col bg-card text-card-foreground",
        compact ? "h-full" : "h-[min(50rem,78dvh)] min-h-[30rem]",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Button
          size="sm"
          variant={c.showHistory ? "secondary" : "ghost"}
          onClick={() => {
            c.voice.stop(true);
            c.setShowHistory(!c.showHistory);
          }}
        >
          <ClockCounterClockwise size={17} />
          <span className="ml-1.5">{c.t(c.showHistory ? "back" : "history")}</span>
        </Button>
        <div className="min-w-0 flex-1" />
        <Button size="sm" variant="ghost" onClick={c.newConversation}>
          <Plus size={17} />
          <span className="ml-1.5">{c.t("new")}</span>
        </Button>
      </div>
      {c.showHistory ? (
        <History c={c} />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs">
            <label htmlFor="baam-store" className="sr-only">
              {c.t("store")}
            </label>
            <Select
              value={(c.data?.conversation.storeId ?? c.draftStore) || "all"}
              disabled={c.busy || !c.allowed || c.changing}
              onValueChange={(value) => void c.changeStore(value === "all" ? "" : value)}
            >
              <SelectTrigger id="baam-store" aria-label={c.t("store")} className="h-9 flex-1">
                <SelectValue placeholder={c.t("allStores")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{c.t("allStores")}</SelectItem>
                {c.capabilities.data?.stores.map((s) => (
                  <SelectItem value={s.id} key={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {c.data ? (
              <>
                <button
                  type="button"
                  aria-label={c.t("rename")}
                  className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary focus-visible:outline focus-visible:outline-2"
                  onClick={() => c.setRename(c.data!.conversation.title)}
                >
                  <PencilSimple size={17} />
                </button>
                <button
                  type="button"
                  aria-label={c.t("remove")}
                  disabled={c.busy}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive focus-visible:outline focus-visible:outline-2"
                  onClick={() => void c.removeConversation()}
                >
                  <Trash size={17} />
                </button>
              </>
            ) : null}
          </div>
          {c.rename !== undefined ? (
            <form
              className="flex shrink-0 gap-2 border-b p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void c.renameConversation();
              }}
            >
              <input
                aria-label={c.t("rename")}
                autoFocus
                maxLength={100}
                value={c.rename}
                onChange={(e) => c.setRename(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
              />
              <Button size="sm" disabled={!c.rename.trim() || c.changing}>
                {c.t("save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => c.setRename(undefined)}
              >
                {c.t("cancel")}
              </Button>
            </form>
          ) : null}
          <BaamMessageList c={c} />
          <BaamComposer c={c} />
        </>
      )}
    </section>
  );
}
