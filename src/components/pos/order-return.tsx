"use client";
import { parseQuantity, roundQuantity } from "@/lib/quantity";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";

type Method = "CASH" | "CARD" | "TRANSFER" | "OTHER";
type ReturnLine = { id: string; name: string; qty: number; returnedQty: number; lineTotalKgs: number; refundedKgs: number };
export function OrderReturn({ customerOrderId, lines, shifts, onReturned }: { customerOrderId: string; lines: ReturnLine[]; shifts: { id: string; name: string }[]; onReturned: () => void }) {
  const t = useTranslations("salesOrders.refund"); const errors = useTranslations("errors");
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({}); const [shiftId, setShiftId] = useState(""); const [method, setMethod] = useState<Method>("CASH");
  const [draft, setDraft] = useState<{ id: string; totalKgs: number } | null>(null);
  const attempt = useRef<{ idempotencyKey: string; shiftId: string; originalSaleId: string; quantities: Record<string, number>; draftId?: string } | null>(null);
  const payload = useRef<{ saleReturnId: string; idempotencyKey: string; payments: Array<{ method: Method; amountKgs: number }> } | null>(null);
  const create = trpc.pos.returns.createDraft.useMutation(); const add = trpc.pos.returns.addLine.useMutation(); const complete = trpc.pos.returns.complete.useMutation(); const cancel = trpc.pos.returns.cancel.useMutation();
  const available = lines.filter(line => line.qty > line.returnedQty);
  const selectedShift = shiftId || shifts[0]?.id || "";
  const message = (caught: unknown) => caught instanceof Error && errors.has(caught.message) ? errors(caught.message) : errors("unexpectedError");
  const finish = (manualRequired = false) => { setDraft(null); setOpen(false); setQuantities({}); attempt.current = null; payload.current = null; setNotice(manualRequired ? t("manualRequired") : t("success")); onReturned(); };
  const ensureDraft = async () => {
    attempt.current ??= { idempotencyKey: crypto.randomUUID(), originalSaleId: customerOrderId, shiftId: selectedShift, quantities: { ...quantities } };
    const a = attempt.current;
    if (!a.draftId) a.draftId = (await create.mutateAsync({ idempotencyKey: a.idempotencyKey, originalSaleId: a.originalSaleId, shiftId: a.shiftId })).id;
    return a;
  };
  const prepare = async () => {
    setBusy(true); setError("");
    try {
      const a = await ensureDraft();
      let fresh = await utils.pos.returns.get.fetch({ saleReturnId: a.draftId! }, { staleTime: 0 });
      if (!fresh || fresh.status !== "DRAFT") throw new Error("posReturnNotEditable");
      for (const [lineId, qty] of Object.entries(a.quantities)) {
        if (qty <= 0) continue;
        const existing = fresh.lines.find(line => line.customerOrderLineId === lineId);
        if (existing && existing.qty !== qty) throw new Error("posReturnAmountChanged");
        if (!existing) await add.mutateAsync({ saleReturnId: fresh.id, customerOrderLineId: lineId, qty });
      }
      fresh = await utils.pos.returns.get.fetch({ saleReturnId: fresh.id }, { staleTime: 0 });
      if (!fresh) throw new Error("posReturnNotFound");
      setDraft({ id: fresh.id, totalKgs: fresh.totalKgs });
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  };
  const close = async () => {
    if (busy) return; setBusy(true); setError("");
    try {
      if (attempt.current) {
        const a = await ensureDraft(); const fresh = await utils.pos.returns.get.fetch({ saleReturnId: a.draftId! }, { staleTime: 0 });
        if (fresh?.status === "COMPLETED") { finish(fresh.refundRequests.some(request => request.status === "OPEN")); return; }
        if (fresh?.status === "DRAFT") await cancel.mutateAsync({ saleReturnId: a.draftId!, idempotencyKey: `cancel:${a.draftId}` });
      }
      setDraft(null); setOpen(false); setQuantities({}); attempt.current = null; payload.current = null;
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  };
  if (!available.length && !open && !notice) return null;
  return <>
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {available.length ? <Button variant="secondary" onClick={() => setOpen(true)}>{t("title")}</Button> : null}
    <Modal open={open} onOpenChange={value => { if (!value) void close(); }} title={t("title")}>
      <div className="space-y-3">
        {!shifts.length ? <p>{t("openShiftRequired")}</p> : null}
        <label className="block text-sm">{t("register")}<select className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={selectedShift} disabled={busy || Boolean(attempt.current)} onChange={event => setShiftId(event.target.value)}>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select></label>
        {available.map(line => <label key={line.id} className="flex items-center justify-between gap-3 text-sm"><span>{line.name} ({t("available", { qty: roundQuantity(line.qty - line.returnedQty) })})</span><Input className="w-24" type="number" min={0} max={roundQuantity(line.qty - line.returnedQty)} step={0.001} disabled={busy || Boolean(attempt.current)} value={quantities[line.id] ?? 0} onChange={event => setQuantities(current => ({ ...current, [line.id]: Math.min(roundQuantity(line.qty - line.returnedQty), Math.max(0, parseQuantity(event.target.value) ?? 0)) }))} /></label>)}
        {draft ? <><p className="font-semibold">{t("actualRefund", { amount: draft.totalKgs })}</p><p className="text-sm">{t("moneyHint")}</p><label className="block text-sm">{t("method")}<select className="mt-1 h-10 w-full rounded-md border bg-background px-2" disabled={busy || Boolean(payload.current)} value={method} onChange={event => setMethod(event.target.value as Method)}>{(["CASH", "CARD", "TRANSFER", "OTHER"] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></> : null}
        {error ? <p role="alert" className="text-danger">{error}</p> : null}
        <ModalFooter><Button variant="ghost" disabled={busy} onClick={() => void close()}>{t("cancel")}</Button>{draft ? <Button disabled={busy} onClick={async () => {
          setBusy(true); setError(""); payload.current ??= { saleReturnId: draft.id, idempotencyKey: crypto.randomUUID(), payments: draft.totalKgs ? [{ method, amountKgs: draft.totalKgs }] : [] };
          try { const result = await complete.mutateAsync(payload.current); finish(Boolean(result.manualRequired)); }
          catch (caught) { setError(message(caught)); }
          finally { setBusy(false); }
        }}>{t(payload.current ? "retry" : "confirm")}</Button> : <Button disabled={busy || !selectedShift || !Object.values(quantities).some(qty => qty > 0)} onClick={() => void prepare()}>{t(attempt.current ? "retry" : "calculate")}</Button>}</ModalFooter>
      </div>
    </Modal>
  </>;
}
