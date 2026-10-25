// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";

afterEach(cleanup);

function Example() {
  const [active, setActive] = useState("overview");
  return (
    <Tabs>
      <TabsList aria-label="Report sections">
        <TabsTrigger active={active === "overview"} onClick={() => setActive("overview")}>
          Overview
        </TabsTrigger>
        <TabsTrigger disabled>Unavailable</TabsTrigger>
        <TabsTrigger active={active === "details"} onClick={() => setActive("details")}>
          Details
        </TabsTrigger>
      </TabsList>
      <TabsPanel>{active}</TabsPanel>
    </Tabs>
  );
}

describe("Espresso tab navigation", () => {
  it("moves focus and selection with arrows, skips disabled tabs and wraps", () => {
    render(<Example />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const details = screen.getByRole("tab", { name: "Details" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(document.activeElement).toBe(details);
    expect(details.getAttribute("aria-selected")).toBe("true");
    expect(details.tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").textContent).toBe("details");
    fireEvent.keyDown(details, { key: "ArrowRight" });
    expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: "End" });
    expect(document.activeElement).toBe(details);
    fireEvent.keyDown(details, { key: "Home" });
    expect(document.activeElement).toBe(overview);
  });

  it("keeps the visual state consistent when the caller supplies aria-selected", () => {
    render(<TabsTrigger aria-selected="true">Selected</TabsTrigger>);
    const selected = screen.getByRole("tab", { name: "Selected" });
    expect(selected.getAttribute("data-state")).toBe("active");
    expect(selected.tabIndex).toBe(0);
    expect(selected.className).toContain("text-primary");
  });

  it("uses explicit aria-selected for appearance and keyboard state even if active disagrees", () => {
    render(
      <TabsTrigger active aria-selected={false}>
        Unselected
      </TabsTrigger>,
    );
    const unselected = screen.getByRole("tab", { name: "Unselected" });
    expect(unselected.getAttribute("aria-selected")).toBe("false");
    expect(unselected.getAttribute("data-state")).toBe("inactive");
    expect(unselected.tabIndex).toBe(-1);
    expect(unselected.className).not.toContain("text-primary");
  });
});
