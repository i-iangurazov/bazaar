"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
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
import type { BaamIdentity, BaamPhoneLayout } from "./baam-assistant";
import { useBaamCompanion, type BaamController } from "./use-baam-companion";
import { BaamMessageList, BaamResponseProgress } from "./baam-message-list";
import { BaamComposer } from "./baam-composer";

function History({ c, externalScrollContainer }: { c: BaamController; externalScrollContainer: boolean }) {
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
    <div className={cn("p-4", externalScrollContainer ? "shrink-0" : "min-h-0 flex-1 overflow-y-auto")} data-baam-dialogs>
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
  phoneLayout,
  workspaceHeader,
}: {
  identity: BaamIdentity;
  compact: boolean;
  nativeViewport?: boolean;
  compactViewport?: boolean;
  phoneLayout?: BaamPhoneLayout;
  workspaceHeader?: ReactNode;
}) {
  const c = useBaamCompanion(identity);
  const phone = Boolean(phoneLayout);
  const keyboard = phoneLayout === "keyboard";
  const { scrollRef, nearBottom, showHistory } = c;
  const activeWorkflow = c.data?.conversation.activeWorkflowId;
  const hasConversationActivity = Boolean(c.messages.length || c.optimistic || c.progress);
  const dialogListRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const readingPosition = useRef<{ id: BaamIdentity["activeId"]; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!phone) return;
    if (showHistory) {
      if (dialogListRef.current) dialogListRef.current.scrollTop = 0;
      return;
    }
    const previous = readingPosition.current;
    readingPosition.current = null;
    if (previous && previous.id === identity.activeId && scrollRef.current) {
      scrollRef.current.scrollTop = previous.top;
    }
  }, [identity.activeId, phone, scrollRef, showHistory]);

  useLayoutEffect(() => {
    const port = scrollRef.current;
    if (!phoneLayout || showHistory || !port || !hasConversationActivity || activeWorkflow) return;
    const followLatest = () => {
      if (nearBottom.current) port.scrollTop = port.scrollHeight;
    };
    followLatest();
    if (typeof ResizeObserver === "undefined") return;
    let viewportHeight = port.clientHeight;
    let contentHeight = port.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (port.clientHeight === viewportHeight && port.scrollHeight === contentHeight) return;
      viewportHeight = port.clientHeight;
      contentHeight = port.scrollHeight;
      followLatest();
    });
    observer.observe(port);
    if (transcriptRef.current) observer.observe(transcriptRef.current);
    return () => observer.disconnect();
  }, [activeWorkflow, hasConversationActivity, nearBottom, phoneLayout, scrollRef, showHistory]);

  const toolbar = (
      <div
        data-baam-toolbar
        data-baam-phone-toolbar={phone ? "" : undefined}
        className={cn(
          "flex shrink-0 items-center border-b border-border/70",
          phone ? "min-h-11 gap-1 px-1" : "gap-2 px-3 py-1.5 sm:px-4",
        )}
      >
        {phone ? workspaceHeader : null}
        <Button
          size="sm"
          className="h-11 shrink-0 whitespace-nowrap px-2 sm:h-9"
          variant={c.showHistory ? "secondary" : "ghost"}
          onClick={() => {
            if (phone && !showHistory && scrollRef.current) {
              readingPosition.current = { id: identity.activeId, top: scrollRef.current.scrollTop };
            }
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
  );
  const localMode = c.allowed && !c.capabilities.data?.configured ? (
    <p className={cn("border-b border-border/60 px-3 py-2 text-xs text-muted-foreground", phone && "shrink-0")} role="status">
      {c.t("localMode")}
    </p>
  ) : null;
  const conversationControls = (
    <>
      {!phone ? localMode : null}
      {!keyboard && compactViewport && c.capabilities.data?.voiceConfigured ? <p data-baam-voice-hint className="shrink-0 border-b border-border/60 px-4 py-2 text-[10px] leading-4 text-muted-foreground">
        {c.t("voiceSupport")}
      </p> : null}
      {!showHistory ? (
        <>
          {!keyboard ? <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs sm:px-4">
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
          </div> : null}
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
        </>
      ) : null}
    </>
  );
  const transcript = showHistory
    ? <History c={c} externalScrollContainer={phone} />
    : <BaamMessageList c={c} externalScrollContainer={nativeViewport} externalProgress={phone} />;
  return (
    <section
      data-baam-chat
      data-baam-phone-layout={phoneLayout}
      className={cn(
        "relative flex min-h-0 flex-col bg-card text-card-foreground",
        compact
          ? "h-full"
          : "h-[calc(100dvh-16rem)] min-h-[24rem] sm:h-[min(50rem,78dvh)] sm:min-h-[30rem]",
      )}
    >
      {phone ? <>{toolbar}{conversationControls}</> : null}
      <div
        ref={nativeViewport ? (phone && showHistory ? dialogListRef : scrollRef) : undefined}
        data-baam-scrollport={nativeViewport ? "workspace" : undefined}
        className={nativeViewport ? "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" : "contents"}
        onScroll={nativeViewport && !(phone && showHistory) ? () => {
          const element = scrollRef.current;
          if (!element) return;
          nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          if (nearBottom.current) c.setUnread(false);
        } : undefined}
      >
        {phone ? (
          <div ref={transcriptRef} className="min-w-0 shrink-0">
            {localMode}
            {transcript}
          </div>
        ) : <>{workspaceHeader}{toolbar}{conversationControls}{transcript}</>}
      </div>
      {phone && !showHistory ? <BaamResponseProgress c={c} docked /> : null}
      {!showHistory ? <div data-baam-composer className={nativeViewport ? "min-h-0 shrink-0 overflow-y-auto" : "min-h-0 shrink overflow-y-auto overscroll-contain"}><BaamComposer c={c} inlineControls={phone || compactViewport} /></div> : null}
    </section>
  );
}
