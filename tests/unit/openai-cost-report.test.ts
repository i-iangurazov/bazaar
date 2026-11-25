import { describe, expect, it, vi } from "vitest";
import { fetchOpenAiProjectCosts } from "../../scripts/ops-openai-cost-report";

const input = { projectId: "proj_synthetic", startDate: "2026-11-24", endDateExclusive: "2026-11-26", adminKey: "synthetic-operator" };
const group = (day: number, value: number, project = input.projectId) => ({
  start_time: Date.UTC(2026, 10, day) / 1000,
  results: [{ project_id: project, line_item: "Synthetic service", amount: { currency: "usd", value } }],
});

describe("read-only OpenAI Costs reports", () => {
  it("queries a fixed host, filters to one project and totals all report pages", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [group(24, 0.013)], has_more: true, next_page: "next" }))
      .mockResolvedValueOnce(Response.json({ data: [group(25, 0.022)], has_more: false, next_page: null }));
    expect(await fetchOpenAiProjectCosts(input, fetcher)).toMatchObject({ reportedUsd: 0.035, rows: [
      { date: "2026-11-24", reportedUsd: 0.013 }, { date: "2026-11-25", reportedUsd: 0.022 },
    ] });
    const requests = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    expect(requests[0].origin).toBe("https://api.openai.com");
    expect(requests[0].pathname).toBe("/v1/organization/costs");
    expect(requests[0].searchParams.get("project_ids")).toBe(input.projectId);
    expect(requests[1].searchParams.get("page")).toBe("next");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("rejects out-of-scope amounts and invalid date windows", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      data: [group(25, 0.022, "proj_other")], has_more: false, next_page: null,
    }));
    await expect(fetchOpenAiProjectCosts({ ...input, startDate: "2026-02-30" }, fetcher)).rejects.toThrow("valid UTC dates");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchOpenAiProjectCosts(input, fetcher)).rejects.toThrow("requested project attribution");
  });
});
