export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Public release identity only. This endpoint does not check backing services. */
export const GET = async () => {
  const candidate = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const sha = /^[a-f0-9]{40}$/i.test(candidate) ? candidate.toLowerCase() : null;
  return Response.json({ sha }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
};
