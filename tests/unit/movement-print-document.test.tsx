// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MovementPrintDocument,
  getMovementPrintDocumentNumber,
} from "@/components/inventory/movement-print-document";
import { canPrintMovementDocument, printableMovementTypes } from "@/lib/movementPrint";
import { movementPrintFixture, movementPrintLabels } from "../helpers/movementPrintFixture";

describe("movement print document", () => {
  it.each(printableMovementTypes)(
    "prints readable %s rows without SKU/barcode metadata",
    (type) => {
      const document = movementPrintFixture(type, 3);
      const before = structuredClone(document);
      const html = renderToStaticMarkup(
        createElement(MovementPrintDocument, {
          document,
          labels: movementPrintLabels,
          locale: "ru",
        }),
      );
      const dom = globalThis.document.createElement("div");
      dom.innerHTML = html;
      const rows = [...dom.querySelectorAll("tbody tr")];
      expect(rows).toHaveLength(3);
      rows.forEach((row, index) => {
        const line = document.lines[index];
        expect(row.textContent).toContain(line.productName);
        expect(row.textContent).toContain(line.unit);
        expect(row.textContent).not.toContain(line.sku);
        expect(row.textContent).not.toContain(line.barcode);
        expect(row.textContent).not.toMatch(/SKU|штрихкод/i);
        if (line.variantName) expect(row.textContent).toContain(line.variantName);
      });
      expect(dom.querySelector(".movement-print-signatures")?.textContent).toContain(
        movementPrintLabels.responsible,
      );
      expect(dom.querySelector("thead")?.textContent).toContain(movementPrintLabels.quantity);
      expect(document).toEqual(before); // Print presentation must never strip metadata from the data.
      expect(canPrintMovementDocument(type)).toBe(true);
    },
  );

  it("preserves the supplied document number and identifies adjustment printouts", () => {
    const document = movementPrintFixture("ADJUSTMENT");
    expect(getMovementPrintDocumentNumber(document)).toBe("PRINT-TEST");
    expect(getMovementPrintDocumentNumber({ ...document, documentNumber: null })).toMatch(/^ADJ-/);
  });

  it("leaves documents with separate print contracts outside the movement template", () => {
    expect(canPrintMovementDocument("SALE")).toBe(false);
    expect(canPrintMovementDocument("RETURN")).toBe(false);
    expect(canPrintMovementDocument("PURCHASE_ORDER")).toBe(false);
  });
});
