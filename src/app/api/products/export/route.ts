import * as XLSX from "xlsx";
import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { exportProductsInputSchema } from "@/server/trpc/routers/products.schemas";
import { exportProductTableBatch } from "@/server/services/products/read";
import { toCsv, sanitizeSpreadsheetValue } from "@/server/services/csv";
import type { StoreAccessUser } from "@/server/services/storeAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const token = await getServerAuthToken();
  if (!token) return Response.json({ message: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "Forbidden" }, { status: 403 });
  const data = await request.formData();
  let payload: unknown;
  try { payload = JSON.parse(String(data.get("payload"))); } catch { return Response.json({ message: "invalidInput" }, { status: 400 }); }
  const parsed = exportProductsInputSchema.safeParse(payload);
  const format = data.get("format");
  if (!parsed.success || !["csv", "xlsx"].includes(String(format))) return Response.json({ message: "invalidInput" }, { status: 400 });
  const user: StoreAccessUser = { id: String(token.sub), organizationId: String(token.organizationId), role: String(token.role), isOrgOwner: Boolean(token.isOrgOwner), isPlatformOwner: Boolean(token.isPlatformOwner) };
  const options = { prisma, organizationId: user.organizationId, user, input: parsed.data, storeId: parsed.data?.storeId, columns: parsed.data?.columns, ids: parsed.data?.ids };
  try {
    // Validate access and read the first batch before sending any file bytes.
    let batch = await exportProductTableBatch(options);
    const headers = { "Content-Disposition": `attachment; filename="products.${format}"`, "Cache-Control": "private, no-store" };
    if (format === "xlsx") {
      const sheet = XLSX.utils.aoa_to_sheet([batch.header]);
      let rowCount = 0;
      do {
        XLSX.utils.sheet_add_aoa(sheet, batch.rows.map((row) => batch.keys.map((key) => typeof row[key] === "number" ? row[key] : sanitizeSpreadsheetValue(row[key]))), { origin: -1 });
        rowCount += batch.rows.length;
        if (!batch.hasMore) break;
        batch = await exportProductTableBatch({ ...options, afterId: batch.nextId });
      } while (true);
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "Products");
      return new Response(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-Export-Row-Count": String(rowCount) } });
    }
    const encoder = new TextEncoder();
    let first = true;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const csv = toCsv(batch.header, batch.rows, batch.keys);
          const text = first ? csv : batch.rows.length ? csv.slice(csv.indexOf("\r\n") + 2) : "";
          if (text) controller.enqueue(encoder.encode(`${first ? "" : "\r\n"}${text}`));
          first = false;
          if (!batch.hasMore) { controller.close(); return; }
          batch = await exportProductTableBatch({ ...options, afterId: batch.nextId });
        } catch (error) { controller.error(error); }
      },
    });
    return new Response(body, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "exportFailed" }, { status: 400 });
  }
}
