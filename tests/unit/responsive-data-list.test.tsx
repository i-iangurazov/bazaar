// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResponsiveDataList } from "@/components/responsive-data-list";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

afterEach(cleanup);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderServerPaginatedList = (onPageChange: (page: number) => void, page = 1) => (
  <ResponsiveDataList
    items={[{ id: "row-1", label: "Movement" }]}
    getKey={(item) => item.id}
    page={page}
    totalItems={40}
    onPageChange={onPageChange}
    onPageSizeChange={() => undefined}
    renderDesktop={(items) => (
      <div>
        {items.map((item) => (
          <span key={item.id}>{item.label}</span>
        ))}
      </div>
    )}
    renderMobile={(item) => <span>{item.label}</span>}
  />
);

describe("ResponsiveDataList", () => {
  it("preserves the requested server page on mount and callback changes", async () => {
    const firstOnPageChange = vi.fn();
    const secondOnPageChange = vi.fn();
    const { rerender } = render(renderServerPaginatedList(firstOnPageChange, 2));

    await tick();
    expect(firstOnPageChange).not.toHaveBeenCalled();

    rerender(renderServerPaginatedList(secondOnPageChange, 2));
    await tick();

    expect(secondOnPageChange).not.toHaveBeenCalled();
  });
});

it("changes the server page size once without a stale page reset and restores the caller's size", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const onPageChange = vi.fn(),
    onPageSizeChange = vi.fn();
  const list = (size: number, page: number) => (
    <ResponsiveDataList
      items={[{ id: "one" }]}
      getKey={(item) => item.id}
      totalItems={400}
      page={page}
      defaultPageSize={size}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      renderDesktop={() => <div>Rows</div>}
      renderMobile={() => <div>Rows</div>}
    />
  );
  const view = render(list(25, 2));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "10" }));
  await waitFor(() => expect(onPageSizeChange).toHaveBeenCalledTimes(1));
  expect(onPageSizeChange).toHaveBeenCalledWith(10);
  await tick();
  expect(onPageChange).not.toHaveBeenCalled();
  // A delayed router response atomically applies both values.
  view.rerender(list(10, 1));
  await waitFor(() => expect(screen.getByRole("combobox").textContent).toBe("10"));
  expect(onPageChange).not.toHaveBeenCalled();
  view.rerender(list(50, 3));
  await waitFor(() => expect(screen.getByRole("combobox").textContent).toBe("50"));
  expect(onPageChange).not.toHaveBeenCalled();
});
