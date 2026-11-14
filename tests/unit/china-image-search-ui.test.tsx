// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { ChinaImageSearchPage } from "@/components/china-image-search";

const boundary = vi.hoisted(() => ({
  upload: vi.fn(),
  prep: vi.fn(),
  session: { user: { id: "user-a", organizationId: "org-a", role: "ADMIN" } },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: boundary.session, status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/operations/integrations/china-image-search",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/productImageClientUpload", () => ({
  prepareManagedProductImageForUpload: boundary.prep,
}));
vi.mock("@/lib/productImageUpload", async (original) => ({
  ...(await original<typeof import("@/lib/productImageUpload")>()),
  fetchProductImageUpload: boundary.upload,
}));
const fixture = {
  mode: "demo",
  channel: "1688",
  total: 1,
  items: [
    {
      id: "demo-1",
      title: "Test cup",
      originalTitle: "Cup",
      imageUrl: "/test.jpg",
      sourceUrl: null,
      price: 12.5,
      currency: "CNY",
      seller: null,
    },
  ],
};
const screen = () => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <ChinaImageSearchPage />
  </NextIntlClientProvider>
);
async function select(view: ReturnType<typeof render>) {
  await view.findByRole("button", { name: "Upload a photo" });
  fireEvent.change(view.getByLabelText("Upload a photo"), {
    target: { files: [new File(["image"], "cup.jpg", { type: "image/jpeg" })] },
  });
}
beforeEach(() => {
  boundary.session.user = { id: "user-a", organizationId: "org-a", role: "ADMIN" };
  boundary.upload.mockReset();
  boundary.prep.mockReset();
  boundary.prep.mockImplementation(async ({ file }) => ({ ok: true, file }));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json({ mode: "demo" })),
  );
  URL.createObjectURL = vi.fn().mockReturnValue("blob:isolated-photo");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("photo search workflow", () => {
  it("labels demo cards, uses the existing image preparation, and offers no invented original links", async () => {
    boundary.upload.mockResolvedValue(Response.json(fixture));
    const view = render(screen());
    await select(view);
    fireEvent.click(view.getByRole("button", { name: "Show test cards" }));
    await view.findByText("Test cup");
    expect(view.getByText("Test cards · not 1688 results")).toBeTruthy();
    expect(view.queryByRole("link", { name: "Open on 1688" })).toBeNull();
    expect(boundary.prep).toHaveBeenCalledOnce();
    expect(view.getByLabelText("Take a photo").getAttribute("capture")).toBe("environment");
    fireEvent.click(view.getByRole("button", { name: "Remove photo" }));
    expect(view.queryByText("Test cup")).toBeNull();
  });
  it("requires live photo consent and presents CNY prices, original links and loading feedback", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ mode: "live" }));
    let resolve!: (value: Response) => void;
    boundary.upload.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const view = render(screen());
    await select(view);
    expect((view.getByRole("button", { name: "Search 1688" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(view.getByRole("button", { name: "Search 1688" }));
    await view.findByRole("button", { name: "Searching…" });
    await waitFor(() => expect(boundary.upload).toHaveBeenCalledOnce());
    expect(boundary.upload.mock.calls[0][0].formData.get("consent")).toBe("1");
    await act(async () =>
      resolve(
        Response.json({
          ...fixture,
          mode: "live",
          items: [{ ...fixture.items[0], sourceUrl: "https://detail.1688.com/offer/123.html" }],
        }),
      ),
    );
    const link = await view.findByRole("link", { name: "Open on 1688" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(view.getByText(/12.50/)).toBeTruthy();
  });
  it("keeps the selected photo after failure and retries into a useful empty state", async () => {
    boundary.upload
      .mockResolvedValueOnce(Response.json({ message: "imageSearchTimeout" }, { status: 504 }))
      .mockResolvedValueOnce(Response.json({ ...fixture, total: 0, items: [] }));
    const view = render(screen());
    await select(view);
    fireEvent.click(view.getByRole("button", { name: "Show test cards" }));
    await view.findByRole("alert");
    expect(view.getByText("cup.jpg")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByText("No similar products found. Try another photo or a closer view.");
    expect(boundary.upload).toHaveBeenCalledTimes(2);
  });
  it("discards a previous organization's pending response and photo on identity changes", async () => {
    let resolve!: (response: Response) => void;
    boundary.upload.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const view = render(screen());
    await select(view);
    fireEvent.click(view.getByRole("button", { name: "Show test cards" }));
    await waitFor(() => expect(boundary.upload).toHaveBeenCalledOnce());
    boundary.session.user = { id: "user-b", organizationId: "org-b", role: "MANAGER" };
    view.rerender(screen());
    await view.findByRole("button", { name: "Upload a photo" });
    await act(async () => resolve(Response.json(fixture)));
    expect(view.queryByText("Test cup")).toBeNull();
    expect(view.queryByText("cup.jpg")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:isolated-photo");
  });
  it("recovers a status request failure and hides upload controls when disabled", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ mode: "disabled" }));
    const view = render(screen());
    await view.findByRole("alert");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByText("Search is not connected");
    expect(view.queryByRole("button", { name: "Upload a photo" })).toBeNull();
  });
});
