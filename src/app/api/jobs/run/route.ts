import { listJobs, runJob } from "@/server/jobs";
import type { JobPayload } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getSecret = (request: Request) => {
  return request.headers.get("x-job-secret") ?? "";
};

const MAX_JOB_REQUEST_BYTES = 16 * 1024;

type JobInvocation = {
  jobName: string;
  payload?: JobPayload;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getJobInvocation = async (request: Request): Promise<JobInvocation> => {
  const url = new URL(request.url);
  const queryJob = url.searchParams.get("job")?.trim() ?? "";
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_JOB_REQUEST_BYTES) {
    throw new Error("job_request_too_large");
  }

  let body: Record<string, unknown> | null = null;
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("invalid_job_request");
      }
      body = parsed;
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_job_request") {
        throw error;
      }
      throw new Error("invalid_job_json");
    }
  }

  const bodyJob = typeof body?.job === "string" ? body.job.trim() : "";
  if (queryJob && bodyJob && queryJob !== bodyJob) {
    throw new Error("job_name_conflict");
  }

  const jobName = queryJob || bodyJob;
  if (!body) {
    return { jobName };
  }

  if ("payload" in body) {
    return { jobName, payload: body.payload as JobPayload };
  }

  const inlinePayload = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "job"),
  );
  return {
    jobName,
    payload: Object.keys(inlinePayload).length > 0 ? inlinePayload as JobPayload : undefined,
  };
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

  let invocation: JobInvocation;
  try {
    invocation = await getJobInvocation(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_job_request";
    const status = code === "job_request_too_large" ? 413 : 400;
    return Response.json({ error: code }, { status });
  }

  const { jobName, payload } = invocation;
  if (!jobName) {
    return new Response(JSON.stringify({ jobs: listJobs() }), { status: 400 });
  }

  const result = await runJob(jobName, payload);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};
