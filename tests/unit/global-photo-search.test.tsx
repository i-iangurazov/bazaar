// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalPhotoSearch } from "@/components/products/global-photo-search";
import messages from "../../messages/en.json";

const boundary = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { stores: { list: { useQuery: boundary.query } } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
const mount = () => render(<NextIntlClientProvider locale="en" messages={messages}>
  <GlobalPhotoSearch identityKey="org:user" canViewProducts={false} />
</NextIntlClientProvider>);

it("opens the shared dialog from the named icon and requires a store instead of picking the first", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  boundary.query.mockReturnValue({ data: [{ id: "s1", name: "First" }, { id: "s2", name: "Second" }], isLoading: false });
  const view = mount();
  const button = view.getByRole("button", { name: "Search by photo" });
  expect(button.textContent).toBe("");
  fireEvent.click(button);
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(view.getByRole("combobox").textContent).toBe(messages.common.selectStore);
  expect(fetch).not.toHaveBeenCalled();
  expect((view.getByRole("button", { name: "Find similar" }) as HTMLButtonElement).disabled).toBe(true);
  vi.unstubAllGlobals();
});

it("keeps the entry usable during store-list failure and offers retry inside the dialog", () => {
  boundary.query.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: boundary.retry });
  const view = mount(); fireEvent.click(view.getByRole("button", { name: "Search by photo" }));
  expect(view.getByRole("alert")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(boundary.retry).toHaveBeenCalledOnce();
});
