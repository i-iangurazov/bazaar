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

const printDom = (document: ReturnType<typeof movementPrintFixture>) => {
  const dom = globalThis.document.createElement("div");
  dom.innerHTML = renderToStaticMarkup(
    createElement(MovementPrintDocument, {
      document,
      labels: movementPrintLabels,
      locale: "ru",
    }),
  );
  return dom;
};

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

  describe.each(printableMovementTypes)("%s comments", (type) => {
    it.each([null, "", " \n\t "])(
      "omits an empty real comment (%j) without printing the generated product list",
      (comment) => {
        const document = movementPrintFixture(type, 90);
        document.comment = comment;
        document.description = document.lines.map((line) => line.productName).join(", ");
        const before = structuredClone(document);
        const dom = printDom(document);

        expect(dom.querySelector(".movement-print-comment")).toBeNull();
        expect(dom.querySelectorAll("tbody tr")).toHaveLength(90);
        expect(dom.querySelectorAll(".movement-print-product-name")).toHaveLength(90);
        for (const line of document.lines) {
          expect(dom.textContent?.split(line.productName)).toHaveLength(2);
        }
        expect(dom.querySelector(".movement-print-meta")?.textContent).toContain(document.reason);
        expect(document).toEqual(before);
      },
    );

    it("preserves an explicit multiline comment and its separate reason", () => {
      const document = movementPrintFixture(type, 3);
      document.comment = "Доставить после 14:00.\nПозвонить перед разгрузкой: <склад>.";
      document.description = document.lines.map((line) => line.productName).join(", ");
      const before = structuredClone(document);
      const dom = printDom(document);

      expect(dom.querySelector(".movement-print-comment dt")?.textContent).toBe(
        movementPrintLabels.comment,
      );
      expect(dom.querySelector(".movement-print-comment dd")?.textContent).toBe(document.comment);
      expect(dom.querySelector(".movement-print-comment dd")?.children).toHaveLength(0);
      expect(dom.querySelector(".movement-print-meta")?.textContent).toContain(document.reason);
      expect(dom.querySelectorAll("tbody tr")).toHaveLength(3);
      expect(document).toEqual(before);
    });

    it("keeps a real comment even when the employee entered the product names", () => {
      const document = movementPrintFixture(type, 3);
      document.description = document.lines.map((line) => line.productName).join(", ");
      document.comment = document.description;
      const dom = printDom(document);

      expect(dom.querySelector(".movement-print-comment dd")?.textContent).toBe(document.comment);
      expect(dom.querySelectorAll("tbody tr")).toHaveLength(3);
    });
  });

  it("leaves documents with separate print contracts outside the movement template", () => {
    expect(canPrintMovementDocument("SALE")).toBe(false);
    expect(canPrintMovementDocument("RETURN")).toBe(false);
    expect(canPrintMovementDocument("PURCHASE_ORDER")).toBe(false);
  });
});
