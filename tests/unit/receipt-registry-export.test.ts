import { describe, expect, it, vi } from "vitest";

import { fetchAllReceiptPages } from "@/components/pos/receipt-registry-export";

describe("receipt registry export pagination", () => {
  it("fetches every server page beyond the 100-row API limit", async () => {
    const source = Array.from({ length: 235 }, (_, index) => ({ id: `receipt-${index + 1}` }));
    const fetchPage = vi.fn(async (page: number, pageSize: number) => ({
      items: source.slice((page - 1) * pageSize, page * pageSize),
      total: source.length,
    }));

    const rows = await fetchAllReceiptPages({ fetchPage, pageSize: 100 });

    expect(fetchPage.mock.calls).toEqual([
      [1, 100],
      [2, 100],
      [3, 100],
    ]);
    expect(rows).toHaveLength(235);
    expect(rows[0]?.id).toBe("receipt-1");
    expect(rows[234]?.id).toBe("receipt-235");
  });

  it("does not request phantom pages for an empty export", async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as Array<{ id: string }>, total: 0 }));

    await expect(fetchAllReceiptPages({ fetchPage })).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
