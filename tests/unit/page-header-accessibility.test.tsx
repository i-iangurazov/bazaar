// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/page-breadcrumbs", () => ({
  PageBreadcrumbs: () => null,
}));

import { PageHeader } from "@/components/page-header";

describe("PageHeader accessibility", () => {
  it("exposes the authenticated page title as the level-one heading", () => {
    render(<PageHeader title="Inventory" subtitle="Current stock" />);

    expect(screen.getByRole("heading", { level: 1, name: "Inventory" })).toBeTruthy();
    expect(screen.getByText("Current stock")).toBeTruthy();
  });
});
