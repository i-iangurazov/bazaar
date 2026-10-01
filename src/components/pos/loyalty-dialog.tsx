"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatKgsMoney, baseAccountingCurrency } from "@/lib/currencyDisplay";
import { useLocale } from "next-intl";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";

type Member = {
  memberId: string;
  displayName: string | null;
  balancePoints: number;
  availablePoints: number;
};

/**
 * Separate register dialog for the loyalty programme. Opened only from the existing
 * customer dialog, so it never changes the background register layout.
 */
export function LoyaltyDialog({
  open,
  onOpenChange,
  saleId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string | null;
  onApplied?: () => void;
}) {
  const t = useTranslations("loyalty");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [token, setToken] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [points, setPoints] = useState(0);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConsentId(null);
      setToken("");
      setMember(null);
      setPoints(0);
      setError(null);
    }
  }, [open]);

  const resolve = trpc.loyalty.posResolveCard.useMutation({
    onSuccess: (card) => {
      setMember(card);
      setPoints(0);
      setError(null);
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });

  const quote = trpc.loyalty.posQuote.useQuery(
    { saleId: saleId ?? "", memberId: member?.memberId ?? "", points },
    { enabled: open && Boolean(saleId && member), retry: false, refetchOnWindowFocus: false },
  );

  const requestConsent = trpc.loyalty.posRequestConsent.useMutation({
    onSuccess: (result) => setConsentId(result.id),
    onError: (caught) => setError(reportError(errors, caught)),
  });
  const consent = trpc.loyalty.posConsentStatus.useQuery({ id: consentId ?? "" }, { enabled: open && Boolean(consentId), refetchInterval: 2000 });

  const apply = trpc.loyalty.posApply.useMutation({
    onSuccess: async (result) => {
      toast({
        description: t("applied", { points: result.pointsSpent, earn: result.earnPoints }),
        variant: "success",
      });
      await utils.pos.sales.get.invalidate({ saleId: saleId ?? undefined });
      onApplied?.();
      onOpenChange(false);
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });

  const release = trpc.loyalty.posRelease.useMutation({
    onSuccess: async () => {
      await utils.pos.sales.get.invalidate({ saleId: saleId ?? undefined });
      onApplied?.();
      onOpenChange(false);
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });

  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : formatKgsMoney(value, locale, baseAccountingCurrency);
  const maxPoints = quote.data?.maxRedeemPoints ?? 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("dialogTitle")}
      subtitle={t("dialogSubtitle")}
      mobileSheet
    >
      <div className="space-y-4">
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("scanLabel")}</span>
          <div className="flex gap-2">
            <Input
              value={token}
              autoFocus
              placeholder={t("scanPlaceholder")}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && token.trim()) {
                  event.preventDefault();
                  resolve.mutate({ token: token.trim() });
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!token.trim() || resolve.isLoading}
              onClick={() => resolve.mutate({ token: token.trim() })}
            >
              {t("find")}
            </Button>
          </div>
        </label>

        {member && quote.data ? (
          <>
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{member.displayName ?? t("member")}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <div><dt className="text-xs text-muted-foreground">{t("originalTotal")}</dt><dd className="font-semibold">{money(quote.data.originalKgs)}</dd></div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("memberDiscount")}</dt>
                  <dd className="font-semibold">{quote.data.memberDiscountKgs > 0 ? money(quote.data.memberDiscountKgs) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("availablePoints")}</dt>
                  <dd className="font-semibold tabular-nums">{quote.data.balancePoints}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("maxRedeem")}</dt>
                  <dd className="font-semibold tabular-nums">{maxPoints}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("willEarn")}</dt>
                  <dd className="font-semibold tabular-nums">{quote.data.earnPoints}</dd>
                </div>
              </dl>
            </div>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{t("redeemLabel")}</span>
              <Input
                type="number"
                min={0}
                max={maxPoints}
                value={points}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(maxPoints, Math.floor(Number(event.target.value) || 0)));
                  setConsentId(null);
                  setPoints(next);
                }}
              />
            </label>
            <p className="text-sm">
              {t("payable")}: <span className="font-semibold tabular-nums">{money(quote.data.payableKgs)}</span>
            </p>
          </>
        ) : null}

        {points > 0 && member && saleId ? <div className="space-y-2 text-sm">
          <p>{t("consentHint")}</p>
          <Button variant="secondary" disabled={requestConsent.isLoading || Boolean(consentId && !consent.data?.expired)} onClick={() => requestConsent.mutate({saleId, memberId: member.memberId, points})}>{t("consentRequest")}</Button>
          {consentId ? <p role="status">{t(consent.data?.expired ? "consentExpired" : consent.data?.approved ? "consentApproved" : "consentWaiting")}</p> : null}
        </div> : null}
        {quote.error ? <p role="alert" className="text-sm text-danger">{reportError(errors, quote.error)}</p> : null}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          {saleId ? (
            <Button
              type="button"
              variant="secondary"
              disabled={release.isLoading}
              onClick={() => saleId && release.mutate({ saleId })}
            >
              {t("remove")}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!member || !saleId || !quote.data || Boolean(quote.error) || quote.isFetching || apply.isLoading || (points > 0 && !consent.data?.approved)}
            onClick={() => saleId && member && apply.mutate({ saleId, memberId: member.memberId, points, consentId: consentId ?? undefined })}
          >
            {t("apply")}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
