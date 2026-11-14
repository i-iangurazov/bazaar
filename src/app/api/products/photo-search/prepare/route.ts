import { AppError } from "@/server/services/errors";
import { checkPhotoSearchEngine } from "@/server/services/productPhotoSearchEngine";
import { assertPhotoOrigin, consumePhotoRate, photoFailure, photoJson, photoSearchUser, readPhotoBody } from "@/server/services/productPhotoSearchHttp";
import { loadPhotoSearchScope, preparePhotoSearch } from "@/server/services/productPhotoSearchScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await photoSearchUser(request);
    assertPhotoOrigin(request);
    await consumePhotoRate(user, "prepare");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("invalidInput", "BAD_REQUEST", 400);
    let body: { storeId?: unknown; retryFailed?: unknown };
    try { body = JSON.parse((await readPhotoBody(request, 4096)).toString("utf8")); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError("invalidInput", "BAD_REQUEST", 400); }
    if (!body || typeof body.storeId !== "string") throw new AppError("invalidInput", "BAD_REQUEST", 400);
    await loadPhotoSearchScope(user, body.storeId);
    await checkPhotoSearchEngine(request.signal);
    await preparePhotoSearch(user, body.storeId, body.retryFailed === true);
    const current = await photoSearchUser(request);
    if (current.id !== user.id || current.organizationId !== user.organizationId) throw new AppError("forbidden", "FORBIDDEN", 403);
    const scope = await loadPhotoSearchScope(current, body.storeId);
    return photoJson({ progress: scope.progress });
  } catch (error) { return photoFailure(error); }
}
