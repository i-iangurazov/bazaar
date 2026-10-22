import { readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mimeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const root = resolve(process.cwd(), "public/uploads/imported-products");

// These content-addressed URLs were already public. Next production snapshots
// public/ at startup; new uploads need a route until a later process restart.
// Keep the same URL for product galleries, the studio and catalogue consumers.
export async function GET(_request: Request, { params }: { params: { path: string[] } }) {
  const parts = params.path;
  if (
    parts.length !== 4 ||
    parts[1] !== "products" ||
    ![parts[0], parts[2]].every((p) => /^[a-zA-Z0-9_-]{1,100}$/.test(p))
  )
    return new Response(null, { status: 404 });
  const match = /^([a-f0-9]{40})\.(jpg|jpeg|png|webp)$/.exec(parts[3]);
  if (!match) return new Response(null, { status: 404 });
  try {
    const [base, file] = await Promise.all([realpath(root), realpath(join(root, ...parts))]);
    if (!file.startsWith(base + sep)) return new Response(null, { status: 404 });
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeTypes[match[2]],
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return new Response(null, { status: 404 });
    return new Response(null, { status: 500 });
  }
}
