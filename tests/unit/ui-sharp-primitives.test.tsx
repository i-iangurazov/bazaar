// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GlobalNumberInputGuard } from "@/components/global-number-input-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { PopoverSurface } from "@/components/ui/popover";
import { Select, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("soft-rounded UI primitives", () => {
  it("renders core interactive primitives with small rounded corners", () => {
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

    expect(screen.getByRole("button", { name: "Save" }).className).toContain("rounded-md");
    expect(screen.getByLabelText("name").className).toContain("rounded-md");
    expect(screen.getByLabelText("description").className).toContain("rounded-md");
    expect(screen.getByLabelText("select").className).toContain("rounded-md");
    expect(screen.getByRole("switch", { name: "archive" }).className).toContain("bg-secondary");
    expect(screen.getByRole("switch", { name: "archive" }).className).toContain(
      "data-[state=checked]:bg-primary/10",
    );
    expect(screen.getByText("Active").className).toContain("rounded-md");
    expect(screen.getByText("Active").className).toContain("bg-muted");
    expect(screen.getByText("Missing price").className).toContain("bg-danger/10");
  });

  it("renders layout surfaces with small rounded corners", () => {
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

    expect(screen.getByTestId("card").className).toContain("rounded-md");
    expect(screen.getByTestId("table-container").className).toContain("rounded-md");
    expect(screen.getByTestId("popover").className).toContain("rounded-md");
    expect(screen.getByTestId("tabs-list").className).toContain("rounded-md");
    expect(screen.getByRole("tab", { name: "Overview" }).className).toContain("rounded-md");
    expect(screen.getByTestId("tabs-panel").className).toContain("rounded-md");
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

    expect(screen.getByRole("dialog", { name: "Confirm" }).className).toContain("rounded-md");
    const footer = screen.getByRole("button", { name: "Apply" }).parentElement;
    expect(footer?.className).toContain("flex-col-reverse");
    expect(footer?.className).toContain("sm:justify-end");
  });

  it("prevents trackpad wheel changes on focused number inputs", () => {
    render(<Input aria-label="quantity" type="number" defaultValue="5" />);

    const input = screen.getByLabelText("quantity");
    input.focus();
    const wheelEvent = new WheelEvent("wheel", { deltaY: -100, cancelable: true });

    input.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("prevents trackpad wheel changes on native number inputs globally", () => {
    render(
      <div>
        <GlobalNumberInputGuard />
        <input aria-label="raw quantity" type="number" defaultValue="5" />
      </div>,
    );

    const input = screen.getByLabelText("raw quantity");
    input.focus();
    const wheelEvent = new WheelEvent("wheel", { deltaY: 100, cancelable: true });

    input.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("sorts table rows from reusable headers", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Qty</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Beta</TableCell>
            <TableCell>10</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Alpha</TableCell>
            <TableCell>2</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const rowNames = () =>
      Array.from(container.querySelectorAll("tbody tr")).map(
        (row) => row.querySelector("td")?.textContent,
      );

    expect(rowNames()).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["Alpha", "Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Qty" }));
    expect(rowNames()).toEqual(["Alpha", "Beta"]);
  });
});
