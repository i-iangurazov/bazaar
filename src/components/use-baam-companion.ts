"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc";
import { normalizeLocale } from "@/lib/locales";
import { baamCopy, baamKnownError, type BaamCopyKey } from "@/lib/baam/copy";
import type { BaamSend } from "@/lib/baam/companion";
import type { BaamIdentity } from "./baam-assistant";
import { useBaamVoice } from "./baam-voice";

export type BaamData = inferRouterOutputs<AppRouter>["baam"]["conversation"];
export function useBaamCompanion(identity: BaamIdentity) {
  const locale = normalizeLocale(useLocale()) ?? "ru";
  const t = (key: BaamCopyKey) => baamCopy(locale, key);
  const tErrors = useTranslations("errors");
  const pathname = usePathname().replace(/^\/(ru|en|kg)(?=\/|$)/, "") || "/";
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [showHistory, setShowHistory] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [older, setOlder] = useState<BaamData["messages"]>([]);
  const [olderActions, setOlderActions] = useState<BaamData["actions"]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [rename, setRename] = useState<string>();
  const [unread, setUnread] = useState(false);
  const [newIndex, setNewIndex] = useState(0);
  const slot = identity.activeId ?? `new-${newIndex}`;
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const [uploadSlot, setUploadSlot] = useState<string>();
  const mediaPending = uploadSlot === slot;
  const [mediaKind, setMediaKind] = useState<"audio" | "image">("audio");
  const [attachments, setAttachments] = useState<Array<{ id: string; url: string; name: string }>>(
    [],
  );
  const [voiceId, setVoiceId] = useState<string>();
  const [voiceBlob, setVoiceBlob] = useState<Blob>();
  const [pendingRequest, setPendingRequest] = useState<BaamSend>();
  const [optimistic, setOptimistic] = useState<{ text: string; conversationId: string }>();
  const [executions, setExecutions] = useState<Record<string, string>>({});
  const executing = executions[slot];
  const [sendingSlots, setSendingSlots] = useState<Record<string, string>>({});
  const [draftStore, setDraftStore] = useState("");
  const draftKey = `baam-draft:${identity.organizationId}:${identity.userId}:${identity.activeId ?? "new"}`;
  const [draftReady, setDraftReady] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const busyRef = useRef(new Map<string, string>());
  const createdLocally = useRef<string>();
  const identityRef = useRef(identity.activeId);
  identityRef.current = identity.activeId;
  const create = trpc.baam.createConversation.useMutation();
  const change = trpc.baam.changeConversation.useMutation();
  const send = trpc.baam.send.useMutation();
  const stop = trpc.baam.stop.useMutation();
  const execute = trpc.baam.execute.useMutation();
  const cancel = trpc.baam.cancelAction.useMutation();
  const capabilities = trpc.baam.companion.useQuery(undefined, {
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    cacheTime: 0,
  });
  const conversation = trpc.baam.conversation.useQuery(
    { id: identity.activeId ?? "" },
    {
      enabled: Boolean(identity.activeId),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: (data) =>
        data?.activeTurn || data?.actions.some((a) => a.status === "RUNNING") ? 1200 : 10000,
    },
  );
  const allowed =
    capabilities.data?.actorId === identity.userId &&
    capabilities.data.organizationId === identity.organizationId &&
    !capabilities.error;
  const raw = conversation.data;
  const data =
    allowed &&
    !conversation.error &&
    raw?.conversation.id === identity.activeId &&
    raw.conversation.userId === identity.userId &&
    raw.conversation.organizationId === identity.organizationId &&
    (!raw.conversation.storeId ||
      capabilities.data?.stores.some((s) => s.id === raw.conversation.storeId))
      ? raw
      : undefined;
  const available = allowed && capabilities.data?.configured;
  const busy =
    Boolean(sendingSlots[slot]) ||
    Boolean(data?.activeTurn) ||
    Boolean(executing) ||
    Boolean(data?.actions.some((a) => a.status === "RUNNING" && !a.canRecover));
  const messages = [
    ...new Map([...(data ? older : []), ...(data?.messages ?? [])].map((m) => [m.id, m])).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const actions = [
    ...new Map(
      [...(data ? olderActions : []), ...(data?.actions ?? [])].map((a) => [a.id, a]),
    ).values(),
  ];
  const readableError = (value: unknown) => {
    const code =
      typeof value === "string" ? value : value instanceof Error ? value.message : "network";
    return (
      baamKnownError(locale, code) ??
      (tErrors.has(code) ? tErrors(code) : tErrors("genericMessage"))
    );
  };
  const bottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    nearBottom.current = true;
    setUnread(false);
  };
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [showHistory]);
  useEffect(() => {
    if (createdLocally.current === identity.activeId) {
      createdLocally.current = undefined;
      return;
    }
    setOlder([]);
    setOlderActions([]);
    setOlderCursor(undefined);
    setQuestion("");
    setAttachments([]);
    setVoiceId(undefined);
    setVoiceBlob(undefined);
    setError(undefined);
    setNotice(undefined);
    setPendingRequest(undefined);
    setOptimistic(undefined);
    nearBottom.current = true;
  }, [identity.activeId]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as {
        text?: string;
        attachments?: typeof attachments;
        voiceId?: string;
        pending?: BaamSend;
        at?: number;
      } | null;
      if (saved?.at && Date.now() - saved.at < 86400000) {
        setQuestion(saved.text ?? "");
        setAttachments(saved.attachments ?? []);
        setVoiceId(saved.voiceId);
        setPendingRequest(saved.pending);
        if (saved.pending) setError(baamCopy(locale, "network"));
      }
    } catch {
      /* Server history remains available if local draft storage is blocked. */
    }
    setDraftReady(draftKey);
  }, [draftKey, locale]);
  useEffect(() => {
    if (draftReady !== draftKey) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          text: question,
          attachments,
          voiceId,
          pending: pendingRequest,
          at: Date.now(),
        }),
      );
    } catch {
      /* Draft persistence is optional. */
    }
  }, [draftKey, draftReady, question, attachments, voiceId, pendingRequest]);
  const lastMessageId = data?.messages.at(-1)?.id;
  useEffect(() => {
    if (!lastMessageId && !optimistic) {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      return;
    }
    if (nearBottom.current) bottom();
    else setUnread(true);
  }, [lastMessageId, data?.activeTurn?.id, optimistic]);
  useEffect(() => {
    if (
      optimistic &&
      data?.messages.some(
        (m) =>
          m.role === "user" &&
          m.text === optimistic.text &&
          m.conversationId === optimistic.conversationId,
      )
    )
      setOptimistic(undefined);
  }, [data?.messages, optimistic]);
  const pageStore = () => {
    let value = searchParams.get("storeId") ?? "";
    if (!value && pathname.startsWith("/inventory"))
      try {
        value =
          JSON.parse(
            localStorage.getItem(
              `inventory-table-state:${identity.organizationId}:${identity.userId}`,
            ) ?? "null",
          )?.storeId ?? "";
      } catch {
        /* optional page hint */
      }
    return capabilities.data?.stores.some((s) => s.id === value) ? value : "";
  };
  const ensureConversation = async () => {
    if (identityRef.current) return identityRef.current;
    const originalSlot = slotRef.current;
    const storeId = draftStore || pageStore();
    const created = await create.mutateAsync({ locale, ...(storeId ? { storeId } : {}) });
    if (slotRef.current === originalSlot) {
      createdLocally.current = created.id;
      try {
        const source = sessionStorage.getItem(
          `baam-draft:${identity.organizationId}:${identity.userId}:new`,
        );
        if (source)
          sessionStorage.setItem(
            `baam-draft:${identity.organizationId}:${identity.userId}:${created.id}`,
            source,
          );
      } catch {
        /* optional */
      }
      identityRef.current = created.id;
      slotRef.current = created.id;
      identity.setActiveId(created.id);
    }
    return created.id;
  };
  const refresh = async (id: string) => {
    await Promise.all([
      utils.baam.conversation.invalidate({ id }),
      utils.baam.conversations.invalidate(),
    ]);
  };
  const ask = async (text = question, retry?: BaamSend) => {
    if ((!text.trim() && !retry) || busyRef.current.has(slot) || busy || !available) return;
    const requestSlot = slotRef.current;
    const requestToken = crypto.randomUUID();
    let requestId: string | undefined;
    busyRef.current.set(requestSlot, requestToken);
    setSendingSlots((old) => ({ ...old, [requestSlot]: requestToken }));
    setError(undefined);
    setNotice(undefined);
    try {
      const id = retry?.conversationId ?? (await ensureConversation());
      requestId = id;
      busyRef.current.set(id, requestToken);
      setSendingSlots((old) => ({ ...old, [id]: requestToken }));
      const current = await utils.baam.conversation.fetch({ id });
      const request: BaamSend = retry ?? {
        conversationId: id,
        clientRequestId: crypto.randomUUID(),
        text: text.trim(),
        locale,
        revision: current.conversation.revision,
        page: {
          path: pathname,
          ...(searchParams.get("registerId")
            ? { registerId: searchParams.get("registerId")! }
            : {}),
        },
        attachmentIds: attachments.map((a) => a.id),
        ...(voiceId ? { transcriptionId: voiceId } : {}),
      };
      if (identityRef.current === id) {
        setPendingRequest(request);
        setOptimistic({ text: request.text, conversationId: id });
        setQuestion("");
        setAttachments([]);
        setVoiceId(undefined);
        setVoiceBlob(undefined);
        nearBottom.current = true;
      }
      const outboxKey = `baam-draft:${identity.organizationId}:${identity.userId}:${id}`;
      try {
        sessionStorage.setItem(outboxKey, JSON.stringify({ pending: request, at: Date.now() }));
      } catch {
        /* optional */
      }
      const promise = send.mutateAsync(request);
      setTimeout(() => {
        void utils.baam.conversation.invalidate({ id });
      }, 300);
      await promise;
      try {
        const saved = JSON.parse(sessionStorage.getItem(outboxKey) ?? "null");
        if (saved?.pending?.clientRequestId === request.clientRequestId)
          sessionStorage.setItem(outboxKey, JSON.stringify({ ...saved, pending: undefined }));
      } catch {
        /* optional */
      }
      if (identityRef.current === id && busyRef.current.get(id) === requestToken)
        setPendingRequest(undefined);
      await refresh(id);
      if (identityRef.current === id) inputRef.current?.focus({ preventScroll: true });
    } catch (e) {
      if (
        (identityRef.current === requestId &&
          busyRef.current.get(requestId ?? "") === requestToken) ||
        (slotRef.current === requestSlot && busyRef.current.get(requestSlot) === requestToken)
      )
        setError(readableError(e));
    } finally {
      for (const key of [requestSlot, requestId])
        if (key && busyRef.current.get(key) === requestToken) busyRef.current.delete(key);
      setSendingSlots((old) =>
        Object.fromEntries(Object.entries(old).filter(([, token]) => token !== requestToken)),
      );
    }
  };
  const upload = async (file: Blob, kind: "audio" | "image", name: string) => {
    if (mediaPending) return;
    const originalSlot = slotRef.current;
    let uploadId: string | undefined;
    setUploadSlot(originalSlot);
    setMediaKind(kind);
    setError(undefined);
    try {
      const id = await ensureConversation();
      uploadId = id;
      if (identityRef.current === id) setUploadSlot(id);
      const form = new FormData();
      form.append("conversationId", id);
      form.append("locale", locale);
      form.append("kind", kind);
      form.append("file", file, name);
      const response = await fetch("/api/baam/media", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(115000),
      });
      const result = (await response.json()) as {
        id: string;
        text?: string;
        url?: string;
        name?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(result.message ?? "network");
      if (identityRef.current !== id) return;
      if (kind === "audio") {
        setQuestion((previous) => `${previous}${previous ? "\n" : ""}${result.text ?? ""}`);
        setVoiceId(result.id);
        setVoiceBlob(undefined);
        inputRef.current?.focus();
      } else if (result.url)
        setAttachments((previous) => [
          ...previous,
          { id: result.id, url: result.url!, name: result.name ?? name },
        ]);
    } catch (e) {
      if (identityRef.current === uploadId || slotRef.current === originalSlot) {
        if (kind === "audio") setVoiceBlob(file);
        setError(readableError(e));
      }
    } finally {
      setUploadSlot((old) => (old === originalSlot || old === uploadId ? undefined : old));
    }
  };
  const voice = useBaamVoice(
    async (blob) => {
      setVoiceBlob(blob);
      await upload(blob, "audio", blob.type.includes("mp4") ? "voice.mp4" : "voice.webm");
    },
    (code) => setError(readableError(code)),
  );
  const newConversation = () => {
    voice.stop(true);
    identity.setActiveId(null);
    identityRef.current = null;
    slotRef.current = `new-${newIndex + 1}`;
    setNewIndex((i) => i + 1);
    setDraftStore(pageStore());
    setQuestion("");
    setAttachments([]);
    setVoiceId(undefined);
    setVoiceBlob(undefined);
    setPendingRequest(undefined);
    setOptimistic(undefined);
    try {
      sessionStorage.removeItem(`baam-draft:${identity.organizationId}:${identity.userId}:new`);
    } catch {
      /* optional */
    }
    setShowHistory(false);
    setRename(undefined);
    setError(undefined);
  };
  const runAction = async (id: string) => {
    if (executing || busyRef.current.has(slot) || !identity.activeId) return;
    const conversationId = identity.activeId;
    setExecutions((old) => ({ ...old, [conversationId]: id }));
    setError(undefined);
    try {
      await execute.mutateAsync({ actionId: id });
      await utils.invalidate();
    } catch (e) {
      if (identityRef.current === conversationId) setError(readableError(e));
    } finally {
      setExecutions((old) => {
        const next = { ...old };
        if (next[conversationId] === id) delete next[conversationId];
        return next;
      });
      await refresh(conversationId);
    }
  };
  const cancelAction = async (actionId: string) => {
    try {
      await cancel.mutateAsync({ actionId });
      if (identity.activeId) await refresh(identity.activeId);
    } catch (e) {
      setError(readableError(e));
    }
  };
  const changeStore = async (storeId: string) => {
    setDraftStore(storeId);
    if (!data) return;
    try {
      await change.mutateAsync({
        id: data.conversation.id,
        revision: data.conversation.revision,
        storeId: storeId || null,
      });
      await refresh(data.conversation.id);
      setNotice(t("storeChanged"));
    } catch (e) {
      setError(readableError(e));
    }
  };
  const renameConversation = async () => {
    if (!data || !rename?.trim()) return;
    try {
      await change.mutateAsync({
        id: data.conversation.id,
        revision: data.conversation.revision,
        title: rename,
      });
      setRename(undefined);
      await refresh(data.conversation.id);
    } catch (e) {
      setError(readableError(e));
    }
  };
  const removeConversation = async () => {
    if (!data) return;
    try {
      await change.mutateAsync({
        id: data.conversation.id,
        revision: data.conversation.revision,
        remove: true,
      });
      newConversation();
      await utils.baam.conversations.invalidate();
    } catch (e) {
      setError(readableError(e));
    }
  };
  const stopResponse = async () => {
    if (identity.activeId) {
      try {
        const id = identity.activeId;
        const token = busyRef.current.get(id);
        await stop.mutateAsync({ conversationId: id });
        if (token) {
          for (const [key, value] of busyRef.current)
            if (value === token) busyRef.current.delete(key);
          setSendingSlots((old) =>
            Object.fromEntries(Object.entries(old).filter(([, value]) => value !== token)),
          );
        }
        if (identityRef.current === id) setPendingRequest(undefined);
        await refresh(id);
      } catch (e) {
        setError(readableError(e));
      }
    }
  };
  const loadOlder = async () => {
    if (!data || !scrollRef.current) return;
    const height = scrollRef.current.scrollHeight,
      top = scrollRef.current.scrollTop;
    setLoadingMore(true);
    try {
      const page = await utils.baam.conversation.fetch({
        id: data.conversation.id,
        before: olderCursor ?? data.next ?? undefined,
      });
      setOlder((old) => [...page.messages, ...old]);
      setOlderActions((old) => [...old, ...page.actions]);
      setOlderCursor(page.next);
      requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = top + scrollRef.current.scrollHeight - height;
      });
    } finally {
      setLoadingMore(false);
    }
  };
  return {
    identity,
    locale,
    t,
    pathname,
    showHistory,
    setShowHistory,
    question,
    setQuestion,
    error:
      error ??
      (conversation.error || capabilities.error
        ? readableError(conversation.error ?? capabilities.error)
        : undefined),
    notice,
    rename,
    setRename,
    unread,
    setUnread,
    mediaPending,
    mediaKind,
    attachments,
    setAttachments,
    voiceId,
    voiceBlob,
    pendingRequest,
    optimistic,
    executing,
    draftStore,
    inputRef,
    scrollRef,
    nearBottom,
    capabilities,
    data,
    allowed,
    available,
    busy,
    messages,
    actions,
    readableError,
    bottom,
    ask,
    upload,
    voice,
    newConversation,
    runAction,
    cancelAction,
    changeStore,
    renameConversation,
    removeConversation,
    stopResponse,
    loadOlder,
    loadingMore,
    hasOlder: olderCursor === undefined ? data?.next : olderCursor,
    changing: change.isLoading,
    fetching: conversation.isFetching,
  };
}
export type BaamController = ReturnType<typeof useBaamCompanion>;
