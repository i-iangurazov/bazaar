// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { ProductPhotoSearchButton } from "@/components/products/product-photo-search";
const boundary = vi.hoisted(() => ({ prep: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
vi.mock("@/lib/productImageClientUpload", () => ({ prepareManagedProductImageForUpload: boundary.prep }));
vi.mock("react-easy-crop", () => ({ default: ({ onCropComplete }: { onCropComplete: (area: { x: number; y: number; width: number; height: number }) => void }) =>
  <button type="button" onClick={() => onCropComplete({ x: 25, y: 10, width: 50, height: 80 })}>Set test selection</button> }));
const progress = { total: 1, ready: 1, pending: 0, failed: 0, withoutPhoto: 0 };
const result = { storeId: "s1", currencyCode: "KGS", currencyRateKgsPerUnit: 1, progress, partial: false,
  items: [{ id: "p1", name: "Red cup", sku: "CUP", imageUrl: "/cup.jpg", priceKgs: 120, onHand: 0 }] };
const screen = (identity = "org-a:user", storeId = "s1") => <NextIntlClientProvider locale="en" messages={messages}>
  <ProductPhotoSearchButton identityKey={identity} storeId={storeId} stores={[{ id: "s1", name: "Shop" }, { id: "s2", name: "Second shop" }]} />
</NextIntlClientProvider>;
async function select(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "Search by photo" }));
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  fireEvent.change(view.getByLabelText("Upload a photo"), { target: { files: [new File(["jpeg"], "cup.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect((view.getByRole("button", { name: "Find similar" }) as HTMLButtonElement).disabled).toBe(false));
}
beforeEach(() => {
  boundary.push.mockReset(); boundary.prep.mockReset(); boundary.prep.mockImplementation(async ({ file }) => ({ ok: true, file }));
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => Response.json(!init?.method ? { configured: true, progress } :
    String(_url).endsWith("/prepare") ? { progress } : result)));
  URL.createObjectURL = vi.fn().mockReturnValue("blob:photo"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("store photo search interaction", () => {
  it("prepares the existing upload, shows real candidate fields and requires an explicit choice", async () => {
    const view = render(screen()); await select(view);
    expect(view.getByLabelText("Take a photo").getAttribute("capture")).toBe("environment");
    fireEvent.click(view.getByRole("button", { name: "Find similar" }));
    await view.findByText("Red cup"); expect(boundary.prep).toHaveBeenCalledOnce(); expect(boundary.push).not.toHaveBeenCalled();
    fireEvent.click(view.getByText("Red cup")); expect(boundary.push).not.toHaveBeenCalled();
    expect(view.getByText("In stock: 0")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Choose product Red cup" }));
    expect(boundary.push).toHaveBeenCalledWith(expect.stringContaining("/products/p1?storeId=s1"));
  });
  it("keeps a photo after failure, retries and shows a useful empty state", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!; let queries = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => init?.method === "POST" && !String(url).endsWith("/prepare")
      ? ++queries === 1 ? Response.json({ message: "photoSearchTimeout" }, { status: 504 }) : Response.json({ ...result, items: [] }) : original(url, init));
    const view = render(screen()); await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
    await view.findByRole("alert"); expect(view.getByText("cup.jpg")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByText(messages.productPhotoSearch.empty); expect(queries).toBe(2);
  });
  it("ignores a canceled response and clears photos/results when identity or store changes", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!; let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url, init) => init?.method === "POST" && !String(url).endsWith("/prepare") ? new Promise((resolve) => { finish = resolve; }) : original(url, init));
    const view = render(screen()); await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await act(async () => finish(Response.json(result))); expect(view.queryByText("Red cup")).toBeNull();
    view.rerender(screen("org-b:user-b", "s2"));
    expect(view.queryByRole("dialog")).toBeNull(); expect(view.queryByText("cup.jpg")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo");
  });
  it("recovers an unconfigured status without a page refresh", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ configured: false, progress }));
    const view = render(screen()); fireEvent.click(view.getByRole("button", { name: "Search by photo" }));
    await view.findByText(messages.productPhotoSearch.notConnected);
    expect((view.getByRole("button", { name: "Find similar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(view.queryByText(messages.productPhotoSearch.notConnected)).toBeNull());
  });
});

it("supports a read-only selection in POS without navigating or mutating a sale", async () => {
  const view = render(<NextIntlClientProvider locale="en" messages={messages}>
    <ProductPhotoSearchButton identityKey="staff-org" storeId="s1" stores={[{ id: "s1", name: "Shop" }]} selectionMode="preview" />
  </NextIntlClientProvider>);
  await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  await view.findByText("Red cup"); fireEvent.click(view.getByRole("button", { name: "Choose product Red cup" }));
  await view.findByText("Selected product"); expect(boundary.push).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Back to similar products" })); expect(view.queryByText("Selected product")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("/api/products/photo-search"))).toBe(true);
});

it("does not cancel the initial availability check when a photo is chosen immediately", async () => {
  let status!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { status = resolve; }));
  const view = render(screen()); fireEvent.click(view.getByRole("button", { name: "Search by photo" }));
  fireEvent.change(view.getByLabelText("Upload a photo"), { target: { files: [new File(["jpeg"], "quick.jpg", { type: "image/jpeg" })] } });
  await act(async () => status(Response.json({ configured: true, progress })));
  await waitFor(() => expect((view.getByRole("button", { name: "Find similar" }) as HTMLButtonElement).disabled).toBe(false));
});

it("shows distinct lookalike SKUs and requires choosing the intended candidate", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === "POST" && !String(url).endsWith("/prepare")
    ? Promise.resolve(Response.json({ ...result, items: [result.items[0], { ...result.items[0], id: "p2", name: "Blue cup", sku: "CUP-BLUE" }] })) : original(url, init));
  const view = render(screen()); await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  await view.findByText("Blue cup"); expect(view.getByText("CUP-BLUE")).toBeTruthy();
  expect(view.getByText(messages.productPhotoSearch.compareVariants)).toBeTruthy();
  expect(boundary.push).not.toHaveBeenCalled();
  fireEvent.click(view.getByText("Blue cup")); expect(boundary.push).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Choose product Blue cup" }));
  expect(boundary.push).toHaveBeenCalledWith(expect.stringContaining("/products/p2?storeId=s1"));
});

it("reports real catalog progress only, and cancel removes loading feedback", async () => {
  const pending = { ...progress, total: 10, ready: 3, failed: 1, pending: 6 };
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith("/prepare") ? Promise.resolve(Response.json({ progress: pending })) : original(url, init));
  const view = render(screen()); await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  const bar = await view.findByRole("progressbar"); expect(bar.getAttribute("aria-valuenow")).toBe("4"); expect(bar.getAttribute("aria-valuemax")).toBe("10");
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByRole("progressbar")).toBeNull(); expect(view.queryByText(messages.productPhotoSearch.searching)).toBeNull();
});

it("keeps incomplete results explicit and does not manufacture a confidence percentage", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === "POST" && !String(url).endsWith("/prepare")
    ? Promise.resolve(Response.json({ ...result, partial: true, progress: { ...progress, total: 2, failed: 1 } })) : original(url, init));
  const view = render(screen()); await select(view); fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  await view.findByText("Red cup"); expect(view.getByText("Searched a subset of photos: 1 of 2. Failed to process: 1.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Retry photo preparation" })).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/\d+%/);
});

it("sends the selected region, supports the whole photo, and keeps OCR evidence distinct from visual identity", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === "POST" && !String(url).endsWith("/prepare")
    ? Promise.resolve(Response.json({ ...result, items: [{ ...result.items[0], labelMatched: true, matchSource: "text" }], recognition: { regionSource: "manual", region: { x: .25, y: .1, width: .5, height: .8 }, labelStatus: "matched", text: "RED CUP" } })) : original(url, init));
  const view = render(screen()); await select(view);
  const photo = view.getByAltText("Photo for search");
  Object.defineProperties(photo, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } }); fireEvent.load(photo);
  fireEvent.click(view.getByRole("button", { name: "Select product area" }));
  fireEvent.click(await view.findByRole("button", { name: "Set test selection" }));
  fireEvent.click(view.getByRole("button", { name: "Use selection" }));
  fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  await view.findByText("From text in photo");
  expect(view.getByText(messages.productPhotoSearch.textOnlyHelp)).toBeTruthy(); expect(boundary.push).not.toHaveBeenCalled();
  const requests = () => vi.mocked(fetch).mock.calls.filter(([url, init]) => init?.method === "POST" && !String(url).endsWith("/prepare"));
  expect(JSON.parse((requests()[0][1]!.body as FormData).get("region") as string)).toEqual({ x: .25, y: .1, width: .5, height: .8 });
  fireEvent.click(view.getByRole("button", { name: "Use the whole photo" }));
  fireEvent.click(view.getByRole("button", { name: "Find similar" }));
  await view.findByText("From text in photo");
  const body = requests()[1][1]!.body as FormData;
  expect(body.get("region")).toBeNull(); expect(body.get("autoRegion")).toBe("0");
});
