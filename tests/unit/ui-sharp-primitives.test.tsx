// @vitest-environment jsdom

import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { RowActions } from "@/components/row-actions";
import { CopyIcon, ViewIcon } from "@/components/icons";
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
import { TooltipProvider } from "@/components/ui/tooltip";

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

    expect(screen.getByTestId("card").className).toContain("rounded-xl");
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

  it("traps modal focus, hides the background, and restores the trigger", async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open editor
          </button>
          <Modal open={open} onOpenChange={setOpen} title="Edit product" usePortal>
            <input aria-label="Product title" />
            <Button>Save product</Button>
          </Modal>
        </div>
      );
    };

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open editor" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Edit product" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(trigger.closest("[aria-hidden='true']")).not.toBeNull();

    const close = within(dialog).getByRole("button", { name: "close" });
    const save = within(dialog).getByRole("button", { name: "Save product" });
    close.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Edit product" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("portals modals by default and releases interaction when a route-like parent unmounts", async () => {
    const user = userEvent.setup();
    const destinationClick = vi.fn();
    const Harness = () => {
      const [route, setRoute] = useState<"list" | "detail">("list");
      const [open, setOpen] = useState(false);
      if (route === "detail") {
        return <button onClick={destinationClick}>Edit duplicate</button>;
      }
      return (
        <section data-testid="route-content">
          <button onClick={() => setOpen(true)}>Duplicate</button>
          <Modal open={open} onOpenChange={setOpen} title="Duplicate product">
            <Button
              onClick={() => {
                setOpen(false);
                setRoute("detail");
              }}
            >
              Create copy
            </Button>
          </Modal>
        </section>
      );
    };

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    const dialog = screen.getByRole("dialog", { name: "Duplicate product" });
    expect(dialog.closest("[data-testid='route-content']")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Create copy" }));
    const destination = await screen.findByRole("button", { name: "Edit duplicate" });
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    await user.click(destination);
    expect(destinationClick).toHaveBeenCalledOnce();
  });

  it("finishes a row dropdown lifecycle before opening a modal action", async () => {
    const user = userEvent.setup();
    const destinationClick = vi.fn();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      const [route, setRoute] = useState<"list" | "detail">("list");
      if (route === "detail") {
        return <Button onClick={destinationClick}>Edit duplicated product</Button>;
      }
      return (
        <div>
          <RowActions
            maxInline={1}
            moreLabel="More actions"
            actions={[
              { key: "view", label: "View", icon: ViewIcon },
              { key: "duplicate", label: "Duplicate", icon: CopyIcon, onSelect: () => setOpen(true) },
            ]}
          />
          <Modal open={open} onOpenChange={setOpen} title="Duplicate product">
            <Input aria-label="Duplicate title" />
            <Button
              onClick={() => {
                setOpen(false);
                setRoute("detail");
              }}
            >
              Create copy
            </Button>
          </Modal>
        </div>
      );
    };

    render(<TooltipProvider><Harness /></TooltipProvider>);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    const dialog = await screen.findByRole("dialog", { name: "Duplicate product" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(within(dialog).getByRole("textbox", { name: "Duplicate title" }));
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox"));
    await user.click(within(dialog).getByRole("button", { name: "Create copy" }));
    const destination = await screen.findByRole("button", { name: "Edit duplicated product" });
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
    await user.click(destination);
    expect(destinationClick).toHaveBeenCalledOnce();
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

    const zoomEvent = new WheelEvent("wheel", {
      deltaY: -100,
      cancelable: true,
      ctrlKey: true,
    });
    input.dispatchEvent(zoomEvent);
    expect(zoomEvent.defaultPrevented).toBe(false);
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

    const zoomEvent = new WheelEvent("wheel", {
      deltaY: 100,
      cancelable: true,
      metaKey: true,
    });
    input.dispatchEvent(zoomEvent);
    expect(zoomEvent.defaultPrevented).toBe(false);
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

    expect(
      container
        .querySelector('[data-component="data-table"]')
        ?.classList.contains("[contain:layout]"),
    ).toBe(true);
    expect(container.textContent).not.toContain("[object Object]");
    expect(rowNames()).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["Alpha", "Beta"]);
  });
});
