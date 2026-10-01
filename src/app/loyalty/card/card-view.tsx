"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useLocale } from "next-intl";
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
  const [requests, setRequests] = useState<Array<{id: string; number: string; store: string; points: number; payableKgs: number; approved: boolean}>>([]);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const response = await fetch("/api/loyalty/consent"); if (!response.ok) return;
        const data = await response.json(); if (active) setRequests(data);
      } catch { /* Retry on next poll without losing the card session. */ }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const approve = async (id: string) => {
    setConsentBusy(true); setConsentError(false);
    try { const response = await fetch("/api/loyalty/consent", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id})});
      if (!response.ok) throw new Error();
      setRequests((current) => current.map((request) => request.id === id ? {...request, approved: true} : request));
    } catch { setConsentError(true); } finally { setConsentBusy(false); }
  };
  useEffect(() => {
    const refresh = async () => { if (document.hidden) return; try { const response = await fetch("/api/loyalty/card"); if (response.ok) setView(await response.json()); } catch { /* Keep the last confirmed balance until retry. */ } };
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const expired = Boolean(expiresAt && secondsLeft <= 0);

  const showQr = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/loyalty/card/qr", { method: "POST" });
      if (!response.ok) throw new Error("loyaltyQrFailed");
      const { qrDataUrl, expiresAt: expiry } = (await response.json()) as {
        qrDataUrl: string;
        expiresAt: string;
      };
      setQr(qrDataUrl);
      setExpiresAt(new Date(expiry).getTime());
    } catch {
      setQr(null);
      setExpiresAt(null);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/loyalty/signout", { method: "POST" });
    router.push("/");
  };

  return (
    <div className="space-y-5">
      {requests.map((request) => <section key={request.id} className="space-y-3 rounded-xl border border-primary bg-card p-4">
        <h2 className="font-semibold">{t("consentTitle")}</h2>
        <p className="text-sm">{request.store} · {request.number}</p>
        <p>{t("consentAmounts", {points: request.points, amount: formatKgsMoney(request.payableKgs, locale, baseAccountingCurrency)})}</p>
        <Button disabled={consentBusy || request.approved} onClick={() => void approve(request.id)}>{t(request.approved ? "consentApproved" : "consentApprove")}</Button>
      </section>)}
      {consentError ? <p role="alert" className="text-sm text-danger">{t("consentFailed")}</p> : null}
      <div className="rounded-xl border border-border bg-card p-5 text-center">
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
            <img src={qr} alt={t("qrAlt")} className="h-56 w-56" />
          ) : null}
          {qr && !expired ? (
            <p className="text-xs text-muted-foreground">{t("qrExpiresIn", { seconds: secondsLeft })}</p>
          ) : null}
          {expired ? <p className="text-xs text-warning">{t("qrExpiredHint")}</p> : null}
          <Button onClick={() => void showQr()} disabled={busy}>
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
        <details className="rounded-xl border border-border bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">{t("rules")}</summary>
          <p className="mt-2 text-muted-foreground">{view.rulesText}</p>
        </details>
      )}

      <section className="rounded-xl border border-border bg-card">
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

      <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
        {t("signOut")}
      </Button>
    </div>
  );
}
