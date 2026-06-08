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
  sender: string;
  author: string;
  comment: string;
  product: string;
  skuBarcode: string;
  unit: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
  positions: string;
  amount: string;
  technicalReference: string;
  costNotSpecified: string;
  shippedBy: string;
  releasedBy: string;
  receivedBy: string;
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
    : `${document.documentType === "TRANSFER" ? "TRF" : "RCV"}-${document.createdAt
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "")}-${document.documentId.slice(0, 8).toUpperCase()}`;

export const getMovementPrintTechnicalReference = (document: ProductMovementDocumentDetail) =>
  document.documentId;

const getPrintableLines = (document: ProductMovementDocumentDetail) => {
  if (document.documentType !== "TRANSFER") {
    return document.lines;
  }

  const outgoing = document.lines.filter((line) => line.movementType === "TRANSFER_OUT");
  return outgoing.length
    ? outgoing
    : document.lines.filter((line) => line.movementType === "TRANSFER_IN");
};

const formatMaybeMoney = (value: number | null | undefined, locale: string) =>
  typeof value === "number" ? formatCurrencyKGS(value, locale) : null;

const renderSkuBarcode = (sku: string | null, barcode: string | null, fallback: string) => {
  if (!sku && !barcode) {
    return fallback;
  }

  return <span>{[sku, barcode].filter(Boolean).join(" · ")}</span>;
};

export const MovementPrintDocument = ({ document, labels, locale }: MovementPrintDocumentProps) => {
  const lines = getPrintableLines(document);
  const hasLineAmount = lines.some((line) => typeof line.lineTotalKgs === "number");
  const totalAmount = hasLineAmount
    ? lines.reduce((sum, line) => sum + (line.lineTotalKgs ?? 0), 0)
    : document.totalAmount;
  const totalQuantity = lines.reduce((sum, line) => sum + Math.abs(line.qtyDelta), 0);
  const senderLabel = document.documentType === "TRANSFER" ? labels.sourceStore : labels.sender;
  const recipientLabel =
    document.documentType === "TRANSFER" ? labels.destinationStore : labels.receivingStore;
  const senderValue = document.senderName || labels.notAvailable;
  const recipientValue = document.recipientName || document.storeName || labels.notAvailable;
  const firstSignatureLabel =
    document.documentType === "TRANSFER" ? labels.releasedBy : labels.shippedBy;

  return (
    <section className="movement-print-sheet" aria-label={labels.title}>
      <style>{`
        .movement-print-sheet {
          width: 210mm;
          max-width: calc(100vw - 24px);
          margin: 12px auto;
          padding: 7mm;
          color: #111827;
          background: #ffffff;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.14);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 8px;
          line-height: 1.1;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        .movement-print-header {
          display: grid;
          grid-template-columns: 1fr 42mm;
          gap: 4mm;
          align-items: start;
          padding-bottom: 1.4mm;
          border-bottom: 1.5px solid #111827;
        }

        .movement-print-company {
          margin: 0 0 0.9mm;
          color: #334155;
          font-size: 6.8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .movement-print-title {
          margin: 0;
          font-size: 12px;
          line-height: 1.1;
          font-weight: 700;
        }

        .movement-print-number {
          margin: 0.6mm 0 0;
          color: #334155;
          font-size: 7.6px;
          font-weight: 700;
        }

        .movement-print-technical-reference {
          margin: 0.3mm 0 0;
          color: #64748b;
          font-size: 6px;
        }

        .movement-print-stamp {
          border: 1px solid #111827;
        }

        .movement-print-stamp-row {
          display: grid;
          grid-template-columns: 15mm 1fr;
          min-height: 3.6mm;
          border-bottom: 1px solid #111827;
        }

        .movement-print-stamp-row:last-child {
          border-bottom: 0;
        }

        .movement-print-stamp-label,
        .movement-print-stamp-value {
          padding: 0.8mm 1mm;
        }

        .movement-print-stamp-label {
          border-right: 1px solid #111827;
          color: #475569;
          font-size: 6px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .movement-print-stamp-value {
          font-weight: 700;
          text-align: right;
        }

        .movement-print-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.7mm 4mm;
          margin-top: 1.4mm;
        }

        .movement-print-meta dt,
        .movement-print-meta dd {
          margin: 0;
        }

        .movement-print-meta-item {
          display: grid;
          grid-template-columns: 22mm 1fr;
          gap: 1.5mm;
          min-height: 2.7mm;
        }

        .movement-print-meta-label {
          color: #475569;
          font-weight: 700;
        }

        .movement-print-comment {
          grid-column: 1 / -1;
        }

        .movement-print-table {
          width: 100%;
          margin-top: 1.6mm;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 6.5px;
          line-height: 1.03;
        }

        .movement-print-table th,
        .movement-print-table td {
          border: 1px solid #111827;
          padding: 0.25mm 0.45mm;
          vertical-align: top;
        }

        .movement-print-table th {
          background: #f1f5f9;
          font-size: 5.6px;
          font-weight: 700;
          text-align: left;
          text-transform: uppercase;
        }

        .movement-print-num {
          width: 6mm;
          text-align: center;
        }

        .movement-print-sku {
          width: 31mm;
        }

        .movement-print-unit {
          width: 8mm;
        }

        .movement-print-qty {
          width: 11mm;
          text-align: right;
        }

        .movement-print-money {
          width: 22mm;
          font-size: 5.7px;
          white-space: nowrap;
          text-align: right;
        }

        .movement-print-product {
          overflow-wrap: anywhere;
        }

        .movement-print-missing {
          color: #64748b;
          font-size: 5.8px;
          white-space: nowrap;
        }

        .movement-print-muted {
          color: #64748b;
          font-size: 5.8px;
        }

        .movement-print-totals {
          display: flex;
          justify-content: flex-end;
          margin-top: 1.3mm;
        }

        .movement-print-total-box {
          width: 40mm;
          border: 1px solid #111827;
          border-bottom: 0;
          font-size: 6.8px;
        }

        .movement-print-total-row {
          display: flex;
          justify-content: space-between;
          gap: 3mm;
          border-bottom: 1px solid #111827;
          padding: 0.35mm 0.8mm;
        }

        .movement-print-total-row strong {
          white-space: nowrap;
        }

        .movement-print-signatures {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1.3mm 5mm;
          margin-top: 1.8mm;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .movement-print-signature-row {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 1.5mm;
          align-items: end;
          min-height: 3.9mm;
          font-size: 6.8px;
        }

        .movement-print-signature-line {
          border-bottom: 1px solid #111827;
          min-height: 2.8mm;
        }

        .movement-print-signature-date {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 1.5mm;
          align-items: end;
          min-height: 3.9mm;
          font-size: 6.8px;
        }

        @media print {
          @page {
            size: A4;
            margin: 5mm;
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
            font-size: 7px !important;
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

          .movement-print-table th,
          .movement-print-table td {
            padding-top: 0.18mm;
            padding-bottom: 0.18mm;
          }

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
          <p className="movement-print-technical-reference">
            {labels.technicalReference}: {getMovementPrintTechnicalReference(document)}
          </p>
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
        <div className="movement-print-meta-item">
          <dt className="movement-print-meta-label">{recipientLabel}</dt>
          <dd>{recipientValue}</dd>
        </div>
        <div className="movement-print-meta-item">
          <dt className="movement-print-meta-label">{labels.author}</dt>
          <dd>{document.authorName || document.authorEmail || labels.notAvailable}</dd>
        </div>
        <div className="movement-print-meta-item movement-print-comment">
          <dt className="movement-print-meta-label">{labels.comment}</dt>
          <dd>{document.comment || document.description || labels.notAvailable}</dd>
        </div>
      </dl>

      <table className="movement-print-table">
        <thead>
          <tr>
            <th className="movement-print-num">№</th>
            <th>{labels.product}</th>
            <th className="movement-print-sku">{labels.skuBarcode}</th>
            <th className="movement-print-qty">{labels.quantity}</th>
            <th className="movement-print-unit">{labels.unit}</th>
            <th className="movement-print-money">{labels.unitCost}</th>
            <th className="movement-print-money">{labels.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id}>
              <td className="movement-print-num">{index + 1}</td>
              <td className="movement-print-product">
                <div>{line.productName}</div>
                {line.variantName ? (
                  <div className="movement-print-muted">{line.variantName}</div>
                ) : null}
              </td>
              <td className="movement-print-sku">
                {renderSkuBarcode(line.sku, line.barcode, labels.notAvailable)}
              </td>
              <td className="movement-print-qty">
                {formatNumber(Math.abs(line.qtyDelta), locale)}
              </td>
              <td>{line.unit || labels.notAvailable}</td>
              <td className="movement-print-money">
                {formatMaybeMoney(line.unitCostKgs, locale) ?? (
                  <span className="movement-print-missing">{labels.costNotSpecified}</span>
                )}
              </td>
              <td className="movement-print-money">
                {formatMaybeMoney(line.lineTotalKgs, locale) ?? (
                  <span className="movement-print-missing">{labels.costNotSpecified}</span>
                )}
              </td>
            </tr>
          ))}
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
          <div className="movement-print-total-row">
            <span>{labels.amount}</span>
            <strong>
              {formatMaybeMoney(totalAmount, locale) ?? (
                <span className="movement-print-missing">{labels.costNotSpecified}</span>
              )}
            </strong>
          </div>
        </div>
      </div>

      <section className="movement-print-signatures" aria-label={labels.responsible}>
        <div className="movement-print-signature-row">
          <div>{firstSignatureLabel}:</div>
          <div className="movement-print-signature-line" />
        </div>
        <div className="movement-print-signature-row">
          <div>{labels.receivedBy}:</div>
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
