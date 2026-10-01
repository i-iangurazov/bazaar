"use client";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function CustomerLoyaltyHistory({ customerId }: { customerId: string }) {
  const t = useTranslations("loyalty"); const locale = useLocale();
  const common = useTranslations("common"); const errors = useTranslations("errors");
  const { data: session } = useSession();
  const permitted = ["ADMIN", "MANAGER", "CASHIER"].includes(session?.user?.role ?? "");
  const query = trpc.loyalty.customerHistory.useQuery({ customerId }, { enabled: permitted });
  if (!permitted) return null;
  if (query.isLoading) return <p role="status" className="text-sm text-muted-foreground">{common("loading")}</p>;
  if (query.error) return <div className="space-y-2"><p role="alert" className="text-sm text-danger">{errors.has(query.error.message) ? errors(query.error.message) : errors("genericMessage")}</p><Button variant="secondary" onClick={() => void query.refetch()}>{common("tryAgain")}</Button></div>;
  if (!query.data) return null;
  const { balancePoints, availablePoints, history } = query.data;
  return <section className="space-y-3 rounded-xl border p-3">
    <h3 className="text-sm font-semibold">{t("programme")}</h3>
    <p className="text-sm">{t("balance")}: {balancePoints} · {t("availablePoints")}: {availablePoints}</p>
    <ul className="max-h-64 divide-y overflow-auto">{history.map((entry) => <li key={entry.id} className="flex justify-between gap-2 py-2 text-sm">
      <div>{t(`ledger.${entry.type}`)}<span className="ml-2 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString(locale === "kg" ? "ky-KG" : locale)}</span>
        {entry.href && entry.reference ? <Link className="ml-2 underline" href={entry.href} target="_blank">{entry.reference}</Link> : null}
      </div><span className="tabular-nums">{entry.points > 0 ? "+" : ""}{entry.points}</span>
    </li>)}</ul>
    {!history.length ? <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p> : null}
  </section>;
}
