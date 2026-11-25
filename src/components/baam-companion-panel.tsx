"use client";
import type { ReactNode } from "react";
import {
  ProductMovementIcon as ClockCounterClockwise,
  EditIcon as PencilSimple,
  AddIcon as Plus,
  DeleteIcon as Trash,
  TableViewIcon as ListBullets,
} from "@/components/icons";
import { baamText } from "@/lib/baam/companion";
import { workflowTitle, type WorkflowAction } from "@/lib/baam/workflows";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
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
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-baam-dialogs>
      <h2 className="mb-4 text-lg font-semibold">{c.t("history")}</h2>
      {history.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> {c.t("loading")}
      </p> : null}
      {!history.data?.pages[0].items.length && !history.isLoading && !history.error ? (
        <p className="text-sm text-muted-foreground">{c.t("emptyHistory")}</p>
      ) : null}
      {history.error ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{c.readableError(history.error)}</p>
          {!history.hasNextPage ? <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            {c.t("retry")}
          </Button> : null}
        </div>
      ) : null}
      <ul className="space-y-1">
        {history.data?.pages
          .flatMap((p) => p.items)
          .map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  "w-full rounded-lg p-3 text-left transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2",
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
          onClick={() => void history.fetchNextPage()}
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
  nativeViewport = false,
  compactViewport = false,
  workspaceHeader,
}: {
  identity: BaamIdentity;
  compact: boolean;
  nativeViewport?: boolean;
  compactViewport?: boolean;
  workspaceHeader?: ReactNode;
}) {
  const c = useBaamCompanion(identity);
  return (
    <section
      data-baam-chat
      className={cn(
        "relative flex min-h-0 flex-col bg-card text-card-foreground",
        compact
          ? "h-full"
          : "h-[calc(100dvh-16rem)] min-h-[24rem] sm:h-[min(50rem,78dvh)] sm:min-h-[30rem]",
      )}
    >
      <div
        ref={nativeViewport ? c.scrollRef : undefined}
        data-baam-scrollport={nativeViewport ? "workspace" : undefined}
        className={nativeViewport ? "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" : "contents"}
        onScroll={nativeViewport ? () => {
          const element = c.scrollRef.current;
          if (!element) return;
          c.nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          if (c.nearBottom.current) c.setUnread(false);
        } : undefined}
      >
      {workspaceHeader}
      <div data-baam-toolbar className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-1.5 sm:px-4">
        <Button
          size="sm"
          className="h-11 shrink-0 whitespace-nowrap px-2 sm:h-9"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
              disabled={c.busy || !c.available}
              aria-label={baamText(c.locale, "Действия BAAM", "BAAM actions", "BAAM иш-аракеттери")}
            >
              <ListBullets size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-[min(28rem,65dvh)] w-72 overflow-y-auto"
          >
            {c.capabilities.data?.workflows?.map((action) => (
              <DropdownMenuItem
                key={action}
                onSelect={() =>
                  void c.ask(workflowTitle(action, c.locale), undefined, {
                    kind: "action",
                    action: action as WorkflowAction,
                  })
                }
              >
                {workflowTitle(action, c.locale)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="ghost"
          className="h-11 shrink-0 whitespace-nowrap px-2 sm:h-9"
          onClick={c.newConversation}
          aria-label={c.t("new")}
        >
          <Plus size={17} />
          <span className="ml-1.5 hidden sm:inline">{c.t("new")}</span>
        </Button>
      </div>
      {c.allowed && !c.capabilities.data?.configured ? (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground" role="status">
          {c.t("localMode")}
        </p>
      ) : null}
      {compactViewport ? <p data-baam-voice-hint className="shrink-0 border-b border-border/60 px-4 py-2 text-[10px] leading-4 text-muted-foreground">
        {c.t("voiceSupport")}
      </p> : null}
      {c.showHistory ? (
        <History c={c} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs sm:px-4">
            <label htmlFor="baam-store" className="sr-only">
              {c.t("store")}
            </label>
            <Select
              value={(c.data?.conversation.storeId ?? c.draftStore) || "all"}
              disabled={c.busy || !c.available || c.changing}
              onValueChange={(value) => void c.changeStore(value === "all" ? "" : value)}
            >
              <SelectTrigger id="baam-store" aria-label={c.t("store")} className="h-11 min-w-0 flex-1 sm:h-9">
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
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-secondary focus-visible:outline focus-visible:outline-2 sm:h-9 sm:w-9"
                  onClick={() => c.setRename(c.data!.conversation.title)}
                >
                  <PencilSimple size={17} />
                </button>
                <button
                  type="button"
                  aria-label={c.t("remove")}
                  disabled={c.busy}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive focus-visible:outline focus-visible:outline-2 sm:h-9 sm:w-9"
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
          <BaamMessageList c={c} externalScrollContainer={nativeViewport} />
        </>
      )}
      </div>
      {!c.showHistory ? <div data-baam-composer className={nativeViewport ? "min-h-0 shrink-0 overflow-y-auto" : "min-h-0 shrink overflow-y-auto overscroll-contain"}><BaamComposer c={c} inlineControls={compactViewport} /></div> : null}
    </section>
  );
}
