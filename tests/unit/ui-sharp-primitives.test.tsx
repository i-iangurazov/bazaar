// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";

import { GlobalNumberInputGuard } from "@/components/global-number-input-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { PopoverSurface } from "@/components/ui/popover";
import { Select, SelectTrigger } from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
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
        <Checkbox aria-label="selected" />
        <Badge>Active</Badge>
        <Badge variant="danger">Missing price</Badge>
        <Alert>Saved</Alert>
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
    expect(screen.getByRole("checkbox", { name: "selected" }).className).toContain(
      "data-[state=checked]:bg-primary",
    );
    expect(screen.getByText("Active").className).toContain("rounded-md");
    expect(screen.getByText("Active").className).toContain("bg-muted");
    expect(screen.getByText("Missing price").className).toContain("bg-danger/10");
    expect(screen.getByText("Saved").className).toContain("rounded-md");
  });

  it("renders layout surfaces with small rounded corners", () => {
    render(
      <div>
        <Card data-testid="card" />
        <TableContainer data-testid="table-container" />
        <PopoverSurface data-testid="popover" />
        <Skeleton data-testid="skeleton" />
        <EmptyState title="Nothing here" />
        <Pagination data-testid="pagination">
          <PaginationContent>
            <PaginationItem>1</PaginationItem>
          </PaginationContent>
        </Pagination>
        <TabsList data-testid="tabs-list">
          <TabsTrigger active>Overview</TabsTrigger>
        </TabsList>
        <TabsPanel data-testid="tabs-panel" />
      </div>,
    );

    expect(screen.getByTestId("card").className).toContain("rounded-md");
    expect(screen.getByTestId("table-container").className).toContain("rounded-md");
    expect(screen.getByTestId("popover").className).toContain("rounded-md");
    expect(screen.getByTestId("skeleton").className).toContain("rounded-md");
    expect(screen.getByText("Nothing here").className).toContain("text-sm");
    expect(screen.getByTestId("pagination").className).toContain("items-center");
    expect(screen.getByTestId("tabs-list").className).toContain("rounded-md");
    expect(screen.getByRole("tab", { name: "Overview" }).className).toContain("rounded-md");
    expect(screen.getByTestId("tabs-panel").className).toContain("rounded-md");
  });

  it("allows form labels in read-only detail contexts without form state", () => {
    render(
      <div>
        <FormLabel htmlFor="standalone-stock">Остаток в магазине</FormLabel>
        <FormItem>
          <FormLabel htmlFor="readonly-comment">Комментарий</FormLabel>
        </FormItem>
      </div>,
    );

    expect(screen.getByText("Остаток в магазине").getAttribute("for")).toBe("standalone-stock");
    expect(screen.getByText("Комментарий").getAttribute("for")).toBe("readonly-comment");
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

  it("renders shadcn-style dialog and sheet surfaces with reachable footers", () => {
    const dialog = render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>Update lines</DialogDescription>
          </DialogHeader>
          <DialogBody>Scrollable content</DialogBody>
          <DialogFooter>
            <Button>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "Edit document" }).className).toContain(
      "overflow-hidden",
    );
    expect(screen.getByRole("button", { name: "Save" }).parentElement?.className).toContain(
      "border-t",
    );
    dialog.unmount();

    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Drawer</SheetTitle>
            <SheetDescription>Mobile editing</SheetDescription>
          </SheetHeader>
          <SheetBody>Drawer content</SheetBody>
          <SheetFooter>
            <Button>Apply</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog", { name: "Drawer" }).className).toContain("fixed");
    expect(screen.getByRole("button", { name: "Apply" }).parentElement?.className).toContain(
      "border-t",
    );
  });

  it("renders sidebar navigation primitives with Bazaar blue active states", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Inventory</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>Movements</SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    const activeItem = screen.getByRole("button", { name: "Movements" });
    expect(activeItem.getAttribute("data-active")).toBe("true");
    expect(activeItem.className).toContain("data-[active=true]:bg-sidebar-primary/10");
    expect(activeItem.className).toContain("data-[active=true]:text-sidebar-primary");
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

  it("sorts DataTable rows through TanStack columns without rendering raw objects", () => {
    type Row = { id: string; name: string; quantity: number };
    const rows: Row[] = [
      { id: "2", name: "Beta", quantity: 10 },
      { id: "1", name: "Alpha", quantity: 2 },
    ];
    const columns: ColumnDef<Row>[] = [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: "quantity",
        header: "Qty",
        cell: ({ row }) => row.original.quantity,
        meta: { className: "text-right" },
      },
    ];

    const { container } = render(
      <DataTable columns={columns} data={rows} getRowId={(row) => row.id} />,
    );
    const rowNames = () =>
      Array.from(container.querySelectorAll("tbody tr")).map(
        (row) => row.querySelector("td")?.textContent,
      );

    expect(container.textContent).not.toContain("[object Object]");
    expect(rowNames()).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["Alpha", "Beta"]);
  });
});
