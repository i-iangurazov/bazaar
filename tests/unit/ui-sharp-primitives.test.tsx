// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { PopoverSurface } from "@/components/ui/popover";
import { Select, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableContainer } from "@/components/ui/table";
import { TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("sharp UI primitives", () => {
  it("renders core interactive primitives with square corners", () => {
    render(
      <div>
        <Button>Save</Button>
        <Input aria-label="name" />
        <Textarea aria-label="description" />
        <Select>
          <SelectTrigger aria-label="select" />
        </Select>
        <Switch aria-label="archive" />
        <Badge>Active</Badge>
        <Badge variant="danger">Missing price</Badge>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Save" }).className).toContain("rounded-none");
    expect(screen.getByLabelText("name").className).toContain("rounded-none");
    expect(screen.getByLabelText("description").className).toContain("rounded-none");
    expect(screen.getByLabelText("select").className).toContain("rounded-none");
    expect(screen.getByRole("switch", { name: "archive" }).className).toContain("bg-secondary");
    expect(screen.getByRole("switch", { name: "archive" }).className).toContain(
      "data-[state=checked]:bg-primary/10",
    );
    expect(screen.getByText("Active").className).toContain("rounded-none");
    expect(screen.getByText("Active").className).toContain("bg-muted");
    expect(screen.getByText("Missing price").className).toContain("bg-danger/10");
  });

  it("renders layout surfaces with square corners", () => {
    render(
      <div>
        <Card data-testid="card" />
        <TableContainer data-testid="table-container" />
        <PopoverSurface data-testid="popover" />
        <TabsList data-testid="tabs-list">
          <TabsTrigger active>Overview</TabsTrigger>
        </TabsList>
        <TabsPanel data-testid="tabs-panel" />
      </div>,
    );

    expect(screen.getByTestId("card").className).toContain("rounded-none");
    expect(screen.getByTestId("table-container").className).toContain("rounded-none");
    expect(screen.getByTestId("popover").className).toContain("rounded-none");
    expect(screen.getByTestId("tabs-list").className).toContain("rounded-none");
    expect(screen.getByRole("tab", { name: "Overview" }).className).toContain("rounded-none");
    expect(screen.getByTestId("tabs-panel").className).toContain("rounded-none");
  });

  it("keeps dialogs and modal footers consistent", () => {
    render(
      <Modal open onOpenChange={() => undefined} title="Confirm">
        <ModalFooter>
          <Button variant="secondary">Cancel</Button>
          <Button>Apply</Button>
        </ModalFooter>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Confirm" }).className).toContain("rounded-none");
    const footer = screen.getByRole("button", { name: "Apply" }).parentElement;
    expect(footer?.className).toContain("flex-col-reverse");
    expect(footer?.className).toContain("sm:justify-end");
  });
});
