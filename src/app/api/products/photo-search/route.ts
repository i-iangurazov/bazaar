import { productPhotoSearchMaxBytes, validProductPhotoRegion, type ProductPhotoRegion } from "@/lib/productPhotoSearch";
import { AppError } from "@/server/services/errors";
import { findPhotoCandidates, preparedPhotoSearchProgress, presentPreparedPhotoCandidates, presentPhotoCandidates } from "@/server/services/productPhotoSearch";
import { photoSearchConfigured, photoSearchIndexEnabled, checkPhotoSearchEngine } from "@/server/services/productPhotoSearchEngine";
import { assertPhotoOrigin, consumePhotoRate, photoFailure, photoJson, photoSearchUser, readPhotoBody } from "@/server/services/productPhotoSearchHttp";
import { assertPhotoStore, loadPhotoSearchScope } from "@/server/services/productPhotoSearchScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const user = await photoSearchUser(request);
    await consumePhotoRate(user, "status");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId") ?? "";
    await assertPhotoStore(user, storeId);
    const configured = photoSearchConfigured();
    if (photoSearchIndexEnabled() && searchParams.get("availability") === "1") {
      return photoJson({ configured });
    }
    const progress = configured ? await preparedPhotoSearchProgress(user, storeId, request.signal) : null;
    if (configured && !progress) await checkPhotoSearchEngine(request.signal);
    const current = await photoSearchUser(request);
    if (current.id !== user.id || current.organizationId !== user.organizationId) throw new AppError("forbidden", "FORBIDDEN", 403);
    if (progress) {
      await assertPhotoStore(current, storeId);
      return photoJson({ configured, progress, preparedIndex: true });
    }
    const scope = await loadPhotoSearchScope(current, storeId);
    return photoJson({ configured, progress: scope.progress });
  } catch (error) { return photoFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await photoSearchUser(request);
    assertPhotoOrigin(request);
    await consumePhotoRate(user, "query");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new AppError("invalidInput", "BAD_REQUEST", 400);
    const body = await readPhotoBody(request, productPhotoSearchMaxBytes + 64 * 1024);
    let form: FormData;
    try { form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
    catch { throw new AppError("invalidInput", "BAD_REQUEST", 400); }
    const file = form.get("file");
    const storeId = form.get("storeId");
    if (!(file instanceof File) || typeof storeId !== "string") throw new AppError("invalidInput", "BAD_REQUEST", 400);
    const allowPartial = form.get("allowPartial") === "1";
    const rawRegion = form.get("region");
    let region: ProductPhotoRegion | undefined;
    if (rawRegion !== null) {
      let value: unknown;
      try { if (typeof rawRegion !== "string" || rawRegion.length > 512) throw new Error(); value = JSON.parse(rawRegion); }
      catch { throw new AppError("invalidInput", "BAD_REQUEST", 400); }
      if (!validProductPhotoRegion(value)) throw new AppError("invalidInput", "BAD_REQUEST", 400);
      region = value;
    }
    const rawAutomatic = form.get("autoRegion");
    if (rawAutomatic !== null && rawAutomatic !== "0" && rawAutomatic !== "1") throw new AppError("invalidInput", "BAD_REQUEST", 400);
    const result = await findPhotoCandidates({ user, storeId, file, allowPartial, signal: request.signal, region, autoRegion: rawAutomatic !== "0" });
    const currentUser = await photoSearchUser(request);
    if (currentUser.id !== user.id || currentUser.organizationId !== user.organizationId)
      throw new AppError("forbidden", "FORBIDDEN", 403);
    return photoJson(result.prepared ? await presentPreparedPhotoCandidates(currentUser, storeId, result.prepared)
      : await presentPhotoCandidates(currentUser, storeId, result.candidates, allowPartial, result.progress, result.analysis));
  } catch (error) { return photoFailure(error); }
}
