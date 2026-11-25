"use client";
import { uploadBaamImage } from "@/lib/baam/mediaClient";
import type { WorkflowCommand } from "@/lib/baam/workflows";
import { flushBaamWorkflowForms } from "@/lib/baam/workflowFlush";
import { useEffect, useMemo, useRef, useState } from "react";
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
type EarlierMessages = Pick<BaamData, "messages" | "actions" | "workflows" | "next"> & {
  conversationId: string;
  revision: number;
};

const clearStoredRequest = (key: string, requestId: string) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved?.pending?.clientRequestId === requestId)
      sessionStorage.setItem(key, JSON.stringify({ ...saved, pending: undefined }));
  } catch {
    /* Draft persistence is optional. */
  }
};

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
  const [older, setOlder] = useState<EarlierMessages>();
  const [olderError, setOlderError] = useState<string>();
  const loadingEarlier = useRef<symbol | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rename, setRename] = useState<string>();
  const [unread, setUnread] = useState(false);
  const [newIndex, setNewIndex] = useState(0);
  const slot = identity.activeId ?? `new-${newIndex}`;
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const [uploadSlot, setUploadSlot] = useState<string>();
  const mediaPending = uploadSlot === slot;
  const [imageRetry, setImageRetry] = useState<File>();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mediaKind, setMediaKind] = useState<"audio" | "image">("audio");
  const [attachments, setAttachments] = useState<Array<{ id: string; url: string; name: string }>>(
    [],
  );
  const [voiceId, setVoiceId] = useState<string>();
  const [voiceBlob, setVoiceBlob] = useState<Blob>();
  const [pendingRequest, setPendingRequest] = useState<BaamSend>();
  const [optimistic, setOptimistic] = useState<BaamSend>();
  const [stoppingId, setStoppingId] = useState<string>();
  const [executions, setExecutions] = useState<Record<string, string>>({});
  const executing = executions[slot];
  const [sendingSlots, setSendingSlots] = useState<Record<string, string>>({});
  const [draftStore, setDraftStore] = useState("");
  const draftPrefix = `baam-draft:${identity.organizationId}:${identity.userId}:`;
  const draftKey = draftPrefix + (identity.activeId ?? "new");
  const [draftReady, setDraftReady] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef(question);
  questionRef.current = question;
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const busyRef = useRef(new Map<string, string>());
  const createdLocally = useRef<string | undefined>(undefined);
  const identityRef = useRef(identity.activeId);
  identityRef.current = identity.activeId;
  const create = trpc.baam.createConversation.useMutation();
  const change = trpc.baam.changeConversation.useMutation();
  const send = trpc.baam.send.useMutation({ networkMode: "always" });
  const stop = trpc.baam.stop.useMutation({ networkMode: "always" });
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
        sendingSlots[slot] && !data?.activeTurn
          ? 1000
          : data?.activeTurn ||
              data?.actions.some((a) => a.status === "RUNNING") ||
              data?.workflows.some((w) => w.status === "RUNNING")
            ? 5000
            : 30000,
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
      capabilities.data?.stores.some((s) => s.id === raw.conversation.storeId)) &&
    raw.conversation.scopeStoreIds.every((id) => capabilities.data?.stores.some((store) => store.id === id))
      ? raw
      : undefined;
  const available = allowed && (!identity.activeId || Boolean(data));
  const sending = Boolean(sendingSlots[slot]);
  const stopping = stoppingId === identity.activeId;
  const runningAction =
    Boolean(data?.workflows.some((w) => w.status === "RUNNING" || w.pendingRequestId)) ||
    Boolean(executing) ||
    Boolean(data?.actions.some((a) => a.status === "RUNNING" && !a.canRecover));
  const busy =
    sending || stopping || Boolean(data?.activeTurn) || runningAction;
  const progress: BaamCopyKey | undefined = stopping ? "stopping"
    : runningAction ? "running"
    : data?.activeTurn ? "thinking"
    : sending ? "sending" : undefined;
  const earlier = data && older?.conversationId === data.conversation.id &&
    older.revision === data.conversation.revision ? older : undefined;
  const messages = useMemo(() => [
    ...new Map([...(earlier?.messages ?? []), ...(data?.messages ?? [])].map((m) => [m.id, m])).values(),
  ].sort((a, b) => a.sequence - b.sequence), [data?.messages, earlier?.messages]);
  const actions = useMemo(() => [
    ...new Map([...(earlier?.actions ?? []), ...(data?.actions ?? [])].map((a) => [a.id, a])).values(),
  ], [data?.actions, earlier?.actions]);
  const workflows = useMemo(() => [
    ...new Map([...(earlier?.workflows ?? []), ...(data?.workflows ?? [])].map((w) => [w.id, w])).values(),
  ], [data?.workflows, earlier?.workflows]);
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
    if (createdLocally.current && createdLocally.current === identity.activeId) {
      return;
    }
    loadingEarlier.current = undefined;
    setOlder(undefined);
    setOlderError(undefined);
    setLoadingMore(false);
    setQuestion("");
    setAttachments([]);
    setImageRetry(undefined);
    setUploadProgress(0);
    setVoiceId(undefined);
    setVoiceBlob(undefined);
    setError(undefined);
    setNotice(undefined);
    setPendingRequest(undefined);
    setOptimistic(undefined);
    nearBottom.current = true;
  }, [identity.activeId]);
  useEffect(() => {
    // Creating the first server conversation promotes the current composer.
    // Its outbox may already have replaced the copied draft before this effect
    // runs; reading it back would discard text typed while the send is pending.
    if (createdLocally.current && createdLocally.current === identity.activeId) {
      createdLocally.current = undefined;
      setDraftReady(draftKey);
      return;
    }
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
  }, [draftKey, locale, identity.activeId]);
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
    if (nearBottom.current) {
      const form = scrollRef.current?.querySelector<HTMLElement>(
        `[data-baam-workflow="${data?.conversation.activeWorkflowId ?? ""}"]`,
      );
      if (form && scrollRef.current) {
        scrollRef.current.scrollTop +=
          form.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 16;
      } else bottom();
    } else setUnread(true);
  }, [lastMessageId, data?.activeTurn?.id, data?.conversation.activeWorkflowId, optimistic]);
  useEffect(() => {
    if (
      optimistic &&
      data?.activeTurn?.clientRequestId === optimistic.clientRequestId &&
      data.messages.some((message) => message.role === "user" && message.turnId === data.activeTurn?.id)
    )
      setOptimistic(undefined);
  }, [data?.activeTurn, data?.messages, optimistic]);
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
  const ensureConversation = async (): Promise<{ id: string; revision?: number }> => {
    if (identityRef.current) return { id: identityRef.current };
    const originalSlot = slotRef.current;
    const storeId = draftStore || pageStore();
    const created = await create.mutateAsync({ locale, ...(storeId ? { storeId } : {}) });
    if (slotRef.current === originalSlot) {
      createdLocally.current = created.id;
      try {
        const source = sessionStorage.getItem(
          draftPrefix + "new",
        );
        if (source)
          sessionStorage.setItem(
            draftPrefix + created.id,
            source,
          );
      } catch {
        /* optional */
      }
      identityRef.current = created.id;
      slotRef.current = created.id;
      identity.setActiveId(created.id);
    }
    return { id: created.id, revision: created.revision };
  };
  const refresh = async (id: string) => {
    await Promise.all([
      utils.baam.conversation.invalidate({ id }),
      utils.baam.conversations.invalidate(),
    ]);
  };
  const ask = async (
    text = question,
    retry?: BaamSend,
    command?: WorkflowCommand,
    voice?: { id: string; conversationId: string },
  ) => {
    if (voice && identityRef.current !== voice.conversationId) return;
    if ((!text.trim() && !retry) || busyRef.current.has(slot) || busy || !available) return;
    const requestSlot = slotRef.current;
    const requestToken = crypto.randomUUID();
    let requestId: string | undefined;
    busyRef.current.set(requestSlot, requestToken);
    setSendingSlots((old) => ({ ...old, [requestSlot]: requestToken }));
    setError(undefined);
    setNotice(undefined);
    try {
      const { id, revision } = retry
        ? { id: retry.conversationId, revision: undefined }
        : await ensureConversation();
      requestId = id;
      busyRef.current.set(id, requestToken);
      setSendingSlots((old) => ({ ...old, [id]: requestToken }));
      // A fresh dialog cannot contain an unsaved workflow. Its create response already
      // carries the verified revision, so it does not need a chat read before sending.
      if (!retry && revision === undefined) await flushBaamWorkflowForms(id);
      const request: BaamSend = retry ?? {
        ...(command ? { command } : {}),
        conversationId: id,
        clientRequestId: crypto.randomUUID(),
        text: text.trim(),
        locale,
        revision: revision ?? (utils.baam.conversation.getData({ id }) ??
          (await utils.baam.conversation.fetch({ id }))).conversation.revision,
        page: {
          path: pathname,
          ...(searchParams.get("registerId")
            ? { registerId: searchParams.get("registerId")! }
            : {}),
        },
        attachmentIds: attachments.map((a) => a.id),
        ...(voice?.id || voiceId ? { transcriptionId: voice?.id ?? voiceId } : {}),
      };
      if (identityRef.current === id) {
        setPendingRequest(request);
        setOptimistic(request);
        if (!retry) {
          setQuestion((current) => current.trim() === request.text ? "" : current);
          setAttachments((current) => current.filter((attachment) => !request.attachmentIds.includes(attachment.id)));
          setVoiceId(undefined);
          setVoiceBlob(undefined);
        }
        nearBottom.current = true;
      }
      const outboxKey = draftPrefix + id;
      try {
        const saved = JSON.parse(sessionStorage.getItem(outboxKey) ?? "null");
        sessionStorage.setItem(outboxKey, JSON.stringify({ ...saved, pending: request, at: Date.now() }));
      } catch {
        /* optional */
      }
      const response = await send.mutateAsync(request);
      clearStoredRequest(outboxKey, request.clientRequestId);
      if (busyRef.current.get(id) !== requestToken) {
        void utils.baam.conversation.invalidate({ id });
        return;
      }
      utils.baam.conversation.setData({ id }, response.data);
      if (identityRef.current === id) {
        setPendingRequest(undefined);
        setOptimistic(undefined);
      }
      void utils.baam.conversations.invalidate();
      if (identityRef.current === id)
        requestAnimationFrame(() => {
          const form = scrollRef.current?.querySelector<HTMLElement>(
            `[data-baam-workflow="${response.data.conversation.activeWorkflowId ?? ""}"]`,
          );
          if (form && scrollRef.current) {
            scrollRef.current.scrollTop +=
              form.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 16;
            form
              .querySelector<HTMLElement>("input:not([type=file]),button[role=combobox]")
              ?.focus({ preventScroll: true });
          } else inputRef.current?.focus({ preventScroll: true });
        });
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
  // The transcription resolves after React has rendered a new conversation or
  // scope. Always submit through the current controller, never a stale closure.
  const askRef = useRef(ask);
  askRef.current = ask;
  const upload = async (file: Blob, kind: "audio" | "image", name: string) => {
    if (mediaPending) return;
    const originalSlot = slotRef.current;
    let uploadId: string | undefined;
    setUploadSlot(originalSlot);
    setMediaKind(kind);
    setError(undefined);
    try {
      const { id, revision } = await ensureConversation();
      const originalRevision =
        kind === "audio"
          ? revision ?? (await utils.baam.conversation.fetch({ id })).conversation.revision
          : undefined;
      uploadId = id;
      if (identityRef.current === id) setUploadSlot(id);
      if (kind === "image") {
        const image = await uploadBaamImage(
          file instanceof File ? file : new File([file], name, { type: file.type }),
          id,
          locale,
          setUploadProgress,
        );
        if (identityRef.current === id) {
          setAttachments((old) => [...old.filter((a) => a.id !== image.id), image]);
          setImageRetry(undefined);
        }
        return image;
      }
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
        const text = [questionRef.current.trim(), result.text?.trim()].filter(Boolean).join("\n");
        setQuestion(text);
        setVoiceId(result.id);
        setVoiceBlob(undefined);
        const current = await utils.baam.conversation.fetch({ id });
        if (identityRef.current !== id) return;
        setUploadSlot((old) => (old === id || old === originalSlot ? undefined : old));
        if (current.conversation.revision === originalRevision && text.trim()) {
          await askRef.current(text, undefined, undefined, { id: result.id, conversationId: id });
        } else {
          setVoiceId(undefined);
          setNotice(t("voiceScopeChanged"));
          inputRef.current?.focus();
        }
      } else if (result.url)
        setAttachments((previous) => [
          ...previous,
          { id: result.id, url: result.url!, name: result.name ?? name },
        ]);
    } catch (e) {
      if (identityRef.current === uploadId || slotRef.current === originalSlot) {
        if (kind === "audio") setVoiceBlob(file);
        else
          setImageRetry(file instanceof File ? file : new File([file], name, { type: file.type }));
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
    const id = identity.activeId;
    const turn = data?.activeTurn;
    if (!id || !turn || stopping) return;
    setStoppingId(id);
    setError(undefined);
    try {
      const result = await stop.mutateAsync({ conversationId: id, turnId: turn.id });
      if (result.stopped) {
        clearStoredRequest(draftPrefix + id, turn.clientRequestId);
        if (identityRef.current === id) {
          setPendingRequest((current) => current?.clientRequestId === turn.clientRequestId ? undefined : current);
          setOptimistic((current) => current?.clientRequestId === turn.clientRequestId ? undefined : current);
        }
        const token = busyRef.current.get(id);
        if (token && pendingRequest?.clientRequestId === turn.clientRequestId) {
          for (const [key, value] of busyRef.current)
            if (value === token) busyRef.current.delete(key);
          setSendingSlots((old) =>
            Object.fromEntries(Object.entries(old).filter(([, value]) => value !== token)),
          );
        }
      }
      await refresh(id);
    } catch (e) {
      if (identityRef.current === id) setError(readableError(e));
    } finally {
      setStoppingId((current) => current === id ? undefined : current);
    }
  };
  const olderCursor = earlier ? earlier.next : data?.next;
  const loadOlder = async () => {
    const element = scrollRef.current;
    if (!data || !element || !olderCursor || loadingEarlier.current) return;
    const { id, revision } = data.conversation;
    const token = Symbol();
    loadingEarlier.current = token;
    const height = element.scrollHeight;
    const top = element.scrollTop;
    setLoadingMore(true);
    setOlderError(undefined);
    try {
      const page = await utils.baam.conversation.fetch({ id, before: olderCursor });
      if (identityRef.current !== id || loadingEarlier.current !== token ||
        page.conversation.revision !== revision) return;
      setOlder({
        conversationId: id,
        revision,
        messages: [...page.messages, ...(earlier?.messages ?? [])],
        actions: [...(earlier?.actions ?? []), ...page.actions],
        workflows: [...(earlier?.workflows ?? []), ...page.workflows],
        next: page.next,
      });
      requestAnimationFrame(() => {
        if (scrollRef.current === element && identityRef.current === id)
          element.scrollTop = top + element.scrollHeight - height;
      });
    } catch (e) {
      if (identityRef.current === id && loadingEarlier.current === token) setOlderError(readableError(e));
    } finally {
      if (loadingEarlier.current === token) {
        loadingEarlier.current = undefined;
        setLoadingMore(false);
      }
    }
  };
  const loadError = conversation.error ?? capabilities.error;
  const retryLoad = async () => {
    setError(undefined);
    await Promise.all([
      capabilities.refetch(),
      ...(identity.activeId ? [conversation.refetch()] : []),
    ]);
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
    error: error ?? (loadError ? readableError(loadError) : undefined),
    loadError: Boolean(loadError),
    retryLoad,
    notice,
    rename,
    setRename,
    unread,
    setUnread,
    mediaPending,
    mediaKind,
    imageRetry,
    setImageRetry,
    uploadProgress,
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
    progress,
    stopping,
    messages,
    actions,
    workflows,
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
    olderError,
    hasOlder: olderCursor,
    changing: change.isLoading,
    fetching: conversation.isFetching || capabilities.isFetching,
  };
}
export type BaamController = ReturnType<typeof useBaamCompanion>;
