// @vitest-environment jsdom

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResponsiveDataList } from "@/components/responsive-data-list";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

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
