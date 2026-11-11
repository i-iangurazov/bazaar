"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";
import type { AppleSupportCase } from "@/server/billing/appleSupportCases";
import { ViewIcon, RestoreIcon, SearchIcon } from "@/components/icons";
import { QueryErrorState } from "@/components/query-error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal, ModalFooter } from "@/components/ui/modal";

export function AppleSupportCases({ enabled }: { enabled: boolean }) {
  const t = useTranslations("platformOwner.appleSupport"), common = useTranslations("common"), errors = useTranslations("errors"), locale = useLocale();
  const utils = trpc.useUtils();
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const query = trpc.platformOwner.appleCases.useQuery({ limit: 20, cursor: pages.at(-1) }, { enabled, keepPreviousData: true });
  const recheck = trpc.platformOwner.recheckAppleCase.useMutation(), ingest = trpc.platformOwner.importAppleEvidence.useMutation();
  const [selected, setSelected] = useState<AppleSupportCase | null>(null), [draft, setDraft] = useState("");
  const [evidence, setEvidence] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const locked = useRef(false), epoch = useRef(0), live = useRef(enabled); live.current = enabled;
  useEffect(() => {
    const scopeEpoch = epoch, scopeLive = live;
    scopeLive.current = enabled;
    scopeEpoch.current++;
    if (!locked.current) setBusy(false);
    if (!enabled) { setSelected(null); setEvidence(""); setConfirmed(false); setError(""); setNotice(""); }
    return () => { scopeLive.current = false; scopeEpoch.current++; };
  }, [enabled]);
  const message = (failure: unknown) => translateError(errors, failure as Parameters<typeof translateError>[1]);
  const run = async (operation: (valid: () => boolean) => Promise<void>) => {
    if (!enabled || locked.current) return;
    const generation = epoch.current, valid = () => live.current && generation === epoch.current;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(valid); } catch (failure) { if (valid()) setError(message(failure)); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const open = (item: AppleSupportCase) => { if (busy || !enabled) return; setSelected(item); setEvidence(""); setConfirmed(false); setError(""); setNotice(""); };
  const close = () => { if (locked.current) return; setSelected(null); setEvidence(""); setConfirmed(false); setError(""); };
  const money = (item: AppleSupportCase) => {
    const tx = item.transaction;
    if (!tx?.currency || tx.priceMillis === null) return t("amountUnknown");
    try { return new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale, { style: "currency", currency: tx.currency }).format(Number(tx.priceMillis) / 1000); }
    catch { return `${Number(tx.priceMillis) / 1000} ${tx.currency}`; }
  };
  const reason = (item: AppleSupportCase) => item.reason && errors.has(item.reason) ? errors(item.reason) : t("reasonUnknown");
  const status = (item: AppleSupportCase) => t(item.state === "NATIVE_PENDING" ? "stateNative" : item.state === "FINANCIAL_REVIEW" ? "stateReview" : "stateResolved");
  const check = (item: AppleSupportCase) => run(async (valid) => {
    const result = await recheck.mutateAsync({ caseId: item.caseId });
    if (!valid()) return;
    setNotice(t(result.status === "NO_APPLE_REFERENCE" ? "noReference" : "rechecked"));
    setSelected((current) => current?.caseId === item.caseId ? result.case : current);
    await query.refetch();
  });
  if (!enabled) return null;
  return <Card data-apple-support-cases>
    <CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void run(async (valid) => {
        const caseId = draft.trim(); if (!/^(intent|transaction):[A-Za-z0-9_-]{1,80}$/.test(caseId)) { setError(t("invalidCase")); return; }
        const item = await utils.platformOwner.appleCase.fetch({ caseId });
        if (valid()) { setSelected(item); setEvidence(""); setConfirmed(false); }
      }); }}>
        <label className="flex-1 space-y-1 text-sm" htmlFor="apple-support-search">{t("searchLabel")}
          <Input id="apple-support-search" value={draft} maxLength={100} placeholder={t("searchPlaceholder")} disabled={busy}
            onChange={(event) => setDraft(event.target.value)} />
        </label>
        <IconButton type="submit" icon={SearchIcon} label={t("search")} disabled={busy || !draft.trim()} loading={busy} />
      </form>
      {query.isLoading ? <p>{common("loading")}</p> : query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} /> :
        query.data?.items.length ? <ul className="space-y-3">{query.data.items.map((item) => <li key={item.caseId} className="space-y-2 rounded-md border border-input p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1"><p className="break-words font-medium">{item.organization.name}</p>
              <p className="text-sm">{status(item)} · {item.transaction ? money(item) : t("amountUnknown")}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{item.caseId}</p></div>
            <div className="flex shrink-0 gap-1">
              <IconButton icon={ViewIcon} label={t("view")} variant="ghost" disabled={busy || query.isFetching} onClick={() => open(item)} />
              <IconButton icon={RestoreIcon} label={t("recheck")} variant="ghost" disabled={busy || query.isFetching} onClick={() => void check(item)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{formatDateTime(item.createdAt, locale)} · {t(item.environment === "Sandbox" ? "testEnvironment" : "liveEnvironment")}</p>
          <p className="text-sm">{reason(item)}</p>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <div className="flex gap-2">
        {pages.length > 1 ? <Button variant="secondary" disabled={busy || query.isFetching} onClick={() => setPages((current) => current.slice(0, -1))}>{t("previousPage")}</Button> : null}
        {query.data?.nextCursor ? <Button variant="secondary" disabled={busy || query.isFetching}
          onClick={() => { if (query.data?.nextCursor) setPages((current) => [...current, query.data!.nextCursor!]); }}>{t("nextPage")}</Button> : null}
      </div>
      {notice && !selected ? <p role="status" className="text-sm">{notice}</p> : null}
      {error && !selected ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Modal open={Boolean(selected)} onOpenChange={(value) => { if (!value) close(); }} title={t("detailsTitle")}>
        {selected ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const item = selected;
          if (!confirmed || evidence.trim().length < 30) return;
          void run(async (valid) => {
            const result = await ingest.mutateAsync({ caseId: item.caseId, signedTransactionInfo: evidence.trim() });
            if (!valid()) return;
            setSelected(result.case); setEvidence(""); setConfirmed(false); setNotice(t("evidenceRecorded")); await query.refetch();
          }); }}>
          <p className="font-medium">{selected.organization.name} · {status(selected)}</p>
          <p className="break-all font-mono text-xs">{selected.caseId}</p>
          <p className="text-sm">{reason(selected)}</p>
          <p className="text-sm">{t(selected.payerState === "ACTIVE_ADMIN" ? "payerActive" : selected.payerState === "SYSTEM" ? "payerSystem" : selected.payerState === "UNKNOWN" ? "payerUnknown" : "payerDeparted")}</p>
          <p className="text-sm text-muted-foreground">{t(selected.completionCapability ? "capabilityEnrolled" : "capabilityLegacy")}</p>
          {selected.transaction ? <p className="break-all text-sm">{t("referenceLabel")}: {selected.transaction.transactionId} · {money(selected)}</p> : null}
          <p className="text-sm text-muted-foreground">{t("evidenceHint")}</p>
          <label htmlFor="apple-support-evidence" className="block text-sm">{t("evidenceLabel")}</label>
          <Textarea id="apple-support-evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={busy}
            maxLength={100000} autoComplete="off" spellCheck={false} rows={4} />
          <div className="flex items-start gap-2"><Checkbox id="apple-support-confirm" checked={confirmed} disabled={busy}
            onCheckedChange={(value) => setConfirmed(value === true)} /><label className="text-sm" htmlFor="apple-support-confirm">{t("confirmEvidence")}</label></div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          {notice ? <p role="status" className="text-sm">{notice}</p> : null}
          <ModalFooter><Button type="button" variant="secondary" disabled={busy} onClick={close}>{common("cancel")}</Button>
            <Button type="submit" disabled={busy || !confirmed || evidence.trim().length < 30}>{busy ? common("loading") : t("importAction")}</Button></ModalFooter>
        </form> : null}
      </Modal>
    </CardContent>
  </Card>;
}
