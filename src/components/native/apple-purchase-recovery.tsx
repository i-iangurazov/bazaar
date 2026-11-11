"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  addAppleTransactionListener,
  finishAppleTransaction,
  getUnfinishedAppleTransactions,
  isAppleBillingAvailable,
  retryAppleCancellations,
} from "@/lib/native/appleBilling";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/** Paid transactions survive navigation, a closed checkout and app restarts. */
export function ApplePurchaseRecovery() {
  const { status, data: session } = useSession();
  const queryClient = useQueryClient();
  const t = useTranslations("billingApple");
  const confirm = trpc.billing.apple.confirm.useMutation();
  const confirmRef = useRef(confirm.mutateAsync);
  confirmRef.current = confirm.mutateAsync;
  const [needsRetry, setNeedsRetry] = useState(false);
  const [cancellationPending, setCancellationPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status !== "authenticated" || session?.user?.role !== "ADMIN" || !isAppleBillingAvailable())
      return;
    let active = true;
    let busy = false;
    let requested = false;
    let removeListener: (() => Promise<void>) | undefined;
    const drain = async () => {
      if (!active || document.hidden || navigator.onLine === false) return;
      if (busy) {
        requested = true;
        return;
      }
      busy = true;
      let changed = false;
      let furtherChanges = false;
      const refreshConfirmed = () => {
        if (changed) furtherChanges = true;
        else { changed = true; void queryClient.invalidateQueries(); }
      };
      try {
        let cancelFailed = false;
        let cancellationCheckFailed = false;
        try {
          const cancellations = await retryAppleCancellations();
          cancelFailed = cancellations.pendingCount > 0;
          if (active && (cancellations.acknowledgedCount > 0 || cancellations.recordedCount > 0)) refreshConfirmed();
        } catch { cancellationCheckFailed = true; }
        if (!active) return;
        const unfinished = await getUnfinishedAppleTransactions();
        let failed = cancellationCheckFailed || unfinished.unverifiedTransactionIds.length > 0;
        for (const transaction of unfinished.transactions) {
          if (!active) break;
          try {
            await confirmRef.current({ signedTransactionInfo: transaction.signedTransactionInfo });
            if (!active) break;
            refreshConfirmed();
            // Native independently requires the durable authorized server ACK;
            // JavaScript cannot grant access or discard an unrecorded payment.
            await finishAppleTransaction(transaction.transactionId);
          } catch {
            failed = true;
          }
        }
        if (active) { setCancellationPending(cancelFailed && !failed); setNeedsRetry(failed || cancelFailed); }
      } catch {
        if (active) setNeedsRetry(true);
      } finally {
        busy = false;
        if (active && furtherChanges) await queryClient.invalidateQueries();
        if (active && requested) {
          requested = false;
          void drain();
        }
      }
    };
    const resume = () => {
      void drain();
    };
    void addAppleTransactionListener((event) => {
      if (!active) return;
      if (event.error) setNeedsRetry(true);
      else resume();
    })
      .then((listener) => {
        if (active) removeListener = () => listener.remove();
        else void listener.remove();
      })
      .catch(() => {
        if (active) setNeedsRetry(true);
      });
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("bazaar:apple-retry", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      active = false;
      void removeListener?.();
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("bazaar:apple-retry", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [
    status,
    session?.user?.id,
    session?.user?.organizationId,
    session?.user?.role,
    queryClient,
    attempt,
  ]);

  if (!needsRetry || status !== "authenticated" || session?.user?.role !== "ADMIN") return null;
  return (
    <aside
      role="status"
      data-native-apple-recovery
      className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.75rem)] z-[940] mx-auto max-w-md rounded-lg border border-warning/40 bg-background p-4 shadow-xl"
    >
      <p className="text-sm">{t(cancellationPending ? "cancellationPending" : "recoveryHint")}</p>
      <Button variant="secondary" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>
        {t("retry")}
      </Button>
    </aside>
  );
}
