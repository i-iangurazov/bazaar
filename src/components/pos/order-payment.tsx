"use client";
import { OrderReturn } from "./order-return";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function OrderPayment({ customerOrderId, onPaid }: { customerOrderId: string; onPaid: () => void }) {
  const t = useTranslations("salesOrders.payment"); const errors = useTranslations("errors");
  const { data: session } = useSession();
  const query = trpc.salesOrders.paymentInfo.useQuery({ customerOrderId });
  const [shiftId, setShiftId] = useState(""); const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD" | "TRANSFER" | "OTHER">("CASH");
  const [submitted, setSubmitted] = useState(false); const key = useRef<string | null>(null);
  const pay = trpc.salesOrders.recordPayment.useMutation({ onSuccess: () => { setSubmitted(false); key.current = null; setAmount(""); void query.refetch(); onPaid(); }, onError: (error) => { if (error.data?.httpStatus && error.data.httpStatus < 500 && !["requestInProgress", "idempotencyKeyPayloadMismatch"].includes(error.message)) { setSubmitted(false); key.current = null; } } });
  const data = query.data;
  if (!data) return query.error ? <p role="alert">{reportError(errors, query.error)}</p> : null;
  const canRecord = ["ADMIN", "MANAGER", "CASHIER"].includes(session?.user?.role ?? "");
  const selectedShift = shiftId || data.shifts[0]?.id || "";
  const amountKgs = amount === "" ? data.remainingKgs : Number(amount);
  return <Card><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-3">
    <p>{data.hasEvidence ? t("received", { amount: data.paidKgs }) : t("unknown")}</p>
    {canRecord && data.canPay && data.remainingKgs > 0 ? <>
      <p className="text-sm text-muted-foreground">{t("actualMoney")}</p>
      {!data.shifts.length ? <p>{t("openShiftRequired")}</p> : <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">{t("register")}<select className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={selectedShift} disabled={submitted} onChange={(e) => setShiftId(e.target.value)}>{data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select></label>
        <label className="text-sm">{t("method")}<select className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={method} disabled={submitted} onChange={(e) => setMethod(e.target.value as typeof method)}>{(["CASH", "CARD", "TRANSFER", "OTHER"] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label className="text-sm">{t("amountKgs")}<Input type="number" step="0.01" min="0.01" max={data.remainingKgs} value={amount || data.remainingKgs} disabled={submitted} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>}
      <Button disabled={pay.isLoading || !selectedShift || !(amountKgs > 0 && amountKgs <= data.remainingKgs)} onClick={() => { key.current ??= crypto.randomUUID(); setSubmitted(true); pay.mutate({ customerOrderId, shiftId: selectedShift, method, amountKgs, idempotencyKey: key.current }); }}>{t(submitted ? "retry" : "confirm")}</Button>
      {pay.error ? <p role="alert" className="text-destructive">{reportError(errors, pay.error)}</p> : null}
    </> : null}
    {canRecord && data.canReturn ? <OrderReturn customerOrderId={customerOrderId} lines={data.returnLines} shifts={data.shifts} onReturned={() => { void query.refetch(); onPaid(); }} /> : null}
  </CardContent></Card>;
}
