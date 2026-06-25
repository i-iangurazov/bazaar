import type { ProductMovementDocumentDetail } from "@/server/services/productMovements";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";

export type MovementPrintDocumentLabels = {
  companyFallback: string;
  documentNumber: string;
  date: string;
  status: string;
  sourceStore: string;
  destinationStore: string;
  receivingStore: string;
  writeOffStore: string;
  sender: string;
  author: string;
  reason: string;
  comment: string;
  product: string;
  skuBarcode: string;
  unit: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
  positions: string;
  amount: string;
  costNotSpecified: string;
  shippedBy: string;
  releasedBy: string;
  writtenOffBy: string;
  receivedBy: string;
  checkedBy: string;
  responsible: string;
  signatureDate: string;
  notAvailable: string;
  statusLabel: string;
  title: string;
};

type MovementPrintDocumentProps = {
  document: ProductMovementDocumentDetail;
  labels: MovementPrintDocumentLabels;
  locale: string;
};

export const getMovementPrintDocumentNumber = (document: ProductMovementDocumentDetail) =>
  document.documentNumber && document.documentNumber !== document.documentId
    ? document.documentNumber
    : `${document.documentType === "TRANSFER" ? "TRF" : document.documentType === "WRITE_OFF" ? "WOF" : "RCV"}-${document.createdAt
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "")}-${document.documentId.slice(0, 8).toUpperCase()}`;

const getPrintableLines = (document: ProductMovementDocumentDetail) => {
  if (document.documentType !== "TRANSFER") {
    return document.lines;
  }

  const outgoing = document.lines.filter((line) => line.movementType === "TRANSFER_OUT");
  return outgoing.length
    ? outgoing
    : document.lines.filter((line) => line.movementType === "TRANSFER_IN");
};

const isReceivingDocument = (document: ProductMovementDocumentDetail) =>
  document.documentType === "STOCK_RECEIVING" || document.documentType === "RECEIVE";

const formatMaybeMoney = (value: number | null | undefined, locale: string, fallback: string) =>
  typeof value === "number" ? formatCurrencyKGS(value, locale) : fallback;

const productSecondaryText = (
  line: ProductMovementDocumentDetail["lines"][number],
  labels: MovementPrintDocumentLabels,
) => {
  const references = [line.sku, line.barcode].filter(Boolean);
  return references.length ? `${labels.skuBarcode}: ${references.join(" / ")}` : null;
};

export const MovementPrintDocument = ({ document, labels, locale }: MovementPrintDocumentProps) => {
  const lines = getPrintableLines(document);
  const showMoneyColumns =
    isReceivingDocument(document) &&
    (document.totalAmount !== null ||
      lines.some((line) => line.unitCostKgs !== null || line.lineTotalKgs !== null));
  const totalAmount = showMoneyColumns
    ? (document.totalAmount ??
      lines.reduce((sum, line) => sum + (line.lineTotalKgs ?? 0), 0))
    : null;
  const totalQuantity = lines.reduce((sum, line) => sum + Math.abs(line.qtyDelta), 0);
  const senderLabel =
    document.documentType === "TRANSFER"
      ? labels.sourceStore
      : document.documentType === "WRITE_OFF"
        ? labels.writeOffStore
        : labels.sender;
  const recipientLabel =
    document.documentType === "TRANSFER" ? labels.destinationStore : labels.receivingStore;
  const senderValue =
    document.documentType === "WRITE_OFF"
      ? document.storeName || labels.notAvailable
      : document.senderName || labels.notAvailable;
  const recipientValue = document.recipientName || document.storeName || labels.notAvailable;
  const firstSignatureLabel =
    document.documentType === "TRANSFER"
      ? labels.releasedBy
      : document.documentType === "WRITE_OFF"
        ? labels.writtenOffBy
        : labels.shippedBy;
  const secondSignatureLabel =
    document.documentType === "WRITE_OFF" ? labels.checkedBy : labels.receivedBy;
  const hasReason = Boolean(document.reason?.trim());
  const hasComment = Boolean((document.comment || document.description)?.trim());

  return (
    <section className="movement-print-sheet" aria-label={labels.title}>
      <style>{`
        .movement-print-sheet {
          width: 210mm;
          max-width: calc(100vw - 24px);
          min-height: 297mm;
          margin: 12px auto;
          padding: 14mm;
          color: #111827;
          background: #ffffff;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.14);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        .movement-print-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 54mm;
          gap: 10mm;
          align-items: start;
          padding-bottom: 7mm;
          border-bottom: 1px solid #d1d5db;
        }

        .movement-print-company {
          margin: 0 0 2mm;
          color: #4b5563;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .movement-print-title {
          margin: 0;
          font-size: 22px;
          line-height: 1.12;
          font-weight: 700;
        }

        .movement-print-number {
          margin: 2.5mm 0 0;
          color: #111827;
          font-size: 12px;
          font-weight: 700;
        }

        .movement-print-stamp {
          border: 1px solid #d1d5db;
        }

        .movement-print-stamp-row {
          display: grid;
          grid-template-columns: 20mm 1fr;
          min-height: 9mm;
          border-bottom: 1px solid #d1d5db;
        }

        .movement-print-stamp-row:last-child {
          border-bottom: 0;
        }

        .movement-print-stamp-label,
        .movement-print-stamp-value {
          padding: 2mm;
        }

        .movement-print-stamp-label {
          border-right: 1px solid #d1d5db;
          color: #4b5563;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .movement-print-stamp-value {
          font-size: 10.5px;
          font-weight: 700;
          text-align: right;
        }

        .movement-print-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 3mm 8mm;
          margin-top: 7mm;
        }

        .movement-print-meta dt,
        .movement-print-meta dd {
          margin: 0;
        }

        .movement-print-meta-item {
          display: grid;
          grid-template-columns: 34mm minmax(0, 1fr);
          gap: 3mm;
          min-height: 6mm;
        }

        .movement-print-meta-label {
          color: #4b5563;
          font-weight: 700;
        }

        .movement-print-comment {
          grid-column: 1 / -1;
        }

        .movement-print-table {
          width: 100%;
          margin-top: 8mm;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 10.5px;
          line-height: 1.3;
        }

        .movement-print-table th,
        .movement-print-table td {
          border: 1px solid #d1d5db;
          color: #111827;
          padding: 2.2mm 2mm;
          vertical-align: top;
        }

        .movement-print-table th {
          background: #f3f4f6;
          color: #374151;
          font-size: 9px;
          font-weight: 700;
          text-align: left;
          text-transform: uppercase;
        }

        .movement-print-table th.movement-print-money {
          white-space: normal;
          text-align: right;
        }

        .movement-print-num {
          width: 10mm;
          text-align: center;
        }

        .movement-print-unit {
          width: 18mm;
        }

        .movement-print-qty {
          width: 24mm;
          text-align: right;
        }

        .movement-print-money {
          width: 30mm;
          white-space: nowrap;
          text-align: right;
        }

        .movement-print-product {
          color: #111827;
          overflow-wrap: anywhere;
        }

        .movement-print-product-name {
          font-weight: 700;
        }

        .movement-print-muted {
          margin-top: 0.8mm;
          color: #6b7280;
          font-size: 9.5px;
        }

        .movement-print-totals {
          display: flex;
          justify-content: flex-end;
          margin-top: 6mm;
        }

        .movement-print-total-box {
          width: 68mm;
          border: 1px solid #d1d5db;
          border-bottom: 0;
          font-size: 11px;
        }

        .movement-print-total-row {
          display: flex;
          justify-content: space-between;
          gap: 6mm;
          border-bottom: 1px solid #d1d5db;
          padding: 2mm 2.5mm;
        }

        .movement-print-total-row strong {
          white-space: nowrap;
        }

        .movement-print-signatures {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8mm 12mm;
          margin-top: 14mm;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .movement-print-signature-row,
        .movement-print-signature-date {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 4mm;
          align-items: end;
          min-height: 11mm;
          font-size: 11px;
        }

        .movement-print-signature-line {
          border-bottom: 1px solid #111827;
          min-height: 8mm;
        }

        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }

          html,
          body {
            background: #ffffff !important;
          }

          body {
            margin: 0 !important;
            overflow: visible !important;
          }

          .movement-print-chrome {
            display: none !important;
          }

          .movement-print-page {
            min-height: auto !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .movement-print-sheet {
            width: auto !important;
            min-height: auto !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            font-size: 11px !important;
          }

          .movement-print-table {
            page-break-inside: auto;
          }

          .movement-print-table thead {
            display: table-header-group;
          }

          .movement-print-table tfoot {
            display: table-footer-group;
          }

          .movement-print-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .movement-print-header,
          .movement-print-meta,
          .movement-print-totals,
          .movement-print-signatures {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <header className="movement-print-header">
        <div>
          <p className="movement-print-company">
            {document.organizationName || labels.companyFallback}
          </p>
          <h1 className="movement-print-title">{labels.title}</h1>
          <p className="movement-print-number">{labels.documentNumber}</p>
        </div>

        <div className="movement-print-stamp" aria-label={labels.status}>
          <div className="movement-print-stamp-row">
            <div className="movement-print-stamp-label">{labels.date}</div>
            <div className="movement-print-stamp-value">
              {formatDateTime(document.createdAt, locale)}
            </div>
          </div>
          <div className="movement-print-stamp-row">
            <div className="movement-print-stamp-label">{labels.status}</div>
            <div className="movement-print-stamp-value">{labels.statusLabel}</div>
          </div>
        </div>
      </header>

      <dl className="movement-print-meta">
        <div className="movement-print-meta-item">
          <dt className="movement-print-meta-label">{senderLabel}</dt>
          <dd>{senderValue}</dd>
        </div>
        {document.documentType === "WRITE_OFF" ? null : (
          <div className="movement-print-meta-item">
            <dt className="movement-print-meta-label">{recipientLabel}</dt>
            <dd>{recipientValue}</dd>
          </div>
        )}
        <div className="movement-print-meta-item">
          <dt className="movement-print-meta-label">{labels.author}</dt>
          <dd>{document.authorName || document.authorEmail || labels.notAvailable}</dd>
        </div>
        {hasReason ? (
          <div className="movement-print-meta-item">
            <dt className="movement-print-meta-label">{labels.reason}</dt>
            <dd>{document.reason}</dd>
          </div>
        ) : null}
        {hasComment ? (
          <div className="movement-print-meta-item movement-print-comment">
            <dt className="movement-print-meta-label">{labels.comment}</dt>
            <dd>{document.comment || document.description}</dd>
          </div>
        ) : null}
      </dl>

      <table className="movement-print-table">
        <thead>
          <tr>
            <th className="movement-print-num">№</th>
            <th>{labels.product}</th>
            <th className="movement-print-qty">{labels.quantity}</th>
            <th className="movement-print-unit">{labels.unit}</th>
            {showMoneyColumns ? (
              <>
                <th className="movement-print-money">{labels.unitCost}</th>
                <th className="movement-print-money">{labels.lineTotal}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const secondary = productSecondaryText(line, labels);
            return (
              <tr key={line.id}>
                <td className="movement-print-num">{index + 1}</td>
                <td className="movement-print-product">
                  <div className="movement-print-product-name">{line.productName}</div>
                  {line.variantName ? (
                    <div className="movement-print-muted">{line.variantName}</div>
                  ) : null}
                  {secondary ? <div className="movement-print-muted">{secondary}</div> : null}
                </td>
                <td className="movement-print-qty">
                  {formatNumber(Math.abs(line.qtyDelta), locale)}
                </td>
                <td>{line.unit || labels.notAvailable}</td>
                {showMoneyColumns ? (
                  <>
                    <td className="movement-print-money">
                      {formatMaybeMoney(line.unitCostKgs, locale, labels.notAvailable)}
                    </td>
                    <td className="movement-print-money">
                      {formatMaybeMoney(line.lineTotalKgs, locale, labels.notAvailable)}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="movement-print-totals">
        <div className="movement-print-total-box">
          <div className="movement-print-total-row">
            <span>{labels.positions}</span>
            <strong>{formatNumber(lines.length, locale)}</strong>
          </div>
          <div className="movement-print-total-row">
            <span>{labels.quantity}</span>
            <strong>{formatNumber(totalQuantity, locale)}</strong>
          </div>
          {showMoneyColumns ? (
            <div className="movement-print-total-row">
              <span>{labels.amount}</span>
              <strong>{formatMaybeMoney(totalAmount, locale, labels.notAvailable)}</strong>
            </div>
          ) : null}
        </div>
      </div>

      <section className="movement-print-signatures" aria-label={labels.responsible}>
        <div className="movement-print-signature-row">
          <div>{firstSignatureLabel}:</div>
          <div className="movement-print-signature-line" />
        </div>
        <div className="movement-print-signature-row">
          <div>{secondSignatureLabel}:</div>
          <div className="movement-print-signature-line" />
        </div>
        <div className="movement-print-signature-row">
          <div>{labels.responsible}:</div>
          <div className="movement-print-signature-line" />
        </div>
        <div className="movement-print-signature-date">
          <div>{labels.signatureDate}:</div>
          <div className="movement-print-signature-line" />
        </div>
      </section>
    </section>
  );
};
