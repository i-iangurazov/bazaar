"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { ArchiveIcon, RestoreIcon, DeleteIcon, SendIcon, ViewIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDateTime } from "@/lib/i18nFormat";
import { Choice, Field, useFeedback, type Workspace } from "./workspace-ui";
import { WHATSAPP_OFFER_VERSION } from "@/lib/whatsapp-ai";

export function Conversations({
  storeId,
  data,
  active,
}: {
  storeId: string;
  data: Workspace;
  active: boolean;
}) {
  const t = useTranslations("whatsappAi"),
    errors = useTranslations("errors"),
    locale = useLocale(),
    feedback = useFeedback(),
    utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | "human" | "unread" | "archived">("all"),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState(""),
    [body, setBody] = useState(""),
    [confirmErase, setConfirmErase] = useState(false);
  const [photoId, setPhotoId] = useState(""),
    [photoLoading, setPhotoLoading] = useState(false),
    [photoError, setPhotoError] = useState(false);
  const key = useRef<string | null>(null);
  const drafts = useRef(new Map<string, { body: string; key: string | null }>());
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        body.trim() ||
        [...drafts.current.entries()].some(([id, draft]) => id !== selected && draft.body.trim())
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [body, selected]);
  const list = trpc.whatsappAi.conversations.useInfiniteQuery(
    { storeId, filter, search },
    {
      enabled: active,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      refetchInterval: active ? 10_000 : false,
    },
  );
  const conversation = trpc.whatsappAi.conversation.useQuery(
    { conversationId: selected },
    { enabled: active && Boolean(selected), refetchInterval: active ? 5000 : false },
  );
  const refresh = async () => {
    await Promise.all([
      utils.whatsappAi.conversations.invalidate(),
      utils.whatsappAi.conversation.invalidate(),
      utils.whatsappAi.workspace.invalidate({ storeId }),
    ]);
  };
  const mode = trpc.whatsappAi.mode.useMutation({ onError: feedback.error, onSuccess: refresh });
  const archive = trpc.whatsappAi.archive.useMutation({
    onError: feedback.error,
    onSuccess: refresh,
  });
  const seen = trpc.whatsappAi.seen.useMutation({ onError: feedback.error, onSuccess: refresh });
  const erase = trpc.whatsappAi.erase.useMutation({
    onError: feedback.error,
    onSuccess: async () => {
      drafts.current.delete(selected);
      setSelected("");
      setBody("");
      key.current = null;
      setConfirmErase(false);
      await refresh();
    },
  });
  const send = trpc.whatsappAi.send.useMutation({ onError: feedback.error });
  const c = conversation.data;
  const busy = mode.isLoading || archive.isLoading || send.isLoading || erase.isLoading;
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className={selected ? "hidden lg:block" : ""}>
        <CardHeader>
          <CardTitle>{t("tabs.conversations")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={t("search")}>
            <Input value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Choice
            label={t("filter")}
            value={filter}
            options={["all", "human", "unread", "archived"].map((value) => ({
              value,
              label: t(`filters.${value}`),
            }))}
            onChange={(v) => setFilter(v as typeof filter)}
          />
          {list.error && <QueryErrorState error={list.error} onRetry={() => void list.refetch()} />}
          {list.isLoading && <p>{t("loading")}</p>}
          {!list.isLoading && !list.error && !list.data?.pages.some((p) => p.items.length) && (
            <p className="py-6 text-sm text-muted-foreground">{t("noConversations")}</p>
          )}
          <div className="space-y-1">
            {list.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  className={`w-full rounded-md p-3 text-left hover:bg-accent ${selected === item.id ? "bg-secondary" : ""}`}
                  onClick={() => {
                    if (selected) drafts.current.set(selected, { body, key: key.current });
                    const draft = drafts.current.get(item.id);
                    setSelected(item.id);
                    setBody(draft?.body ?? "");
                    key.current = draft?.key ?? null;
                  }}
                >
                  <span className="flex justify-between gap-2">
                    <span className="truncate font-medium">
                      {item.name || item.phone || t("customer")}
                    </span>
                    {item.unread && <Badge variant="default">{t("unread")}</Badge>}
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {item.preview || t(`kinds.${item.kind ?? "OTHER"}`)}
                  </span>
                  {item.needsHuman && (
                    <span className="mt-1 block text-xs text-warning">{t("needsHuman")}</span>
                  )}
                </button>
              ))}
          </div>
          {list.hasNextPage && (
            <Button
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t("loadMore")}
            </Button>
          )}
        </CardContent>
      </Card>
      <Card className={!selected ? "hidden lg:block" : ""}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{c?.name || c?.phone || t("chooseConversation")}</CardTitle>
            {c && (
              <div className="flex flex-wrap gap-2">
                <Badge variant={c.mode === "AI" ? "success" : "muted"}>
                  {t(c.mode === "AI" ? "aiMode" : "humanMode")}
                </Badge>
                <IconButton
                  icon={c.archived ? RestoreIcon : ArchiveIcon}
                  label={t(c.archived ? "restore" : "archive")}
                  variant="ghost"
                  disabled={busy}
                  onClick={() => archive.mutate({ conversationId: c.id, archived: !c.archived })}
                />
                {data.canConnect && (
                  <IconButton
                    icon={DeleteIcon}
                    label={t("erase")}
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmErase(true)}
                  />
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected && (
            <Button
              className="lg:hidden"
              disabled={busy}
              variant="secondary"
              onClick={() => {
                drafts.current.set(selected, { body, key: key.current });
                setSelected("");
                setBody("");
                key.current = null;
              }}
            >
              {t("back")}
            </Button>
          )}
          {conversation.error && (
            <QueryErrorState
              error={conversation.error}
              onRetry={() => void conversation.refetch()}
            />
          )}
          {selected && conversation.isLoading && <p>{t("loading")}</p>}
          {c && !conversation.error && (
            <>
              {c.lastIssue && (
                <p role="status" className="rounded-md bg-secondary p-3 text-sm">
                  {errors.has(c.lastIssue) ? errors(c.lastIssue) : t("needsHuman")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    (c.mode === "HUMAN" &&
                      (!data.readiness.ready ||
                        !data.connection?.aiEnabled ||
                        !data.active ||
                        !data.quota.remaining ||
                        c.archived))
                  }
                  onClick={() =>
                    mode.mutate({
                      conversationId: c.id,
                      mode: c.mode === "AI" ? "HUMAN" : "AI",
                      expectedVersion: c.version,
                    })
                  }
                >
                  {t(c.mode === "AI" ? "takeover" : "resumeAi")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={seen.isLoading}
                  onClick={() => seen.mutate({ conversationId: c.id, sequence: c.inboundSequence })}
                >
                  {t("markSeen")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("readHelp")}</p>
              <div
                className="max-h-[55vh] space-y-3 overflow-y-auto rounded-md border p-3"
                aria-label={t("history")}
              >
                {c.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[95%] space-y-2 rounded-lg p-3 text-sm ${message.direction === "INBOUND" ? "bg-secondary" : "ml-auto bg-primary/10"}`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(
                        message.direction === "INBOUND"
                          ? "customer"
                          : message.direction === "STAFF_APP"
                            ? "staffApp"
                            : message.actorId
                              ? "staff"
                              : "assistant",
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words leading-6">
                      {message.body || t(`kinds.${message.kind}`)}
                    </p>
                    {message.kind === "IMAGE" &&
                      (Date.now() - new Date(message.createdAt).getTime() >= 7 * 86400_000 ? (
                        <p className="text-xs text-muted-foreground">{t("mediaExpired")}</p>
                      ) : (
                        <Button
                          variant="link"
                          onClick={() => {
                            setPhotoId(message.id);
                            setPhotoLoading(true);
                            setPhotoError(false);
                          }}
                        >
                          {t("viewImage")}
                        </Button>
                      ))}
                    {["AUDIO", "DOCUMENT", "VIDEO", "STICKER", "OTHER"].includes(message.kind) && (
                      <p className="text-xs text-muted-foreground">{t("unsupportedMedia")}</p>
                    )}
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <time>{formatDateTime(message.createdAt, locale)}</time>
                      {message.direction === "OUTBOUND" && (
                        <span>{t(`messageStates.${message.state}`)}</span>
                      )}
                    </div>
                    {message.state === "UNKNOWN" && (
                      <p className="text-xs">{t("unknownDelivery")}</p>
                    )}
                  </article>
                ))}
              </div>
              {!c.windowOpen && (
                <p className="rounded-md bg-secondary p-3 text-sm">{t("windowClosed")}</p>
              )}
              {!c.countrySupported && (
                <p className="rounded-md bg-secondary p-3 text-sm">{t("countryUnsupported")}</p>
              )}
              {(!data.readiness.transportReady || data.connection?.state !== "CONNECTED") && (
                <p className="rounded-md bg-secondary p-3 text-sm">{t("connectionNeeded")}</p>
              )}
              <Field label={t("reply")}>
                <Textarea
                  value={body}
                  maxLength={4096}
                  disabled={busy || !c.windowOpen || !c.countrySupported || c.archived}
                  onChange={(e) => {
                    setBody(e.target.value);
                    key.current = null;
                  }}
                />
              </Field>
              <Button
                disabled={
                  busy ||
                  !body.trim() ||
                  !c.windowOpen ||
                  !c.countrySupported ||
                  c.archived ||
                  !data.active ||
                  !data.quota.remaining ||
                  !data.readiness.transportReady ||
                  !data.readiness.manualWorkerReady ||
                  data.connection?.state !== "CONNECTED"
                }
                onClick={async () => {
                  key.current ??= crypto.randomUUID();
                  try {
                    await send.mutateAsync({
                      conversationId: c.id,
                      body,
                      idempotencyKey: key.current,
                    });
                    drafts.current.delete(c.id);
                    setBody("");
                    key.current = null;
                    await refresh();
                  } catch {
                    /* Preserve text and request key for a safe retry. */
                  }
                }}
              >
                <SendIcon className="mr-2 h-4 w-4" aria-hidden />
                {t("send")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("manualHelp")}</p>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={confirmErase} onOpenChange={setConfirmErase}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erase")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6">{t("eraseHelp")}</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmErase(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={erase.isLoading || !c}
              onClick={() => c && erase.mutate({ conversationId: c.id, confirmed: true })}
            >
              {t("eraseConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(photoId)}
        onOpenChange={(open) => {
          if (!open) setPhotoId("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("customerImage")}</DialogTitle>
          </DialogHeader>
          {photoLoading && !photoError && <p role="status">{t("loading")}</p>}
          {photoError ? (
            <p role="alert" className="text-sm">
              {t("mediaUnavailable")}
            </p>
          ) : (
            photoId && (
              <Image
                src={`/api/integrations/whatsapp/media/${photoId}`}
                alt={t("customerImage")}
                width={960}
                height={960}
                unoptimized
                className="max-h-[65vh] w-full object-contain"
                onLoadingComplete={() => setPhotoLoading(false)}
                onError={() => {
                  setPhotoError(true);
                  setPhotoLoading(false);
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Costs({
  storeId,
  data,
  reload,
}: {
  storeId: string;
  data: Workspace;
  reload: () => Promise<unknown>;
}) {
  const t = useTranslations("whatsappAi"),
    locale = useLocale(),
    feedback = useFeedback();
  const payments = trpc.whatsappAi.payments.useQuery(undefined, {
    enabled: data.canConnect,
    refetchInterval: 15_000,
  });
  const [quantity, setQuantity] = useState("1"),
    [agreed, setAgreed] = useState(false);
  const key = useRef<string | null>(null);
  const checkout = trpc.whatsappAi.checkout.useMutation({ onError: feedback.error });
  const check = trpc.whatsappAi.checkPayment.useMutation({
    onError: feedback.error,
    onSuccess: async () => {
      await payments.refetch();
      await reload();
    },
  });
  const money = (minor: number) => formatCurrency(minor / 100, locale, "KGS");
  const pending = payments.data?.invoices.some(
    (invoice) =>
      ["CREATING", "PENDING", "REVIEW"].includes(invoice.status) &&
      invoice.lastIssue !== "REFUND_REVIEW",
  );
  useEffect(() => {
    if (!pending) key.current = null;
  }, [pending]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            "included",
            `${Math.max(0, data.quota.included - data.quota.includedUsed - data.quota.reserved)} / ${data.quota.included}`,
          ],
          ["paidRemaining", String(data.quota.paidRemaining)],
          ["reserved", String(data.quota.reserved + data.quota.paidReserved)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">{t(label)}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{value}</CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("balanceRules")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6">
          <p>{t("quotaHelp")}</p>
          <p>{t("renewsAt", { date: formatDateTime(data.quota.renewsAt, locale) })}</p>
          <p>{t("packExpiry")}</p>
          <p className="text-muted-foreground">{t("limitsHelp")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("buyPack")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            {t("packPrice", { count: data.pack.messages, price: money(data.pack.priceMinor) })}
          </p>
          {!data.canConnect ? (
            <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>
          ) : (
            <>
              {payments.error && (
                <QueryErrorState error={payments.error} onRetry={() => void payments.refetch()} />
              )}
              {!payments.data?.ready && (
                <p className="rounded-md bg-secondary p-3 text-sm">{t("paymentsUnavailable")}</p>
              )}
              <div className="max-w-xs">
                <Choice
                  label={t("packs")}
                  value={quantity}
                  options={Array.from({ length: 10 }, (_, i) => ({
                    value: String(i + 1),
                    label: `${(i + 1) * data.pack.messages} · ${money((i + 1) * data.pack.priceMinor)}`,
                  }))}
                  onChange={(v) => {
                    setQuantity(v);
                    key.current = null;
                    setAgreed(false);
                  }}
                />
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="wa-terms"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(v === true)}
                />
                <Label htmlFor="wa-terms" className="text-sm leading-6">
                  {t("agreeTerms")}{" "}
                  {payments.data?.termsUrl && (
                    <a
                      href={payments.data.termsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      {t("termsLink")}
                    </a>
                  )}
                </Label>
              </div>
              <Button
                disabled={
                  !payments.data?.ready ||
                  !agreed ||
                  !data.active ||
                  !data.readiness.manualWorkerReady ||
                  data.connection?.state !== "CONNECTED" ||
                  pending ||
                  checkout.isLoading
                }
                onClick={async () => {
                  key.current ??= crypto.randomUUID();
                  try {
                    const result = await checkout.mutateAsync({
                      storeId,
                      selection: {
                        quantity: Number(quantity),
                        offerVersion: WHATSAPP_OFFER_VERSION,
                        termsAccepted: true,
                        termsVersion: payments.data!.termsVersion,
                        expectedAmountMinor: Number(quantity) * data.pack.priceMinor,
                        idempotencyKey: key.current,
                        locale: locale as "ru" | "kg" | "en",
                      },
                    });
                    if (result.status === "PAID") key.current = null;
                    await payments.refetch();
                  } catch {
                    /* The same key survives retries; a pending invoice prevents a second charge. */
                  }
                }}
              >
                {t("pay", { price: money(Number(quantity) * data.pack.priceMinor) })}
              </Button>
              <p className="text-xs text-muted-foreground">{t("paymentHelp")}</p>
              <div className="divide-y">
                {payments.data?.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      <p>
                        {invoice.quantity * data.pack.messages} · {money(invoice.amountMinor)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`invoiceStates.${invoice.status}`)} ·{" "}
                        {formatDateTime(invoice.createdAt, locale)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {invoice.checkoutUrl && (
                        <IconButton
                          icon={ViewIcon}
                          label={t("continuePayment")}
                          variant="secondary"
                          href={invoice.checkoutUrl}
                          openInNewTab
                        />
                      )}
                      {invoice.status !== "PAID" && (
                        <IconButton
                          icon={RestoreIcon}
                          label={t("checkPayment")}
                          loading={check.isLoading}
                          disabled={check.isLoading}
                          variant="ghost"
                          onClick={() => check.mutate({ invoiceId: invoice.id })}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
