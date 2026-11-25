// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRef, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { DataTable } from "@/components/ui/data-table";
import { FilterField, ListToolbar } from "@/components/list-toolbar";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/row-actions";
import { Field } from "@/components/form-layout";
import { Button } from "@/components/ui/button";

afterEach(cleanup);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={{ common: en.common, workspace: en.workspace }}>
    <TooltipProvider>{children}</TooltipProvider>
  </NextIntlClientProvider>
);
describe("workspace controls", () => {
  it("prevents disabled link buttons from activating their child action", () => {
    const click = vi.fn();
    render(
      <Button asChild disabled>
        <a href="/pos/sell" onClick={click}>
          Start sale
        </a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Start sale" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.tabIndex).toBe(-1);
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it("connects a form label, helper and validation focus when FormControl wraps Select.Root", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <FormItem>
        <FormLabel>Store</FormLabel>
        <FormControl>
          <Select ref={ref} value="shop" aria-invalid="true">
            <SelectTrigger>
              <SelectValue placeholder="Choose a store" />
            </SelectTrigger>
          </Select>
        </FormControl>
        <FormDescription>Only accessible stores</FormDescription>
      </FormItem>,
    );
    const trigger = screen.getByRole("combobox", { name: "Store" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Only accessible stores",
    );
    expect(ref.current).toBe(trigger);
    ref.current?.focus();
    expect(document.activeElement).toBe(trigger);
  });
  it("keeps a required server sort reversible after repeated header clicks", () => {
    function ServerList() {
      const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
      return (
        <DataTable
          columns={[{ accessorKey: "name", header: "Name" }]}
          data={[{ name: "Tea" }]}
          manualSorting
          sorting={sorting}
          onSortingChange={(update) => {
            const next = typeof update === "function" ? update(sorting) : update;
            if (next.length) setSorting(next);
          }}
        />
      );
    }
    render(<ServerList />);
    const header = screen.getByRole("columnheader", { name: "Name" });
    const button = screen.getByRole("button", { name: "Name" });
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    for (const direction of ["descending", "ascending", "descending", "ascending"]) {
      fireEvent.click(button);
      expect(header.getAttribute("aria-sort")).toBe(direction);
    }
  });
  it("keeps page size and result scope available when all records fit on one page", () => {
    const changePage = vi.fn();
    render(
      <DataTable
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={[{ id: "a", name: "Tea" }]}
        getRowId={(row) => row.id}
        pagination={{
          page: 1,
          pageSize: 25,
          totalItems: 1,
          onPageChange: changePage,
          onPageSizeChange: vi.fn(),
          labels: {
            items: (from, to, total) => `${from}–${to} of ${total}`,
            rowsPerPage: <strong>Rows per page</strong>,
            page: (page, total) => `${page} of ${total}`,
            previous: "Previous",
            next: "Next",
          },
        }}
      />,
      { wrapper },
    );
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(changePage).not.toHaveBeenCalled();
  });
  it("exposes active advanced filters even while their controls are collapsed", () => {
    const remove = vi.fn();
    const reset = vi.fn();
    render(
      <ListToolbar
        filters={[{ key: "status", label: "Draft", onRemove: remove }]}
        extraCount={1}
        total={7}
        onReset={reset}
        extra={
          <FilterField id="advanced" label="Status">
            <Input id="advanced" />
          </FilterField>
        }
      >
        <Input aria-label="Search" />
      </ListToolbar>,
      { wrapper },
    );
    expect(screen.queryByRole("textbox", { name: "Status" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: en.workspace.removeFilter.replace("{filter}", "Draft") }),
    );
    expect(remove).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.workspace.moreFilters) }));
    expect(screen.getByRole("textbox", { name: "Status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.workspace.resetFilters }));
    expect(reset).toHaveBeenCalledOnce();
  });
  it("keeps one contextual search and the active scope while compact filters are toggled", () => {
    const remove = vi.fn();
    const changeSearch = vi.fn();
    render(
      <ListToolbar
        compactMobile={{
          search: <Input type="search" aria-label="Search orders" onChange={changeSearch} />,
          scope: "Central",
          extraCount: 1,
        }}
        filters={[{ key: "employee", label: "Dana", onRemove: remove }]}
        extra={<Input aria-label="Order status" />}
        total={2}
      >
        <FilterField id="compact-order-employee" label="Employee">
          <Input id="compact-order-employee" />
        </FilterField>
      </ListToolbar>,
      { wrapper },
    );

    const search = screen.getByRole("searchbox", { name: "Search orders" });
    const toggle = screen.getByRole("button", {
      name: en.workspace.moreFiltersWithCount.replace("{count}", "1"),
    });
    const [fieldsId, extraId] = toggle.getAttribute("aria-controls")!.split(" ");
    const fields = document.getElementById(fieldsId)!;
    const advanced = document.getElementById(extraId)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fields.classList.contains("max-md:hidden")).toBe(true);
    expect(advanced.hidden).toBe(true);
    expect(toggle.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Central")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: en.workspace.removeFilter.replace("{filter}", "Dana") }),
    );
    expect(remove).toHaveBeenCalledOnce();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fields.classList.contains("max-md:hidden")).toBe(false);
    expect(advanced.hidden).toBe(false);
    expect(screen.getByLabelText("Employee")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search orders" })).toBe(search);
    fireEvent.change(search, { target: { value: "10024" } });
    expect(changeSearch).toHaveBeenCalledOnce();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(advanced.hidden).toBe(true);
  });
  it("keeps ordinary edit navigation in the current tab while honoring explicit external views", () => {
    const Icon = () => <svg aria-hidden />;
    render(
      <RowActions
        moreLabel="Actions"
        actions={[
          {
            key: "edit",
            href: "/products/a?returnTo=%2Fproducts%3Fq%3Dtea",
            label: "Edit",
            icon: Icon,
          },
          { key: "print", href: "/print/a", label: "Print", icon: Icon, openInNewTab: true },
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "Print" }).getAttribute("target")).toBe("_blank");
  });
  it("associates report fields with their labels and exposes validation feedback", () => {
    render(
      <Field htmlFor="period" label="Period" error="Choose a period">
        <Input id="period" aria-invalid />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Period" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Choose a period");
  });
});
