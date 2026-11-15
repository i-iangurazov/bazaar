import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ token: vi.fn(), project: vi.fn(), render: vi.fn(), audit: vi.fn() }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.token }));
vi.mock("@/server/services/salesDocuments", () => ({ getSalesDocument: mocks.project }));
vi.mock("@/server/services/salesDocumentPdf", () => ({ buildSalesDocumentPdf: mocks.render }));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "ru" }) }) }));

import { AppError } from "@/server/services/errors";
import { GET } from "../../src/app/api/sales/orders/[id]/pdf/route";

const call = (query = "") => GET(new Request(`http://localhost/api/sales/orders/sale-1/pdf${query}`), { params: Promise.resolve({ id: "sale-1" }) });
describe("sales document HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token.mockResolvedValue({ sub: "live-user", organizationId: "org-1", role: "ADMIN", isOrgOwner: true });
    mocks.project.mockResolvedValue({ id: "sale-1", organizationId: "org-1", number: "SALE\"\r\n-01" });
    mocks.render.mockResolvedValue(Buffer.from("%PDF-synthetic-layout-checked-separately"));
    mocks.audit.mockResolvedValue(undefined);
  });
  it("requires an authenticated actor before projecting a document", async () => {
    mocks.token.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it.each(["?kind=fiscal", "?action=unknown", "?kind=invoice&action=auto_print"])("rejects unsupported document/action%s", async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it("downloads a no-cache attachment using a safe record-ID filename and live projection", async () => {
    const response = await call("?kind=goods_receipt&action=download");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="goods_receipt-sale-1.pdf"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.project).toHaveBeenCalledWith({ actorId: "live-user", organizationId: "org-1", customerOrderId: "sale-1", locale: "ru" });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ kind: "goods_receipt" }));
  });
  it("serves the same document inline for print and tolerates audit outages", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    const response = await call("?kind=invoice&action=print");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("inline;");
  });
  it.each([401, 403, 404])("propagates read-access status%s without rendering data", async (status) => {
    mocks.project.mockRejectedValue(new AppError(status === 404 ? "salesOrderNotFound" : "forbidden", status === 404 ? "NOT_FOUND" : "FORBIDDEN", status));
    const response = await call();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
