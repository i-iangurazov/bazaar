import { pathToFileURL } from "node:url";
import { z } from "zod";

const endpoint = "https://api.openai.com/v1/organization/costs";
const daySeconds = 86400;
const costsPage = z.object({
  data: z.array(z.object({
    start_time: z.number().int(),
    results: z.array(z.object({
      project_id: z.string(),
      line_item: z.string().nullable(),
      amount: z.object({ value: z.number().finite(), currency: z.literal("usd") }),
    })),
  })),
  has_more: z.boolean(),
  next_page: z.string().max(2000).nullable(),
});

const parseDay = (day: string) => {
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error("Use UTC dates in YYYY-MM-DD format.");
  const value = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== day)
    throw new Error("Enter valid UTC dates in YYYY-MM-DD format.");
  return value.getTime() / 1000;
};

// This GET is deliberately outside the app runtime. An owner runs it with a
// temporary admin key supplied only to this process. OpenAI reports dated
// project totals, not exact per-request charges or remaining credit grants.
// https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs
export async function fetchOpenAiProjectCosts(input: {
  projectId: string;
  startDate: string;
  endDateExclusive: string;
  adminKey: string;
}, fetcher: typeof fetch = fetch) {
  if (!/^proj_[a-zA-Z0-9_-]{1,100}$/.test(input.projectId) || !input.adminKey.trim())
    throw new Error("Supply an OpenAI project ID and an operator admin key.");
  const start = parseDay(input.startDate);
  const end = parseDay(input.endDateExclusive);
  if (end <= start || end - start > daySeconds * 31)
    throw new Error("Select between one and 31 UTC days.");
  const query = new URLSearchParams({
    start_time: String(start), end_time: String(end), bucket_width: "1d", limit: "31",
  });
  query.append("project_ids", input.projectId);
  query.append("group_by", "project_id");
  query.append("group_by", "line_item");

  const lineItems = new Map<string, { date: string; lineItem: string | null; reportedUsd: number }>();
  const cursors = new Set<string>();
  for (let page = 0; page < 31; page += 1) {
    const response = await fetcher(`${endpoint}?${query}`, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${input.adminKey.trim()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`OpenAI Costs API returned HTTP ${response.status}.`);
    const report = costsPage.safeParse(await response.json());
    if (!report.success) throw new Error("OpenAI returned an unexpected Costs report format.");
    for (const bucket of report.data.data) {
      if (bucket.start_time < start || bucket.start_time >= end || bucket.start_time % daySeconds !== 0)
        throw new Error("OpenAI returned a cost bucket outside the requested dates.");
      const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
      for (const result of bucket.results) {
        if (result.project_id !== input.projectId)
          throw new Error("OpenAI returned costs without the requested project attribution.");
        const key = JSON.stringify([date, result.line_item]);
        const previous = lineItems.get(key)?.reportedUsd ?? 0;
        lineItems.set(key, { date, lineItem: result.line_item, reportedUsd: previous + result.amount.value });
      }
    }
    if (!report.data.has_more) {
      const rows = [...lineItems.values()].sort((a, b) => a.date.localeCompare(b.date));
      return {
        projectId: input.projectId,
        startDateUtc: input.startDate,
        endDateExclusiveUtc: input.endDateExclusive,
        reportedUsd: Number(rows.reduce((sum, row) => sum + row.reportedUsd, 0).toFixed(8)),
        rows,
      };
    }
    const cursor = report.data.next_page;
    if (!cursor || cursors.has(cursor)) throw new Error("OpenAI returned an invalid Costs page cursor.");
    cursors.add(cursor);
    query.set("page", cursor);
  }
  throw new Error("OpenAI Costs report exceeded its page limit.");
}

// OPENAI_COSTS_ADMIN_API_KEY is provided out of band. No .env file is loaded.
// node --import tsx scripts/ops-openai-cost-report.ts PROJECT_ID START_DATE END_DATE_EXCLUSIVE
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [projectId = "", startDate = "", endDateExclusive = ""] = process.argv.slice(2);
  fetchOpenAiProjectCosts({ projectId, startDate, endDateExclusive,
    adminKey: process.env.OPENAI_COSTS_ADMIN_API_KEY ?? "" })
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error: unknown) => {
      // No raw provider payloads, fetch diagnostics, or credential fragments.
      const message = error instanceof Error && /^(Use UTC|Enter valid|Supply an|Select between|OpenAI )/.test(error.message)
        ? error.message : "OpenAI Costs did not return a usable report.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
