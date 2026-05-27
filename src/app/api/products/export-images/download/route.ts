import { getServerAuthToken } from "@/server/auth/token";
import { consumeZip } from "@/lib/imageExportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const downloadToken = searchParams.get("token");
  if (!downloadToken) return new Response("Missing token", { status: 400 });

  const zip = consumeZip(downloadToken);
  if (!zip) return new Response("Not found or expired", { status: 404 });

  return new Response(zip.data, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zip.filename}"`,
    },
  });
};
