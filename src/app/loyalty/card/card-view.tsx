"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { formatKgsMoney, baseAccountingCurrency } from "@/lib/currencyDisplay";
import { Button } from "@/components/ui/button";

type CardView = {
  member: { id: string; displayName: string | null; email: string | null };
  store: { id: string; name: string } | null;
  rules: {
    memberDiscountPercent: number;
    earnPercent: number;
    maxSpendPercent: number;
    pointValueKgs: number;
  };
  rulesText: string | null;
  balancePoints: number;
  availablePoints: number;
  history: Array<{ id: string; type: string; points: number; balanceAfter: number | null; reference: string | null; createdAt: string }>;
};

export function LoyaltyCard({ view: initialView }: { view: CardView }) {
  const [view, setView] = useState(initialView);
  const t = useTranslations("loyalty");
  const router = useRouter();
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const [requests, setRequests] = useState<Array<{id: string; number: string; store: string; points: number; payableKgs: number; approved: boolean}>>([]);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [consentLoadError, setConsentLoadError] = useState(false);
  const [readError, setReadError] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const expiredSession = useRef(false);
  const cardSequence = useRef(0);
  const consentSequence = useRef(0);
  const invalidateSession = useCallback(() => {
    if (!mounted.current) return;
    expiredSession.current = true;
    setSessionExpired(true);
    setQr(null);
    setExpiresAt(null);
    setRequests([]);
  }, []);
  const refreshCard = useCallback(async () => {
    if (document.hidden || expiredSession.current) return;
    const sequence = ++cardSequence.current;
    setReadBusy(true);
    try {
      const response = await fetch("/api/loyalty/card", { cache: "no-store" });
      if (!mounted.current || sequence !== cardSequence.current) return;
      if (response.status === 401) { invalidateSession(); return; }
      if (!response.ok) throw new Error();
      const data: CardView = await response.json();
      if (!data.member || !data.rules || !Array.isArray(data.history) || !Number.isFinite(data.availablePoints)) throw new Error();
      if (mounted.current && sequence === cardSequence.current && !expiredSession.current) {
        setView(data);
        setReadError(false);
      }
    } catch {
      if (mounted.current && sequence === cardSequence.current && !expiredSession.current) setReadError(true);
    } finally {
      if (mounted.current && sequence === cardSequence.current) setReadBusy(false);
    }
  }, [invalidateSession]);
  const refreshConsent = useCallback(async () => {
    if (document.hidden || expiredSession.current) return;
    const sequence = ++consentSequence.current;
    try {
      const response = await fetch("/api/loyalty/consent", { cache: "no-store" });
      if (!mounted.current || sequence !== consentSequence.current) return;
      if (response.status === 401) { invalidateSession(); return; }
      if (!response.ok) throw new Error();
      const data: typeof requests = await response.json();
      if (!Array.isArray(data)) throw new Error();
      if (mounted.current && sequence === consentSequence.current && !expiredSession.current) {
        setRequests(data);
        setConsentLoadError(false);
      }
    } catch {
      if (mounted.current && sequence === consentSequence.current && !expiredSession.current) setConsentLoadError(true);
    }
  }, [invalidateSession]);
  useEffect(() => {
    mounted.current = true;
    void refreshConsent();
    const cardTimer = window.setInterval(() => void refreshCard(), 5000);
    const consentTimer = window.setInterval(() => void refreshConsent(), 2500);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    const focus = () => { void refreshCard(); void refreshConsent(); };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      cardSequence.current += 1;
      consentSequence.current += 1;
      window.clearInterval(cardTimer);
      window.clearInterval(consentTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener("focus", focus);
    };
  }, [refreshCard, refreshConsent]);
  const approve = async (id: string) => {
    if (consentBusy || expiredSession.current) return;
    setConsentBusy(true); setConsentError(false);
    // Ignore a poll begun before the approval; it may still contain the old state.
    consentSequence.current += 1;
    try {
      const response = await fetch("/api/loyalty/consent", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id})});
      if (response.status === 401) { invalidateSession(); return; }
      if (!response.ok) throw new Error();
      if (mounted.current && !expiredSession.current) {
        consentSequence.current += 1;
        setRequests((current) => current.map((request) => request.id === id ? {...request, approved: true} : request));
      }
    } catch { if (mounted.current) setConsentError(true); }
    finally { if (mounted.current) setConsentBusy(false); }
  };
  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const expired = Boolean(expiresAt && secondsLeft <= 0);

  const showQr = async () => {
    if (busy || expiredSession.current) return;
    setBusy(true);
    setQrError(false);
    try {
      const response = await fetch("/api/loyalty/card/qr", { method: "POST" });
      if (response.status === 401) { invalidateSession(); return; }
      if (!response.ok) throw new Error();
      const { qrDataUrl, expiresAt: expiry } = (await response.json()) as {
        qrDataUrl: string; expiresAt: string;
      };
      const timestamp = new Date(expiry).getTime();
      if (typeof qrDataUrl !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qrDataUrl) || !Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error();
      if (mounted.current && !expiredSession.current) {
        setQr(qrDataUrl);
        setExpiresAt(timestamp);
        setNow(Date.now());
      }
    } catch { if (mounted.current) setQrError(true); }
    finally { if (mounted.current) setBusy(false); }
  };

  const signOut = async () => {
    if (signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/loyalty/signout", { method: "POST" });
      if (!response.ok) throw new Error();
      if (mounted.current) { invalidateSession(); router.push("/"); }
    } catch { if (mounted.current) setSignOutError(true); }
    finally { if (mounted.current) setSignOutBusy(false); }
  };

  if (sessionExpired) {
    return <div role="status" className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">{t("noSession")}</div>;
  }

  return (
    <div className="space-y-5">
      {readError ? <div role="alert" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <p>{t("cardRefreshFailed")}</p>
        <Button variant="secondary" size="sm" disabled={readBusy} onClick={() => void refreshCard()}>{tCommon("tryAgain")}</Button>
      </div> : null}
      {consentLoadError ? <div role="alert" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <p>{t("consentRefreshFailed")}</p>
        <Button variant="secondary" size="sm" onClick={() => void refreshConsent()}>{tCommon("tryAgain")}</Button>
      </div> : null}
      {requests.map((request) => <section key={request.id} className="space-y-3 rounded-lg border border-primary bg-card p-4">
        <h2 className="font-semibold">{t("consentTitle")}</h2>
        <p className="text-sm">{request.store} · {request.number}</p>
        <p>{t("consentAmounts", {points: request.points, amount: formatKgsMoney(request.payableKgs, locale, baseAccountingCurrency)})}</p>
        <Button disabled={consentBusy || request.approved} onClick={() => void approve(request.id)}>{t(request.approved ? "consentApproved" : "consentApprove")}</Button>
      </section>)}
      {consentError ? <p role="alert" className="text-sm text-danger">{t("consentFailed")}</p> : null}
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">{view.store?.name ?? t("programme")}</p>
        <p className="mt-2 text-4xl font-semibold tabular-nums">{view.availablePoints}</p>
        <p className="text-sm text-muted-foreground">{t("availablePoints")}</p>
        {view.balancePoints !== view.availablePoints && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("reservedNote", { balance: view.balancePoints })}
          </p>
        )}
        <div className="mt-4 flex flex-col items-center gap-3">
          {qr && !expired ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={t("qrAlt")} className="h-56 w-56 rounded-md bg-white p-2" />
          ) : null}
          {qr && !expired ? (
            <p className="text-xs text-muted-foreground">{t("qrExpiresIn", { seconds: secondsLeft })}</p>
          ) : null}
          {expired ? <p className="text-xs text-warning">{t("qrExpiredHint")}</p> : null}
          {qrError ? <p role="alert" className="text-sm text-danger">{t("qrFailed")}</p> : null}
          <Button onClick={() => void showQr()} disabled={busy} aria-busy={busy}>
            {qr && !expired ? t("refreshQr") : t("showQr")}
          </Button>
          <p className="max-w-xs text-xs text-muted-foreground">{t("qrNote")}</p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{t("memberDiscount")}</dt>
          <dd className="mt-1 font-semibold">{view.rules.memberDiscountPercent}%</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{t("earnPercent")}</dt>
          <dd className="mt-1 font-semibold">{view.rules.earnPercent}%</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{t("maxSpend")}</dt>
          <dd className="mt-1 font-semibold">{view.rules.maxSpendPercent}%</dd>
        </div>
      </dl>

      {view.rulesText && (
        <details className="rounded-lg border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">{t("rules")}</summary>
          <p className="mt-2 text-muted-foreground">{view.rulesText}</p>
        </details>
      )}

      <section className="rounded-lg border border-border bg-card">
        <h2 className="border-b border-border p-4 font-semibold">{t("history")}</h2>
        {view.history.length ? (
          <ul className="divide-y divide-border">
            {view.history.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span className="text-muted-foreground">
                  {t(`ledger.${entry.type}` as never)}
                  <span className="ml-2 text-xs">
                    {new Date(entry.createdAt).toLocaleDateString(locale === "kg" ? "ky-KG" : locale)}
                    {entry.reference ? ` · ${entry.reference}` : ""}
                  </span>
                </span>
                <span className={`tabular-nums ${entry.points < 0 ? "text-danger" : "text-success"}`}>
                  {entry.points > 0 ? `+${entry.points}` : entry.points}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("historyEmpty")}</p>
        )}
      </section>

      {signOutError ? <p role="alert" className="text-sm text-danger">{t("signOutFailed")}</p> : null}
      <Button variant="ghost" className="w-full" disabled={signOutBusy} aria-busy={signOutBusy} onClick={() => void signOut()}>
        {t("signOut")}
      </Button>
    </div>
  );
}
