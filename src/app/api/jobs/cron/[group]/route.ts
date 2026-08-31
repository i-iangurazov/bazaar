import { isAuthorizedCronRequest, MIN_CRON_SECRET_LENGTH } from "@/server/jobs/cronAuth";
import { isScheduledJobGroup, runScheduledJobGroup } from "@/server/jobs/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (
  request: Request,
  { params }: { params: Promise<{ group: string }> },
) => {
  const { group } = await params;
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    return Response.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isScheduledJobGroup(group)) {
    return Response.json({ error: "cron_group_not_found" }, { status: 404 });
  }

  const summary = await runScheduledJobGroup(group);
  return Response.json(summary, { status: summary.failed > 0 ? 503 : 200 });
};
