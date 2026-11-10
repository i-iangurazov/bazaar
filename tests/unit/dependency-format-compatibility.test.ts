import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);

describe("patched file and native tooling compatibility", () => {
  it("round-trips multilingual product imports without changing barcodes, zero prices or fractional quantities", () => {
    const rows = [
      ["Название", "Штрихкод", "Количество", "Цена", "Единица"],
      ["Маслостойкий шланг 18/1.6", "0012345678901", 1.125, 68.5, "м"],
      ["Көк чай", "00000042", 0, 0, "шт"],
      ["Coffee", "996000000001", 2, 1234.56, "pcs"],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Товары");

    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const restored = XLSX.read(bytes, { type: "buffer" });

    expect(restored.SheetNames).toEqual(["Товары"]);
    expect(XLSX.utils.sheet_to_json(restored.Sheets["Товары"], { header: 1, raw: true })).toEqual(rows);
    expect(restored.Sheets["Товары"].B2.t).toBe("s");
    expect(restored.Sheets["Товары"].D3.v).toBe(0);
  });

  it("retains legacy XLS import support and treats prototype-like headers as cell data", () => {
    const rows = [["__proto__", "constructor", "Название"], ["ordinary value", "string", "Товар"]];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Import");
    const originalPrototype = Object.getPrototypeOf({});
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
    const restored = XLSX.read(bytes, { type: "buffer" });

    expect(XLSX.utils.sheet_to_json(restored.Sheets.Import, { header: 1, raw: true })).toEqual(rows);
    expect(Object.getPrototypeOf({})).toBe(originalPrototype);
    expect(Object.prototype).not.toHaveProperty("ordinary value");
  });

  it("keeps typed ESLint project glob resolution working with the patched matcher", () => {
    const parser = require("@typescript-eslint/parser");
    const directory = mkdtempSync(join(tmpdir(), "bazaar-eslint-dependency-"));
    const source = "export const price: number = 68.5;\n";
    const filePath = join(directory, "price.ts");
    try {
      writeFileSync(filePath, source);
      writeFileSync(join(directory, "tsconfig.fixture.json"), JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", types: [] }, include: ["*.ts"],
      }));
      const result = parser.parseForESLint(source, {
        filePath, tsconfigRootDir: directory, project: ["tsconfig*.json"],
        projectFolderIgnoreList: ["**/node_modules/**"],
        sourceType: "module", ecmaVersion: "latest", loc: true, range: true,
      });
      expect(result.ast.body[0].type).toBe("ExportNamedDeclaration");
      expect(result.services.program.getRootFileNames()).toContain(filePath);
      expect(result.services.program.getSemanticDiagnostics()).toEqual([]);
    } finally {
      parser.clearCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps Capacitor's CommonJS Xcode project writer working with patched UUID generation", () => {
    // Resolve through the actual native owner so an accidentally unpatched or
    // incompatible nested dependency cannot be hidden by a direct test import.
    const capacitorRequire = createRequire(require.resolve("@capacitor/cli/package.json"));
    const xcode = capacitorRequire("xcode");
    const projectPath = join(process.cwd(), "ios/App/App.xcodeproj/project.pbxproj");
    const original = readFileSync(projectPath, "utf8");
    const project = xcode.project(projectPath).parseSync();
    const firstId = project.generateUuid();
    const secondId = project.generateUuid();
    expect(firstId).toMatch(/^[A-F0-9]{24}$/);
    expect(secondId).toMatch(/^[A-F0-9]{24}$/);
    expect(firstId).not.toBe(secondId);

    const directory = mkdtempSync(join(tmpdir(), "bazaar-native-dependency-"));
    try {
      project.addBuildProperty("BAZAAR_SECURITY_PROBE", "YES");
      const roundTripPath = join(directory, "fixture.pbxproj");
      writeFileSync(roundTripPath, project.writeSync());
      const restored = xcode.project(roundTripPath).parseSync();
      expect(restored.getBuildProperty("BAZAAR_SECURITY_PROBE")).toBe("YES");
      expect(restored.getFirstTarget().uuid).toBe(project.getFirstTarget().uuid);
      expect(readFileSync(projectPath, "utf8")).toBe(original);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
