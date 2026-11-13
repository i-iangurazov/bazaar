"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/i18nFormat";
import { HideIcon, ShieldCheckIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const APPLE_CONSUMPTION_POLICY_VERSION = "2026-11-13-v1" as const;
const deliveryValues = ["DELIVERED", "UNDELIVERED_QUALITY_ISSUE", "UNDELIVERED_WRONG_ITEM", "UNDELIVERED_SERVER_OUTAGE", "UNDELIVERED_OTHER"] as const;
const responseStatuses = ["WAITING_BINDING", "WAITING_CONSENT", "WAITING_EVIDENCE", "PENDING", "SENDING", "SENT", "EXPIRED", "FAILED", "SUPPRESSED"] as const;
type DeliveryStatus = (typeof deliveryValues)[number];
type DeliveryDraft = DeliveryStatus | "UNKNOWN" | "";
type SampleDraft = "yes" | "no" | "unknown" | "";
export type AppleConsumptionConsentState = {
  policyVersion: string;
  viewerUserId: string;
  availableToViewer: boolean;
  canManage: boolean;
  canRevoke: boolean;
  consented: boolean;
  valid: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  deliveryStatus: DeliveryStatus | null;
  sampleContentProvided: boolean | null;
  invalidReason: string | null;
  responseStatus: string | null;
  lastIssue: string | null;
};

type Props = {
  organizationId: string;
  organizationName: string;
  transactionId: string;
  environment: string;
  state?: AppleConsumptionConsentState | null;
  onUpdated: () => unknown;
};

export function AppleConsumptionConsent({ organizationId, organizationName, transactionId, environment, state, onUpdated }: Props) {
  const t = useTranslations("appleConsumption");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const mutation = trpc.billing.apple.consumptionConsent.useMutation();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDraft>("");
  const [sample, setSample] = useState<SampleDraft>("");
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState<{ audience: string; basedOn: string; value: AppleConsumptionConsentState } | null>(null);
  const sourceFingerprint = JSON.stringify(state ?? null);
  const audience = JSON.stringify([organizationId, transactionId, environment, state?.viewerUserId, state?.policyVersion,
    state?.canManage, state?.canRevoke, status, session?.user.id, session?.user.organizationId, session?.user.role]);
  const currentAudience = useRef(audience);
  currentAudience.current = audience;
  const activeRequest = useRef<object | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setOpen(false); setAccepted(false); setDelivery(""); setSample(""); setPending(false); setIssue(""); setNotice(""); setConfirmed(null);
    activeRequest.current = null;
  }, [audience]);

  const candidate = confirmed?.audience === audience && confirmed.basedOn === sourceFingerprint ? confirmed.value : state;
  const viewerMatches = status === "authenticated" && Boolean(session?.user.id) && candidate?.viewerUserId === session?.user.id &&
    session?.user.organizationId === organizationId;
  // Query caches can briefly retain the previous viewer's result. Never render
  // personal answers, dates or state before the current audience is confirmed.
  const saved = viewerMatches ? candidate : undefined;
  const supported = saved?.policyVersion === APPLE_CONSUMPTION_POLICY_VERSION && (environment === "Sandbox" || environment === "Production");
  const canManage = Boolean(viewerMatches && saved?.availableToViewer && supported && saved.canManage && session?.user.role === "ADMIN");
  const canRevoke = Boolean(viewerMatches && saved?.availableToViewer && saved.canRevoke && saved.consented);
  const statusKey = !saved ? candidate ? "refreshIdentity" : "unavailable" : !saved.consented ? saved.revokedAt ? "revoked" : "notGranted"
    : saved.valid ? "granted" : saved.invalidReason === "appleConsumptionEvidenceRequired" ? "needsEvidence" : "inactive";
  const openChoice = () => {
    setAccepted(false);
    setDelivery(saved?.deliveryStatus ?? "");
    setSample(saved?.sampleContentProvided === true ? "yes" : saved?.sampleContentProvided === false ? "no" : "");
    setIssue(""); setNotice(""); setOpen(true);
  };
  const save = async (consented: boolean) => {
    if (activeRequest.current || !viewerMatches || (consented ? !canManage || !accepted || !delivery || !sample : !canManage && !canRevoke)) return;
    if (environment !== "Sandbox" && environment !== "Production") return;
    const request = {};
    activeRequest.current = request;
    const expectedAudience = audience;
    const current = () => mounted.current && currentAudience.current === expectedAudience && activeRequest.current === request;
    setPending(true); setIssue(""); setNotice("");
    try {
      const result = await mutation.mutateAsync({
        expectedOrganizationId: organizationId, transactionId, environment, consented,
        policyVersion: APPLE_CONSUMPTION_POLICY_VERSION,
        ...(consented ? { deliveryStatus: delivery === "UNKNOWN" ? null : delivery as DeliveryStatus,
          sampleContentProvided: sample === "unknown" ? null : sample === "yes" } : {}),
      });
      if (!current()) return;
      if (result.organizationId !== organizationId || result.transactionId !== transactionId || result.environment !== environment ||
        result.consumptionConsent.viewerUserId !== session?.user.id || !result.consumptionConsent.availableToViewer || result.consumptionConsent.policyVersion !== APPLE_CONSUMPTION_POLICY_VERSION ||
        result.consumptionConsent.consented !== consented) throw new Error("appleConsumptionConsentUnconfirmed");
      // A checkbox is only a local proposal. Display a saved choice only after
      // this exact buyer/purchase receives the server's authoritative result.
      setConfirmed({ audience: expectedAudience, basedOn: sourceFingerprint, value: result.consumptionConsent });
      setAccepted(false); setOpen(false);
      setNotice(t(consented ? result.consumptionConsent.valid ? "saved" : "savedWaiting" : "withdrawn"));
      void Promise.resolve().then(onUpdated).catch(() => { /* The confirmed response remains visible until a fresh query succeeds. */ });
    } catch (error) {
      if (!current()) return;
      const key = error instanceof Error ? error.message : "";
      setIssue(key && errors.has(key) ? errors(key) : t("saveFailed"));
    } finally {
      if (current()) { activeRequest.current = null; setPending(false); }
    }
  };

  if (status !== "authenticated" || candidate?.availableToViewer === false) return null;
  const responseStatus = responseStatuses.find(value => value === saved?.responseStatus);
  return <section className="mt-2 min-w-0 space-y-2 rounded-md border border-border bg-muted/20 p-3" aria-label={t("title")} data-apple-consumption-consent>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium">{t("title")}</p>
        <p className="text-xs text-muted-foreground" data-consumption-saved-state>{t(statusKey)}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        {canManage ? <IconButton icon={ShieldCheckIcon} label={t("manage")} variant="ghost" disabled={pending} onClick={openChoice} /> : null}
        {canRevoke ? <IconButton icon={HideIcon} label={t("revoke")} variant="ghost" disabled={pending} loading={pending} onClick={() => void save(false)} /> : null}
      </div>
    </div>
    {saved?.grantedAt ? <p className="text-xs text-muted-foreground">{t("grantedAt", { date: formatDateTime(saved.grantedAt, locale) })}</p> : null}
    {saved?.revokedAt ? <p className="text-xs text-muted-foreground">{t("revokedAt", { date: formatDateTime(saved.revokedAt, locale) })}</p> : null}
    {saved?.responseStatus ? <p className="text-xs text-muted-foreground">{responseStatus ? t(`responses.${responseStatus}`) : t("responseUnknown")}</p> : null}
    {!canManage && !canRevoke ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
    {pending ? <p role="status" className="text-xs">{t("saving")}</p> : null}
    {notice ? <p role="status" className="text-xs">{notice}</p> : null}
    {issue && !open ? <div role="alert" className="space-y-2 text-xs text-danger"><p>{issue}</p>
      <Button variant="outline" size="sm" onClick={() => void onUpdated()}>{common("tryAgain")}</Button></div> : null}
    <Modal open={open && (canManage || canRevoke)} onOpenChange={(value) => { setOpen(value); if (!value) setAccepted(false); }} title={t("title")}>
      <div className="space-y-4" data-apple-consumption-dialog>
        <p className="font-medium">{organizationName}</p>
        <p className="break-all text-xs text-muted-foreground">{t("purchase", { id: transactionId })}</p>
        <p className="text-sm font-medium">{t("optional")}</p>
        <p className="text-sm leading-6">{t("disclosure")}</p>
        <p className="text-sm leading-6">{t("classification")}</p>
        <p className="text-sm leading-6">{t("choice")}</p>
        <a href="/privacy#apple-refund-data" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline">{t("privacy")}</a>
        <div className="space-y-2">
          <Label htmlFor={`${ids}-delivery`}>{t("deliveryQuestion")}</Label>
          <Select value={delivery} onValueChange={(value) => setDelivery(value as DeliveryDraft)} disabled={pending || !canManage}>
            <SelectTrigger id={`${ids}-delivery`} aria-label={t("deliveryQuestion")} className="h-auto min-h-11 text-left [&>span]:whitespace-normal"><SelectValue placeholder={t("choose")} /></SelectTrigger>
            <SelectContent>{[...deliveryValues, "UNKNOWN"].map(value => <SelectItem key={value} value={value}>{t(`delivery.${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${ids}-sample`}>{t("sampleQuestion")}</Label>
          <Select value={sample} onValueChange={(value) => setSample(value as SampleDraft)} disabled={pending || !canManage}>
            <SelectTrigger id={`${ids}-sample`} aria-label={t("sampleQuestion")} className="h-auto min-h-11 text-left [&>span]:whitespace-normal"><SelectValue placeholder={t("choose")} /></SelectTrigger>
            <SelectContent>{["yes", "no", "unknown"].map(value => <SelectItem key={value} value={value}>{t(`sample.${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("unknown")}</p>
        <div className="flex items-start gap-3">
          <Checkbox id={`${ids}-consent`} checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} disabled={pending || !canManage} />
          <Label htmlFor={`${ids}-consent`} className="text-sm leading-6">{t("accept")}</Label>
        </div>
        {pending ? <p role="status" className="text-sm">{t("saving")}</p> : null}
        {issue ? <p role="alert" className="text-sm text-danger">{issue}</p> : null}
        <ModalFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setAccepted(false); }}>{common("close")}</Button>
          <Button variant="secondary" disabled={pending || !viewerMatches} onClick={() => void save(false)}>{t(saved?.consented ? "revoke" : "decline")}</Button>
          <Button disabled={pending || !canManage || !accepted || !delivery || !sample} onClick={() => void save(true)}>{t("save")}</Button>
        </ModalFooter>
      </div>
    </Modal>
  </section>;
}

/** Only personal consent records are read here; this never loads the billing catalog. */
export function AppleConsumptionRevocations() {
  const t = useTranslations("appleConsumption");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const viewer = JSON.stringify([status, session?.user.id, session?.user.organizationId, session?.user.role]);
  const currentViewer = useRef(viewer); currentViewer.current = viewer;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = trpc.billing.apple.personalConsumptionConsents.useQuery(undefined, { enabled: status === "authenticated", staleTime: 0, retry: false });
  const refetchPersonal = query.refetch;
  const revoke = trpc.billing.apple.revokePersonalConsumptionConsent.useMutation();
  const utils = trpc.useUtils();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<object | null>(null);
  useEffect(() => {
    active.current = null; setPendingId(null); setIssue(""); setNotice("");
    if (status === "authenticated") void refetchPersonal();
  }, [viewer, status, refetchPersonal]);
  const viewerMatches = status === "authenticated" && query.data?.viewerUserId === session?.user.id;
  const withdraw = async (consentId: string) => {
    if (active.current || !viewerMatches) return;
    const operation = {}, expectedViewer = viewer;
    active.current = operation; setPendingId(consentId); setIssue(""); setNotice("");
    const current = () => mounted.current && currentViewer.current === expectedViewer && active.current === operation;
    try {
      const result = await revoke.mutateAsync({ consentId });
      if (!current()) return;
      if (result.viewerUserId !== session?.user.id || result.consents.some(value => value.consentId === consentId && value.consented)) throw new Error("appleConsumptionConsentUnconfirmed");
      utils.billing.apple.personalConsumptionConsents.setData(undefined, result);
      setNotice(t("withdrawn"));
    } catch (error) {
      if (!current()) return;
      const key = error instanceof Error ? error.message : "";
      setIssue(key && errors.has(key) ? errors(key) : t("saveFailed"));
    } finally { if (current()) { active.current = null; setPendingId(null); } }
  };
  if (status !== "authenticated") return null;
  return <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" aria-label={t("personalTitle")} data-apple-personal-consents>
    <h3 className="font-semibold">{t("personalTitle")}</h3>
    <p className="text-sm leading-6 text-muted-foreground">{t("personalDescription")}</p>
    <p className="text-xs leading-5 text-muted-foreground">{t("withdrawalEffect")}</p>
    {query.isLoading ? <p role="status" className="text-sm">{common("loading")}</p>
      : query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        : !viewerMatches ? <div className="space-y-2 text-sm" role="status"><p>{t("refreshIdentity")}</p><Button variant="outline" onClick={() => void query.refetch()}>{common("tryAgain")}</Button></div>
          : query.data?.consents.length ? <div className="divide-y divide-border">{query.data.consents.map(consent => <div key={consent.consentId} className="flex min-w-0 items-start justify-between gap-3 py-3 text-sm">
            <div className="min-w-0 space-y-1"><p>{consent.grantedAt ? t("personalGrantedAt", { date: formatDateTime(consent.grantedAt, locale) }) : t("personalSavedChoice")}</p>
              <p className="text-xs text-muted-foreground">{t(consent.consented ? "personalStored" : "revoked")}</p>
              {consent.revokedAt ? <p className="text-xs text-muted-foreground">{t("revokedAt", { date: formatDateTime(consent.revokedAt, locale) })}</p> : null}</div>
            {consent.consented ? <IconButton icon={HideIcon} label={t("revoke")} variant="ghost" disabled={pendingId !== null} loading={pendingId === consent.consentId} onClick={() => void withdraw(consent.consentId)} /> : null}
          </div>)}</div> : <p className="text-sm text-muted-foreground">{t("personalEmpty")}</p>}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {issue ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{issue}</p><Button variant="outline" onClick={() => void query.refetch()}>{common("tryAgain")}</Button></div> : null}
    <a href="/privacy#apple-refund-data" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline">{t("privacy")}</a>
  </section>;
}
