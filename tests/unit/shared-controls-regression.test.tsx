// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider, useToast } from "@/components/ui/toast";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/products" }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const dictionaries = { ru, kg, en };
function localized(ui: React.ReactNode, locale: keyof typeof dictionaries = "ru") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ common: dictionaries[locale].common }}
      timeZone="Asia/Bishkek"
    >
      <TooltipProvider>
        <ToastProvider>{ui}</ToastProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}
const data = [
  { name: "Чай", qty: 10 },
  { name: "Кофе", qty: 2 },
  { name: "Молоко", qty: 7 },
];
const columns = [
  { accessorKey: "name", header: "Product" },
  { accessorKey: "qty", header: "Quantity" },
];
const quantities = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent);
function FormSample({
  description = true,
  customIds = false,
}: {
  description?: boolean;
  customIds?: boolean;
}) {
  const form = useForm({ defaultValues: { name: "" } });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "Name required" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <input {...field} />
              </FormControl>
              {description && (
                <FormDescription id={customIds ? "custom-guidance" : undefined}>
                  Guidance
                </FormDescription>
              )}
              <FormMessage id={customIds ? "custom-error" : undefined} />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
function assertDescriptions(input: HTMLElement, texts: string[]) {
  const ids = input.getAttribute("aria-describedby")?.split(" ") ?? [];
  expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(texts);
}

describe("shared form descriptions", () => {
  it("does not reference a missing optional description, and attaches/removes real validation feedback", async () => {
    localized(<FormSample description={false} />);
    const input = screen.getByLabelText("Name");
    expect(input.getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => assertDescriptions(input, ["Name required"]));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "Tea" } });
    await waitFor(() => expect(input.getAttribute("aria-describedby")).toBeNull());
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
  it("keeps guidance and actual custom message IDs through validation recovery", async () => {
    localized(<FormSample customIds />);
    const input = screen.getByLabelText("Name");
    assertDescriptions(input, ["Guidance"]);
    expect(input.getAttribute("aria-describedby")).toBe("custom-guidance");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => assertDescriptions(input, ["Guidance", "Name required"]));
    expect(input.getAttribute("aria-describedby")).toBe("custom-guidance custom-error");
    fireEvent.change(input, { target: { value: "Tea" } });
    await waitFor(() => assertDescriptions(input, ["Guidance"]));
  });
  it("updates references when optional description content unmounts", () => {
    function Example() {
      const [show, setShow] = useState(true);
      return (
        <>
          <FormItem>
            <FormLabel>Optional</FormLabel>
            <FormControl>
              <input />
            </FormControl>
            {show && <FormDescription>Optional guidance</FormDescription>}
          </FormItem>
          <button onClick={() => setShow(false)}>Hide guidance</button>
        </>
      );
    }
    localized(<Example />);
    const input = screen.getByLabelText("Optional");
    assertDescriptions(input, ["Optional guidance"]);
    fireEvent.click(screen.getByRole("button", { name: "Hide guidance" }));
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });
});

describe.each(["ru", "kg", "en"] as const)("shared controls in %s", (locale) => {
  it("localizes the real default empty table and preserves supplied empty content", () => {
    const { rerender } = localized(<DataTable columns={columns} data={[]} />, locale);
    expect(screen.getByText(dictionaries[locale].common.nothingFound)).toBeTruthy();
    rerender(
      <NextIntlClientProvider
        locale={locale}
        messages={{ common: dictionaries[locale].common }}
        timeZone="Asia/Bishkek"
      >
        <DataTable columns={columns} data={[]} empty={<p>Custom empty state</p>} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Custom empty state")).toBeTruthy();
    expect(screen.queryByText(dictionaries[locale].common.nothingFound)).toBeNull();
  });
  it("localizes show/hide defaults while retaining the actual secret value", () => {
    localized(<PasswordInput aria-label="Secret" defaultValue="sample-only" />, locale);
    const input = screen.getByLabelText("Secret") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: dictionaries[locale].common.showSecret }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("sample-only");
    const hide = screen.getByRole("button", { name: dictionaries[locale].common.hideSecret });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
    expect(input.value).toBe("sample-only");
  });
});

describe("shared table state", () => {
  it("sorts numeric quantities by their value without modifying the supplied data", () => {
    localized(<DataTable columns={columns} data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    expect(quantities()).toEqual(["10", "7", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    expect(quantities()).toEqual(["2", "7", "10"]);
    expect(data.map((x) => x.qty)).toEqual([10, 2, 7]);
  });
  it("uses a skeleton instead of false empty feedback while initial data is loading", () => {
    localized(<DataTable columns={columns} data={[]} isLoading />);
    expect(screen.queryByText(ru.common.nothingFound)).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });
  it("keeps controlled server order and sends alternating sort requests", () => {
    const onSorting = vi.fn();
    localized(
      <DataTable columns={columns} data={data} manualSorting onSortingChange={onSorting} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    expect(onSorting).toHaveBeenCalledTimes(1);
    expect(onSorting.mock.calls[0][0]([])).toEqual([{ id: "qty", desc: true }]);
    expect(quantities()).toEqual(["10", "2", "7"]);
  });
  it("sorts native table numeric content and keeps interactive headers independent", () => {
    localized(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>
              <button>Header action</button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((x) => (
            <TableRow key={x.name}>
              <TableCell>{x.name}</TableCell>
              <TableCell>{x.qty}</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    expect(quantities()).toEqual(["2", "7", "10"]);
    expect(screen.getAllByRole("button", { name: "Header action" })).toHaveLength(1);
  });
});

describe("disabled shared actions and toast lifecycle", () => {
  it("blocks mouse, auxiliary and keyboard activation of disabled button links", () => {
    const action = vi.fn();
    localized(
      <Button asChild disabled>
        <a href="#forbidden" onClick={action}>
          Disabled action
        </a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Disabled action" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.tabIndex).toBe(-1);
    expect(fireEvent.click(link)).toBe(false);
    expect(
      fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })),
    ).toBe(false);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(link, { key: " " })).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
  it("honors explicit password toggle labels and disabled fields", () => {
    localized(
      <PasswordInput
        aria-label="Disabled"
        disabled
        defaultValue="original"
        showLabel="Reveal key"
        hideLabel="Hide key"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Reveal key" }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect((screen.getByLabelText("Disabled") as HTMLInputElement).type).toBe("password");
  });
  it("announces errors, supports manual dismissal and expires success feedback", () => {
    vi.useFakeTimers();
    function Example() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast({ variant: "error", description: "Request failed" })}>
            Fail
          </button>
          <button onClick={() => toast({ variant: "success", description: "Saved" })}>Save</button>
        </>
      );
    }
    localized(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("alert").textContent).toBe("Request failed");
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: ru.common.close }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Saved");
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("returns focus from a dismissed toast to its invoker without stealing unrelated focus", async () => {
    function Example() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast({ description: "Notice" })}>Notify</button>
          <input aria-label="Other field" />
        </>
      );
    }
    localized(<Example />);
    const trigger = screen.getByRole("button", { name: "Notify" });
    trigger.focus();
    fireEvent.click(trigger);
    const close = within(screen.getByRole("status")).getByRole("button", { name: ru.common.close });
    act(() => close.focus());
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    const other = screen.getByLabelText("Other field");
    other.focus();
    fireEvent.click(
      within(screen.getByRole("status")).getByRole("button", { name: ru.common.close }),
    );
    expect(document.activeElement).toBe(other);
  });
  it("clears outstanding expiry timers when its provider unmounts", () => {
    vi.useFakeTimers();
    function Example() {
      const { toast } = useToast();
      return <button onClick={() => toast({ description: "Notice" })}>Notify</button>;
    }
    const { unmount } = localized(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
