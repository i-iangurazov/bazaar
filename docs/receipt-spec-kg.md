# Receipt Print Spec (KG)

This document defines what we print on POS receipts in Kyrgyzstan, using truthful source data only.

## Scope

- `PRECHECK` is always printable after sale completion.
- `FISCAL` receipt is printable only when fiscalization status is `SENT`.
- The system does not invent fiscal identifiers. Missing provider data is omitted.
- This is an implementation spec, not a legal certification statement.

## Field Mapping

| Printed field | Source | Rule |
| --- | --- | --- |
| Store/company name | `Store.legalName` fallback `Store.name` | Always print |
| INN | `Store.inn` | Print when configured |
| Transaction address | `Store.address` | Print when configured |
| Phone | `Store.phone` | Print when configured |
| Receipt number (sequential) | `CustomerOrder.number` | Always print |
| Purchase date/time | `CustomerOrder.completedAt` fallback `createdAt` | Always print |
| Cashier | `CustomerOrder.createdBy.name` | Print when available |
| Register | `PosRegister.name + code` | Print when available |
| Shift | `RegisterShift.id` | Print when available |
| Line items | `CustomerOrder.lines` + `Product` | Always print |
| Total amount | `CustomerOrder.totalKgs` | Always print |
| Payment breakdown | `SalePayment` | Print when available |
| KKM factory number | `FiscalReceipt.kkmFactoryNumber` / provider payload | Fiscal only, if available |
| KKM registration number | `FiscalReceipt.kkmRegistrationNumber` / provider payload | Fiscal only, if available |
| Fiscal mode status | `FiscalReceipt.fiscalModeStatus` fallback `CustomerOrder.kkmStatus` | Always shown in fiscal block |
| Fiscal number | `FiscalReceipt.fiscalNumber` | Fiscal only, if available |
| QR payload | `FiscalReceipt.qrPayload` fallback `FiscalReceipt.qr` / provider payload | Fiscal only, if available |
| UPFD / fiscal memory ref | `FiscalReceipt.upfdOrFiscalMemory` / provider payload | Fiscal only, if available |
| Fiscalized timestamp | `FiscalReceipt.fiscalizedAt` fallback `sentAt` | Fiscal only, if available |

## Status Behavior

| `kkmStatus` | Allowed print actions | Printed status block |
| --- | --- | --- |
| `NOT_SENT` | Precheck | `ПРЕДЧЕК (НЕФИСКАЛЬНЫЙ)` + `Not sent` status |
| `FAILED` | Precheck | `ПРЕДЧЕК (НЕФИСКАЛЬНЫЙ)` + `Failed` status + retry hint |
| `SENT` | Precheck + Fiscal | Fiscal block with provider fields that exist |

## Layout Order

1. Header: legal/store name, INN, address, phone.
2. Receipt meta: number, date/time, cashier/register/shift.
3. Precheck banner (for `PRECHECK` only).
4. Items: name, qty x price, line total.
5. Totals + payment breakdown.
6. Fiscal block:
   - Always prints fiscal status.
   - For `FISCAL`, prints optional KKM/fiscal identifiers and QR if available.
   - No fake QR; no fabricated KKM numbers.

## Operational Notes

- If fiscalization fails, managers/admins can retry fiscalization; cashiers keep printing precheck.
- Receipt PDF uses embedded Unicode font and 58mm print-safe layout.
- API routes:
  - `GET /api/pos/receipts/:id/pdf?kind=precheck`
  - `GET /api/pos/receipts/:id/pdf?kind=fiscal` (returns conflict if not fiscalized)
