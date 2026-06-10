import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("POS register management source", () => {
  it("keeps register management actions visible and guarded on the registers page", async () => {
    const source = await readSource("src/app/(app)/pos/registers/page.tsx");

    expect(source).toContain('type RegisterStatusFilter = "active" | "inactive" | "all"');
    expect(source).toContain("status: statusFilter");
    expect(source).toContain("trpc.pos.registers.delete.useMutation");
    expect(source).toContain("useConfirmDialog");
    expect(source).toContain("openEditDialog");
    expect(source).toContain("handleToggleActive");
    expect(source).toContain("handleDelete");
    expect(source).toContain('t("registers.deleteBlocked")');
    expect(source).toContain('disabled={Boolean(editingRegister?.hasHistory)}');
    expect(source).toContain('t("registers.storeLockedByHistory")');
  });

  it("defaults POS selection to active registers but keeps history pages able to show all", async () => {
    const serviceSource = await readSource("src/server/services/pos.ts");
    const routerSource = await readSource("src/server/trpc/routers/pos.ts");
    const historySource = await readSource("src/app/(app)/pos/history/page.tsx");
    const shiftsSource = await readSource("src/app/(app)/pos/shifts/page.tsx");

    expect(serviceSource).toContain('export type PosRegisterStatusFilter = "active" | "inactive" | "all"');
    expect(serviceSource).toContain('const status = input.status ?? "active"');
    expect(serviceSource).toContain('status === "active"');
    expect(serviceSource).toContain("posRegisterDeleteBlockedByHistory");
    expect(serviceSource).toContain("posRegisterStoreChangeBlockedByHistory");
    expect(routerSource).toContain('z.enum(["active", "inactive", "all"])');
    expect(routerSource).toContain("deletePosRegister");
    expect(historySource).toContain('trpc.pos.registers.list.useQuery({ status: "all" })');
    expect(shiftsSource).toContain('trpc.pos.registers.list.useQuery({ status: "all" })');
    expect(shiftsSource).toContain("canOpenNewShift");
  });
});
