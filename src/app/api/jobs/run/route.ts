import { listJobs, runJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getSecret = (request: Request) => {
  return request.headers.get("x-job-secret") ?? "";
};

const getJobName = async (request: Request) => {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("job");
  if (fromQuery) {
    return fromQuery;
  }
  const body = await request.json().catch(() => null);
  return body && typeof body.job === "string" ? body.job : "";
};

export const POST = async (request: Request) => {
  const secret = process.env.JOBS_SECRET;
  if (!secret) {
    return new Response("jobs_not_configured", { status: 500 });
  }

  const provided = getSecret(request);
  if (!provided || provided !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const jobName = await getJobName(request);
  if (!jobName) {
    return new Response(JSON.stringify({ jobs: listJobs() }), { status: 400 });
  }

  const result = await runJob(jobName);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};
