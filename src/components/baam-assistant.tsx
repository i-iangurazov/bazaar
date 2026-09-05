"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { BaamAssistantPanel, type BaamConversationEntry, type BaamAssistantPanelProps } from "@/components/baam-assistant-panel";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/i18nFormat";
import { normalizeLocale } from "@/lib/locales";
import { hasPermission } from "@/lib/roleAccess";
import { baamDatePresets, baamPresetRange, type BaamDatePreset } from "@/lib/baamDatePresets";
import { baamPageLabelKey, baamStarterKeys, getBaamUiPageContext } from "@/lib/baamSuggestions";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";

type AssistantContextValue = { status: "loading" } | { status: "forbidden" } | {
  status: "ready";
  activate: () => void;
  panel: Omit<BaamAssistantPanelProps, "compact">;
};
const AssistantContext = createContext<AssistantContextValue | null>(null);

// NextAuth's union types loading as null data, but SessionProvider.update()
// retains its existing Session while setting loading=true. Represent that runtime state.
type RuntimeSessionState = {
  data: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
};

/** RAM only. This owner survives drawer/page navigation and is discarded with the authenticated layout. */
export function BaamAssistantProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession() as RuntimeSessionState;
  // Session.update() briefly reports loading while retaining the current identity.
  // Keep that identity's RAM owner mounted, but conceal it until revalidation ends.
  if (status === "loading" && (!session?.user.id || !session.user.organizationId)) {
    return <AssistantContext.Provider value={{ status: "loading" }}>{children}</AssistantContext.Provider>;
  }
  if ((status !== "authenticated" && status !== "loading") || !session?.user.id || !session.user.organizationId ||
      !hasPermission({ role: session.user.role }, "viewReports")) {
    return <AssistantContext.Provider value={{ status: "forbidden" }}>{children}</AssistantContext.Provider>;
  }
  return <AuthorizedBaamAssistantProvider
    key={`${session.user.id}:${session.user.organizationId}`}
    actorId={session.user.id} organizationId={session.user.organizationId}
    sessionRevalidating={status === "loading"}
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

function AuthorizedBaamAssistantProvider({ actorId, organizationId, sessionRevalidating, children }: {
  actorId: string; organizationId: string; sessionRevalidating: boolean; children: ReactNode;
}) {
  const t = useTranslations("baam");
  const tAssistant = useTranslations("baam.assistant");
  const tErrors = useTranslations("errors");
  const locale = normalizeLocale(useLocale()) ?? "ru";
  const pathname = usePathname();
  const pageContext = useMemo(() => getBaamUiPageContext(pathname), [pathname]);
  const scopeId = useId();
  const initial = useMemo(() => ({ ...baamPresetRange("last7"), storeId: undefined as string | undefined }), []);
  const [scope, setScope] = useState(initial);
  const [contextToken, setContextToken] = useState<string>();
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
    enabled: activated && !sessionRevalidating, retry: false, staleTime: 0, cacheTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const capabilitiesMatch = capabilities.data?.audience.actorId === actorId &&
    capabilities.data?.audience.organizationId === organizationId;
  const configured = capabilitiesMatch && capabilities.data?.available === true;
  // Reuse the existing reporting access boundary for the authorized store picker.
  // Its metric totals are not rendered as another dashboard.
  const overview = trpc.baam.overview.useQuery(initial, {
    enabled: activated && configured && !sessionRevalidating, retry: false, staleTime: 0, cacheTime: 0,
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
  const available = !sessionRevalidating && activated && configured && !capabilities.error && !capabilities.isFetching && scopeReady && selectedStoreAvailable;
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
      setContextToken(undefined);
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
      const response = await mutation.mutateAsync({ question, ...scope, locale, pageContext, ...(contextToken ? { contextToken } : {}) });
      if (requestAccessEpoch !== accessEpoch.current) return;
      if (response.audience.actorId !== actorId || response.audience.organizationId !== organizationId) {
        setEntries([]);
        setContextToken(undefined);
        setError(tErrors("forbidden"));
        return;
      }
      setEntries(current => [...(conversationAccessKey === currentAccessKey ? current : []), {
        id: crypto.randomUUID(), question, answer: response.answer, followUps: response.followUps,
        status: response.status, scope: response.evidence || response.productEvidence?.appliedPeriod || response.status === "clarification" ? response.scope : undefined,
        products: response.products, productEvidence: response.productEvidence ?? undefined,
        evidence: response.evidence ? {
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
        } : undefined,
        links: [
          ...(response.analyticsHref ? [{ label: tAssistant("openAnalytics"), href: response.analyticsHref }] : []),
          ...(response.actions ?? []).filter(action => action.href !== response.analyticsHref),
        ],
      }]);
      setConversationAccessKey(currentAccessKey);
      setContextToken(response.contextToken ?? undefined);
      if (response.status === "answer") {
        setScope({ dateFrom: response.scope.dateFrom, dateTo: response.scope.dateTo, storeId: response.scope.storeId });
        setQuestion(current => current.trim() === question.trim() ? "" : current);
      }
    } catch (cause) {
      const failure = cause as NonNullable<Parameters<typeof translateError>[1]>;
      if (requestAccessEpoch !== accessEpoch.current) return;
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(failure.data?.code ?? "") || failure.message === "baamScopeChanged") {
        setEntries([]);
        setQuestion("");
        setContextToken(undefined);
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
    : configured ? tAssistant(capabilities.data?.aiConfigured ? "aiAvailability" : "localAvailability") : tErrors("baamNotConfigured");
  // A failed permission refresh must not retain previous protected answers.
  const visibleEntries = !sessionRevalidating && activated && configured && capabilitiesMatch && !capabilities.error && !capabilities.isFetching &&
    scopeReady && conversationAccessKey === currentAccessKey ? entries : [];
  const changeScope = (next: typeof scope) => {
    setScope(next);
    setContextToken(undefined);
    setError(undefined);
  };
  const activePreset = baamDatePresets.find(preset => {
    const range = baamPresetRange(preset);
    return range.dateFrom === scope.dateFrom && range.dateTo === scope.dateTo;
  }) ?? "custom";

  const panel: Omit<BaamAssistantPanelProps, "compact"> = {
    entries: visibleEntries, onAsk: question => void ask(question), pending,
    question, onQuestionChange: setQuestion,
    available, availabilityLabel,
    error: queryError ? translateError(tErrors, queryError) : error,
    hasContext: Boolean(contextToken),
    suggestions: baamStarterKeys(pageContext, capabilitiesMatch ? capabilities.data?.navigationIds : []).map(key => tAssistant(key)),
    pageContextLabel: tAssistant("pageContext", { page: tAssistant(baamPageLabelKey(pageContext)) }),
    onNewConversation: () => { setEntries([]); setQuestion(""); setContextToken(undefined); setError(undefined); },
    onRetryAvailability: queryError ? () => refreshAccessRef.current() : undefined,
    scopeControls: <details className="text-xs">
      <summary className="cursor-pointer break-words font-medium text-foreground">
        {tAssistant("scope")} · {scope.dateFrom} — {scope.dateTo} · {scope.storeId
          ? stores.find(store => store.id === scope.storeId)?.name ?? tAssistant("selectedStoreUnavailable")
          : t("allStores")}
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label htmlFor={`${scopeId}-preset`} className="col-span-2 space-y-1"><span>{tAssistant("period")}</span>
          <select id={`${scopeId}-preset`} value={activePreset} disabled={pending}
            onChange={event => {
              if (event.target.value !== "custom") changeScope({ ...scope, ...baamPresetRange(event.target.value as BaamDatePreset) });
            }}
            className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
            <option value="custom">{tAssistant("presets.custom")}</option>
            {baamDatePresets.map(preset => <option key={preset} value={preset}>{tAssistant(`presets.${preset}`)}</option>)}
          </select>
        </label>
        <label htmlFor={`${scopeId}-from`} className="space-y-1"><span>{t("dateFrom")}</span>
          <Input id={`${scopeId}-from`} type="date" value={scope.dateFrom} disabled={pending}
            onChange={event => changeScope({ ...scope, dateFrom: event.target.value })} className="min-w-0 text-xs" />
        </label>
        <label htmlFor={`${scopeId}-to`} className="space-y-1"><span>{t("dateTo")}</span>
          <Input id={`${scopeId}-to`} type="date" value={scope.dateTo} disabled={pending}
            onChange={event => changeScope({ ...scope, dateTo: event.target.value })} className="min-w-0 text-xs" />
        </label>
        <label htmlFor={`${scopeId}-store`} className="col-span-2 min-w-0 space-y-1"><span>{t("store")}</span>
          <select id={`${scopeId}-store`} value={scope.storeId ?? ""} disabled={!scopeReady || pending}
            onChange={event => changeScope({ ...scope, storeId: event.target.value || undefined })}
            className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">{t("allStores")}</option>
            {scope.storeId && !selectedStoreAvailable ? <option value={scope.storeId} disabled>{tAssistant("selectedStoreUnavailable")}</option> : null}
            {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <p className="col-span-2 leading-5 text-muted-foreground">{tAssistant("datePolicy")}</p>
      </div>
    </details>,
  };
  return <AssistantContext.Provider value={sessionRevalidating ? { status: "loading" } : { status: "ready", activate, panel }}>{children}</AssistantContext.Provider>;
}
