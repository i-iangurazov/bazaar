"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { CameraScanButton } from "@/components/camera-scan-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatKgsMoney, type CurrencySource } from "@/lib/currencyDisplay";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";
import type { PosLoyaltySummary } from "./loyalty-panel";

type Member = {
  memberId: string;
  displayName: string | null;
  email?: string | null;
  phone?: string | null;
};

/** Cashier workflow stays in POS; customer approval happens on their own card. */
export function LoyaltyDialog({
  open,
  onOpenChange,
  saleId,
  storeId,
  signupId,
  summary,
  currencySource,
  customerContact,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string | null;
  storeId?: string;
  signupId?: string | null;
  summary?: PosLoyaltySummary;
  currencySource?: CurrencySource;
  customerContact?: string | null;
  onApplied?: () => void;
}) {
  const t = useTranslations("loyalty");
  const common = useTranslations("common");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [method, setMethod] = useState<"contact" | "qr">("contact");
  const [contact, setContact] = useState(customerContact ?? "");
  const [token, setToken] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [points, setPoints] = useState(0);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSignup, setShowSignup] = useState(false);
  const [matches, setMatches] = useState<Member[] | null>(null);

  // Reopening keeps the participant, but requires fresh consent for a new calculation.
  // The component is keyed by receipt, so a new sale never inherits the previous card.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    if (summary?.member) setMember(summary.member);
    setPoints(summary?.status === "APPLIED" ? summary.pointsSpent : 0);
    setConsentId(null);
    setError(null);
    setContact(customerContact ?? "");
  }, [open, summary, customerContact]);

  const selectMember = (next: Member) => {
    setMember(next);
    setPoints(0);
    setConsentId(null);
    setError(null);
    setMatches(null);
    setShowSignup(false);
  };
  const resolve = trpc.loyalty.posResolveCard.useMutation({
    onSuccess: selectMember,
    onError: (caught) => setError(reportError(errors, caught)),
  });
  const lookup = trpc.loyalty.posLookupMember.useMutation({
    onSuccess: (result) => {
      setError(null);
      if (result.length === 1) selectMember(result[0]);
      else setMatches(result);
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });
  const quote = trpc.loyalty.posQuote.useQuery(
    { saleId: saleId ?? "", memberId: member?.memberId ?? "", points },
    {
      enabled: open && Boolean(saleId && member),
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const requestConsent = trpc.loyalty.posRequestConsent.useMutation({
    onSuccess: (result) => {
      setConsentId(result.id);
      setError(null);
    },
    onError: (caught) => setError(reportError(errors, caught)),
  });
  const consent = trpc.loyalty.posConsentStatus.useQuery(
    { id: consentId ?? "" },
    {
      enabled: open && Boolean(consentId),
      refetchInterval: 2000,
      retry: false,
    },
  );
  const applied = async () => {
    await utils.pos.sales.get.invalidate({ saleId: saleId ?? undefined });
    onApplied?.();
    onOpenChange(false);
  };
  const apply = trpc.loyalty.posApply.useMutation({
    onSuccess: async (result) => {
      toast({
        description: t("applied", { points: result.pointsSpent, earn: result.earnPoints }),
        variant: "success",
      });
      await applied();
    },
    onError: (caught) => {
      setConsentId(null);
      setError(reportError(errors, caught));
    },
  });
  const release = trpc.loyalty.posRelease.useMutation({
    onSuccess: applied,
    onError: (caught) => setError(reportError(errors, caught)),
  });
  const money = (value: number) => formatKgsMoney(value, locale, currencySource);
  const busy = apply.isLoading || release.isLoading || requestConsent.isLoading;
  const finding = lookup.isLoading || resolve.isLoading;
  const maxPoints = quote.data?.maxRedeemPoints ?? 0;
  const quoteReady = Boolean(
    quote.data && !quote.error && !quote.isFetching && quote.data.redeemPoints === points,
  );
  const changePoints = (next: number) => {
    setPoints(next);
    setConsentId(null);
    setError(null);
  };
  const scan = (value: string) => {
    setToken(value);
    setError(null);
    resolve.mutate({ token: value.trim() });
  };
  const find = () => {
    setError(null);
    if (method === "qr" && token.trim()) scan(token);
    else if (storeId && contact.trim()) lookup.mutate({ storeId, contact: contact.trim() });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={t("dialogTitle")}
      subtitle={t("posDialogSubtitle")}
      mobileSheet
    >
      <div className="space-y-4">
        {summary?.status === "RELEASED" ? (
          <p className="rounded-lg bg-muted/40 p-3 text-sm" role="status">
            {t("posReleased")}
          </p>
        ) : summary?.status === "APPLIED" ? (
          <p className="rounded-lg bg-muted/40 p-3 text-sm" role="status">
            {t("posAppliedSummary", { spent: summary.pointsSpent, earn: summary.plannedPoints })}
          </p>
        ) : null}
        {!member ? (
          <>
            <div className="flex gap-2" aria-label={t("posLookupMethod")}>
              <Button
                type="button"
                size="sm"
                variant={method === "contact" ? "primary" : "secondary"}
                aria-pressed={method === "contact"}
                onClick={() => {
                  setMethod("contact");
                  setError(null);
                }}
              >
                {t("posContactTab")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={method === "qr" ? "primary" : "secondary"}
                aria-pressed={method === "qr"}
                onClick={() => {
                  setMethod("qr");
                  setError(null);
                }}
              >
                {t("posQrTab")}
              </Button>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t(method === "contact" ? "posContactLabel" : "scanLabel")}</span>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={method === "contact" ? contact : token}
                  disabled={finding}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t(
                    method === "contact" ? "posContactPlaceholder" : "scanPlaceholder",
                  )}
                  onChange={(event) => {
                    if (method === "contact") setContact(event.target.value);
                    else setToken(event.target.value);
                    setMatches(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!finding) find();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    finding || !(method === "contact" ? contact.trim().length >= 4 : token.trim())
                  }
                  onClick={find}
                >
                  {finding ? <Spinner className="h-4 w-4" /> : t("find")}
                </Button>
              </div>
            </label>
            {method === "qr" ? (
              <CameraScanButton disabled={finding} onScan={scan} />
            ) : (
              <p className="text-xs text-muted-foreground">{t("posContactHint")}</p>
            )}
            {matches?.length === 0 ? (
              <p role="status" className="text-sm">
                {t("posNotFound")}
              </p>
            ) : matches ? (
              <div className="space-y-2">
                {matches.map((match) => (
                  <Button
                    key={match.memberId}
                    type="button"
                    variant="secondary"
                    className="h-auto w-full whitespace-normal py-2"
                    onClick={() => selectMember(match)}
                  >
                    {match.displayName ?? t("member")}
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("member")}</p>
                <p className="break-words font-semibold">{member.displayName ?? t("member")}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setMember(null);
                  setPoints(0);
                  setConsentId(null);
                  setError(null);
                }}
              >
                {t("posChangeMember")}
              </Button>
            </div>
            {quote.isFetching ? (
              <p className="flex items-center gap-2 text-sm" role="status">
                <Spinner className="h-4 w-4" />
                {common("loading")}
              </p>
            ) : null}
            {quote.data ? (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("availablePoints")}</dt>
                    <dd className="text-xl font-semibold tabular-nums">
                      {quote.data.balancePoints}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("maxRedeem")}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{maxPoints}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("originalTotal")}</dt>
                    <dd>{money(quote.data.originalKgs)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("loyaltyMemberDiscount")}</dt>
                    <dd>{money(quote.data.memberDiscountKgs)}</dd>
                  </div>
                </dl>
                <div className="space-y-2">
                  <label className="block space-y-1.5 text-sm font-medium">
                    <span>{t("redeemLabel")}</span>
                    <Input
                      type="number"
                      min={0}
                      max={maxPoints}
                      step={1}
                      value={points}
                      disabled={busy || quote.isFetching || Boolean(quote.error) || !maxPoints}
                      onChange={(event) =>
                        changePoints(
                          Math.max(
                            0,
                            Math.min(maxPoints, Math.floor(Number(event.target.value) || 0)),
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => changePoints(0)}
                    >
                      {t("posEarnOnly")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy || quote.isFetching || Boolean(quote.error) || !maxPoints}
                      onClick={() => changePoints(maxPoints)}
                    >
                      {t("posUseMax", { points: maxPoints })}
                    </Button>
                  </div>
                  {!maxPoints ? (
                    <p className="text-xs text-muted-foreground">{t("posNoRedemption")}</p>
                  ) : null}
                  {points !== quote.data.redeemPoints ? (
                    <p role="alert" className="text-sm text-danger">
                      {t("posInvalidPoints")}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{t("posPointsValue")}</span>
                    <span>{money(quote.data.redeemValueKgs)}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-2 font-semibold">
                    <span>{t("payable")}</span>
                    <span>{money(quote.data.payableKgs)}</span>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {t("willEarn")}: {quote.data.earnPoints}
                  </p>
                </div>
              </>
            ) : null}
          </>
        )}

        {points > 0 && member && saleId ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <p>{t("posConsentSteps")}</p>
            <Button
              type="button"
              variant="secondary"
              className="h-auto min-h-10 whitespace-normal"
              disabled={busy || !quoteReady || Boolean(consentId && !consent.data?.expired)}
              onClick={() => requestConsent.mutate({ saleId, memberId: member.memberId, points })}
            >
              {t("consentRequest")}
            </Button>
            {consentId ? (
              <p role="status" className="font-medium">
                {t(
                  consent.data?.expired
                    ? "consentExpired"
                    : consent.data?.approved
                      ? "consentApproved"
                      : "consentWaiting",
                )}
              </p>
            ) : null}
            {consent.error ? (
              <p role="alert" className="text-danger">
                {reportError(errors, consent.error)}
              </p>
            ) : null}
          </div>
        ) : null}

        {!member && signupId ? (
          <div className="rounded-lg border border-border p-3 text-sm">
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full whitespace-normal"
              onClick={() => setShowSignup((current) => !current)}
              aria-expanded={showSignup}
            >
              {t("posRegister")}
            </Button>
            {showSignup ? (
              <div className="mt-3 space-y-2 text-center">
                <Image
                  src={`/api/loyalty/qr/store/${signupId}`}
                  alt={t("posSignupQr")}
                  width={220}
                  height={220}
                  unoptimized
                  className="mx-auto rounded-md bg-white"
                />
                <p>{t("posSignupHint")}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {quote.error ? (
          <p role="alert" className="text-sm text-danger">
            {reportError(errors, quote.error)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          {summary?.status === "APPLIED" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => saleId && release.mutate({ saleId })}
            >
              {t("remove")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("close")}
            </Button>
          )}
          <Button
            type="button"
            disabled={
              !member || !saleId || !quoteReady || busy || (points > 0 && !consent.data?.approved)
            }
            onClick={() =>
              saleId &&
              member &&
              apply.mutate({
                saleId,
                memberId: member.memberId,
                points,
                consentId: consentId ?? undefined,
              })
            }
          >
            {busy ? <Spinner className="h-4 w-4" /> : t("apply")}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
