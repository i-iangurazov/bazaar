"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { BaamAssistantPanel, type BaamConversationEntry, type BaamAssistantPanelProps } from "@/components/baam-assistant-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/i18nFormat";
import { normalizeLocale } from "@/lib/locales";
import { hasPermission } from "@/lib/roleAccess";
import { addBusinessDays, businessDateKey } from "@/lib/timezone";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";

type AssistantContextValue = { status: "loading" } | { status: "forbidden" } | {
  status: "ready";
  activate: () => void;
  panel: Omit<BaamAssistantPanelProps, "compact">;
};
const AssistantContext = createContext<AssistantContextValue | null>(null);

/** RAM only. This owner survives drawer/page navigation and is discarded with the authenticated layout. */
export function BaamAssistantProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  if (status === "loading") return <AssistantContext.Provider value={{ status: "loading" }}>{children}</AssistantContext.Provider>;
  if (status !== "authenticated" || !session?.user.id || !session.user.organizationId ||
      !hasPermission({ role: session.user.role }, "viewReports")) {
    return <AssistantContext.Provider value={{ status: "forbidden" }}>{children}</AssistantContext.Provider>;
  }
  return <AuthorizedBaamAssistantProvider
    key={`${session.user.id}:${session.user.organizationId}`}
    actorId={session.user.id} organizationId={session.user.organizationId}
  >{children}</AuthorizedBaamAssistantProvider>;
}

export function BaamAssistant({ compact = false }: { compact?: boolean }) {
  const context = useContext(AssistantContext);
  const t = useTranslations("baam");
  const tErrors = useTranslations("errors");
  const activate = context?.status === "ready" ? context.activate : undefined;
  useEffect(() => activate?.(), [activate]);
  if (!context) return <BaamAssistantProvider><BaamAssistant compact={compact} /></BaamAssistantProvider>;
  if (context.status === "loading") return <div role="status" className="flex min-h-64 items-center justify-center gap-2"><Spinner />{t("loading")}</div>;
  if (context.status === "forbidden") {
    return <div role="alert" className="rounded-xl border p-6">{tErrors("forbidden")}</div>;
  }
  return <BaamAssistantPanel {...context.panel} compact={compact} />;
}

function AuthorizedBaamAssistantProvider({ actorId, organizationId, children }: {
  actorId: string; organizationId: string; children: ReactNode;
}) {
  const t = useTranslations("baam");
  const tAssistant = useTranslations("baam.assistant");
  const tErrors = useTranslations("errors");
  const locale = normalizeLocale(useLocale()) ?? "ru";
  const scopeId = useId();
  const initial = useMemo(() => {
    const today = businessDateKey(new Date());
    return { dateFrom: addBusinessDays(today, -6), dateTo: today, storeId: undefined as string | undefined };
  }, []);
  const [scope, setScope] = useState(initial);
  const [activated, setActivated] = useState(false);
  const activatedRef = useRef(false);
  const refreshAccessRef = useRef<() => void>(() => undefined);
  const activate = useMemo(() => () => {
    if (activatedRef.current) refreshAccessRef.current();
    activatedRef.current = true;
    setActivated(true);
  }, []);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [entries, setEntries] = useState<BaamConversationEntry[]>([]);
  const [conversationAccessKey, setConversationAccessKey] = useState<string>();
  const [error, setError] = useState<string>();
  const pendingRef = useRef(false);
  const accessEpoch = useRef(0);
  const capabilities = trpc.baam.capabilities.useQuery(undefined, {
    enabled: activated, retry: false, staleTime: 0, cacheTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const capabilitiesMatch = capabilities.data?.audience.actorId === actorId &&
    capabilities.data?.audience.organizationId === organizationId;
  const configured = capabilitiesMatch && capabilities.data?.available === true;
  // Reuse the existing reporting access boundary for the authorized store picker.
  // Its metric totals are not rendered as another dashboard.
  const overview = trpc.baam.overview.useQuery(initial, {
    enabled: activated && configured, retry: false, staleTime: 0, cacheTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const overviewMatch = overview.data?.audience.actorId === actorId &&
    overview.data?.scope.organizationId === organizationId;
  const scopeReady = overviewMatch && !overview.error && !overview.isFetching;
  const stores = scopeReady ? overview.data?.scope.availableStores ?? [] : [];
  const currentAccessKey = scopeReady ? JSON.stringify(stores.map(store => store.id).sort()) : undefined;
  const previousAccessKey = useRef<string>();
  const selectedStoreAvailable = !scope.storeId || stores.some(store => store.id === scope.storeId);
  const mutation = trpc.baam.ask.useMutation();
  const available = activated && configured && !capabilities.error && !capabilities.isFetching && scopeReady && selectedStoreAvailable;
  const queryError = capabilities.error ?? (configured ? overview.error : null);
  refreshAccessRef.current = () => {
    void capabilities.refetch();
    if (configured) void overview.refetch();
  };
  const permissionFailed = queryError?.data?.code === "FORBIDDEN" || queryError?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    const accessChanged = currentAccessKey !== undefined && previousAccessKey.current !== undefined &&
      currentAccessKey !== previousAccessKey.current;
    if (accessChanged || permissionFailed) {
      accessEpoch.current += 1;
      setEntries([]);
      setQuestion("");
      setError(undefined);
      setConversationAccessKey(undefined);
    }
    if (currentAccessKey !== undefined) previousAccessKey.current = currentAccessKey;
  }, [currentAccessKey, permissionFailed]);

  const ask = async (question: string) => {
    if (!available || pendingRef.current) return;
    if (!scope.dateFrom || !scope.dateTo || scope.dateFrom > scope.dateTo) {
      setError(tErrors("invalidInput"));
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const requestAccessEpoch = accessEpoch.current;
    setError(undefined);
    try {
      const response = await mutation.mutateAsync({ question, ...scope, locale });
      if (requestAccessEpoch !== accessEpoch.current) return;
      if (response.audience.actorId !== actorId || response.audience.organizationId !== organizationId) {
        setEntries([]);
        setError(tErrors("forbidden"));
        return;
      }
      setEntries(current => [...(conversationAccessKey === currentAccessKey ? current : []), {
        id: crypto.randomUUID(), question, answer: response.answer, followUps: response.followUps,
        evidence: {
          summary: tAssistant("evidence"),
          details: [
            t("appliedScope", {
              from: response.evidence.period.dateFrom, to: response.evidence.period.dateTo,
              stores: response.evidence.storeNames.join(", ") || t("noStoresShort"),
            }),
            tAssistant("comparisonPeriod", { from: response.evidence.comparisonPeriod.dateFrom, to: response.evidence.comparisonPeriod.dateTo }),
            tAssistant("currentSnapshotAt", { time: formatDateTime(response.evidence.currentQueriedAt, locale) }),
            tAssistant("previousSnapshotAt", { time: formatDateTime(response.evidence.previousQueriedAt, locale) }),
            t("version", { version: response.evidence.metricVersion }),
            t("completeness"),
          ],
        },
        // Analytics owns its filters locally; do not imply a filtered deep link.
        links: [{ label: tAssistant("openAnalytics"), href: "/reports/analytics" }],
      }]);
      setConversationAccessKey(currentAccessKey);
    } catch (cause) {
      const failure = cause as NonNullable<Parameters<typeof translateError>[1]>;
      if (requestAccessEpoch !== accessEpoch.current) return;
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(failure.data?.code ?? "") || failure.message === "baamScopeChanged") {
        setEntries([]);
        setQuestion("");
        accessEpoch.current += 1;
      }
      setError(translateError(tErrors, failure));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const availabilityLabel = queryError ? tAssistant("unavailable") : capabilities.isFetching || !capabilitiesMatch || (configured && !scopeReady)
    ? tAssistant("checkingAvailability")
    : configured ? tAssistant("aiAvailability") : tErrors("baamNotConfigured");
  // A failed permission refresh must not retain previous protected answers.
  const visibleEntries = activated && configured && capabilitiesMatch && !capabilities.error && !capabilities.isFetching &&
    scopeReady && conversationAccessKey === currentAccessKey ? entries : [];

  const panel: Omit<BaamAssistantPanelProps, "compact"> = {
    entries: visibleEntries, onAsk: question => void ask(question), pending,
    question, onQuestionChange: setQuestion,
    available, availabilityLabel,
    error: queryError ? translateError(tErrors, queryError) : error,
    onRetryAvailability: queryError ? () => refreshAccessRef.current() : undefined,
    scopeControls: <details className="text-xs">
      <summary className="cursor-pointer break-words font-medium text-foreground">
        {tAssistant("scope")} · {scope.dateFrom} — {scope.dateTo} · {scope.storeId
          ? stores.find(store => store.id === scope.storeId)?.name ?? tAssistant("selectedStoreUnavailable")
          : t("allStores")}
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label htmlFor={`${scopeId}-from`} className="space-y-1"><span>{t("dateFrom")}</span>
          <Input id={`${scopeId}-from`} type="date" value={scope.dateFrom} disabled={pending}
            onChange={event => setScope(current => ({ ...current, dateFrom: event.target.value }))} className="min-w-0 text-xs" />
        </label>
        <label htmlFor={`${scopeId}-to`} className="space-y-1"><span>{t("dateTo")}</span>
          <Input id={`${scopeId}-to`} type="date" value={scope.dateTo} disabled={pending}
            onChange={event => setScope(current => ({ ...current, dateTo: event.target.value }))} className="min-w-0 text-xs" />
        </label>
        <label htmlFor={`${scopeId}-store`} className="col-span-2 min-w-0 space-y-1"><span>{t("store")}</span>
          <select id={`${scopeId}-store`} value={scope.storeId ?? ""} disabled={!scopeReady || pending}
            onChange={event => setScope(current => ({ ...current, storeId: event.target.value || undefined }))}
            className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">{t("allStores")}</option>
            {scope.storeId && !selectedStoreAvailable ? <option value={scope.storeId} disabled>{tAssistant("selectedStoreUnavailable")}</option> : null}
            {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        {entries.length ? <Button variant="ghost" size="sm" className="col-span-2" disabled={pending}
          onClick={() => { setEntries([]); setQuestion(""); setError(undefined); }}>{tAssistant("newConversation")}</Button> : null}
      </div>
    </details>,
  };
  return <AssistantContext.Provider value={{ status: "ready", activate, panel }}>{children}</AssistantContext.Provider>;
}
