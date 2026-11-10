// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Line, LineChart, XAxis } from "recharts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("React library compatibility", () => {
  it("renders chart series and axes nested in a fragment with the installed React renderer", () => {
    const { container } = render(
      <LineChart width={640} height={320} data={[{ day: "Mon", amount: 100 }, { day: "Tue", amount: 150 }]}>
        <>
          <XAxis dataKey="day" />
          <Line dataKey="amount" isAnimationActive={false} />
        </>
      </LineChart>,
    );
    // Recharts 2 uses react-is for Fragment traversal. A mismatched React 18
    // react-is package can silently omit every series under React 19.
    const line = container.querySelector("path.recharts-line-curve");
    expect(line?.getAttribute("d")).toMatch(/^M.+L/);
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Tue")).toBeTruthy();
  });

  it("recovers an actual query subscription after a rejected request without remounting its provider", async () => {
    const load = vi.fn<() => Promise<{ store: string; stock: number }>>()
      .mockRejectedValueOnce(new Error("temporary request failure"))
      .mockResolvedValue({ store: "Synthetic store", stock: 7 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } });
    const Probe = () => {
      const query = useQuery({ queryKey: ["synthetic-react-compat"], queryFn: load });
      return (
        <div>
          <p>{query.isError ? "Request failed" : query.data ? `${query.data.store}: ${query.data.stock}` : "Loading"}</p>
          <button onClick={() => void query.refetch()} disabled={query.isFetching}>Retry</button>
        </div>
      );
    };
    try {
      const view = render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
      expect(await screen.findByText("Request failed")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Synthetic store: 7")).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      client.clear();
    }
  });
});
