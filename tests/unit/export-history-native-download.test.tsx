// @vitest-environment jsdom

import React from "react";
import type { ExportJob } from "@prisma/client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HistoryJob = ExportJob & { downloadAvailable: boolean; downloadUrl: string | null; downloadUnavailableReason: "exportFileMissing" | null };
type Action = { key: string; label: string; href?: string; disabled?: boolean; onSelect?: () => void };
const state = vi.hoisted(() => ({
  platform: "ios" as "ios" | "android" | "web" | null,
  userId: "owner", organizationId: "owned-org", role: "ADMIN", status: "authenticated",
  stores: [{ id: "owned-store", name: "Owned store" }], storeError: null as null | { message: string },
  jobs: [] as HistoryJob[], layout: "mobile" as "mobile" | "desktop",
  download: vi.fn(), mutation: vi.fn(), refetch: vi.fn(), toast: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: state.status,
  data: { user: { id: state.userId, organizationId: state.organizationId, role: state.role } } }) }));
vi.mock("next-intl", () => ({ useLocale: () => "ru", useTranslations: (namespace: string) =>
  Object.assign((key: string) => `${namespace}.${key}`, { has: (key: string) => key !== "exportDownloadFailed" }) }));
vi.mock("@/lib/native/useNativePlatform", () => ({ useNativePlatform: () => state.platform }));
vi.mock("@/lib/native/exportDownload", () => ({
  NativeExportDownloadError: class extends Error { constructor(readonly reason = "exportDownloadFailed") { super(reason); } },
  shareExportJobNative: state.download,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/responsive-data-list", () => ({ ResponsiveDataList: (props: {
  items: HistoryJob[]; renderMobile: (job: HistoryJob) => React.ReactNode; renderDesktop: (jobs: HistoryJob[]) => React.ReactNode;
}) => state.layout === "mobile" ? <>{props.items.map((job) => <React.Fragment key={job.id}>{props.renderMobile(job)}</React.Fragment>)}</> : props.renderDesktop(props.items) }));
// RowActions and IconButton keep their own unchanged rendering tests. This
// boundary exposes the actual href/action decision made by the history page.
vi.mock("@/components/row-actions", () => ({ RowActions: ({ actions }: { actions: Action[] }) => <div>{actions.map((action) =>
  action.href ? <a key={action.key} href={action.href} aria-disabled={action.disabled}>{action.label}</a> :
    <button key={action.key} type="button" disabled={action.disabled} onClick={action.onSelect}>{action.label}</button>)}</div> }));
vi.mock("@/components/ui/icon-button", () => ({ IconButton: ({ label, ...props }: {
  label: string; icon?: unknown; onClick?: () => void; disabled?: boolean;
}) => <button type="button" aria-label={label} disabled={props.disabled} onClick={props.onClick} /> }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  stores: { list: { useQuery: () => ({ data: state.stores, error: state.storeError, refetch: state.refetch }) } },
  exports: {
    list: { useQuery: () => ({ data: state.jobs, isLoading: false, error: null, refetch: state.refetch }) },
    create: { useMutation: () => ({ mutate: state.mutation, isLoading: false }) },
    retry: { useMutation: () => ({ mutate: state.mutation, isLoading: false }) },
  },
} }));

import ExportsPage from "@/app/(app)/reports/exports/page";
import { NativeExportDownloadError } from "@/lib/native/exportDownload";

const job = (patch: Partial<HistoryJob> = {}): HistoryJob => ({
  id: "owned-job", organizationId: "owned-org", storeId: "owned-store", type: "PRICE_LIST", status: "DONE",
  periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-11-11T23:59:59Z"),
  requestedById: "owner", createdAt: new Date("2026-11-11T12:00:00Z"), startedAt: null, finishedAt: new Date("2026-11-11T12:01:00Z"),
  fileName: "price-list.csv", mimeType: "text/csv;charset=utf-8", fileSize: 772, storagePath: "not-a-client-download-url",
  paramsJson: null, errorMessage: null, errorJson: null, downloadAvailable: true,
  downloadUrl: "/api/exports/owned-job", downloadUnavailableReason: null, ...patch,
});

beforeEach(() => {
  state.platform = "ios"; state.userId = "owner"; state.organizationId = "owned-org"; state.role = "ADMIN";
  state.status = "authenticated"; state.stores = [{ id: "owned-store", name: "Owned store" }]; state.storeError = null;
  state.jobs = [job()]; state.layout = "mobile";
  state.download.mockReset().mockResolvedValue({ status: "shared" });
  state.mutation.mockReset(); state.refetch.mockReset(); state.toast.mockReset();
});
afterEach(cleanup);
const downloadButton = () => screen.getByRole("button", { name: "common.tooltips.download" });

describe("export history native handoff", () => {
  it.each(["mobile", "desktop"] as const)("keeps a native %s download in the page and hands the owned job to Share", async (layout) => {
    state.layout = layout; render(<ExportsPage />);
    expect(screen.queryByRole("link", { name: "common.tooltips.download" })).toBeNull();
    fireEvent.click(downloadButton());
    await waitFor(() => expect(state.download).toHaveBeenCalledTimes(1));
    expect(state.download).toHaveBeenCalledWith(expect.objectContaining({ jobId: "owned-job", fileName: "price-list.csv",
      mimeType: "text/csv;charset=utf-8", signal: expect.any(AbortSignal), shouldShare: expect.any(Function) }));
    await waitFor(() => expect(downloadButton()).toHaveProperty("disabled", false));
    expect(state.mutation).not.toHaveBeenCalled();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it("retains the exact ordinary browser download href without invoking native Share", () => {
    state.platform = "web"; state.jobs = [job({ downloadUrl: "/api/exports/owned-job?existing-link=1" })];
    render(<ExportsPage />);
    expect(screen.getByRole("link", { name: "common.tooltips.download" }).getAttribute("href")).toBe("/api/exports/owned-job?existing-link=1");
    expect(state.download).not.toHaveBeenCalled();
  });

  it("does not expose a navigable attachment while platform hydration is unresolved", () => {
    state.platform = null; render(<ExportsPage />);
    expect(downloadButton()).toHaveProperty("disabled", true);
    expect(screen.queryByRole("link", { name: "common.tooltips.download" })).toBeNull();
    fireEvent.click(downloadButton()); expect(state.download).not.toHaveBeenCalled();
  });

  it("serializes rapid taps and keeps the loading state until the sheet returns", async () => {
    let finish!: (value: { status: string }) => void;
    state.download.mockImplementation(() => new Promise<{ status: string }>((resolve) => { finish = resolve; }));
    render(<ExportsPage />); const button = downloadButton();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(state.download).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "common.loading" })).toHaveProperty("disabled", true);
    await act(async () => { finish({ status: "cancelled" }); });
    expect(downloadButton()).toHaveProperty("disabled", false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.toast).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "discarded"])("keeps %s quiet with no automatic retry or navigation link", async (status) => {
    state.download.mockResolvedValue({ status }); render(<ExportsPage />); fireEvent.click(downloadButton());
    await waitFor(() => expect(downloadButton()).toHaveProperty("disabled", false));
    expect(state.download).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("link", { name: "common.tooltips.download" })).toBeNull();
    expect(state.toast).not.toHaveBeenCalled();
  });

  it.each(["failed", "unavailable"])("offers a localized explicit retry after %s, without an anchor fallback", async (status) => {
    state.download.mockResolvedValueOnce({ status }).mockResolvedValueOnce({ status: "shared" });
    render(<ExportsPage />); fireEvent.click(downloadButton());
    const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain("errors.genericMessage");
    expect(state.download).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "common.tooltips.download" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "common.tryAgain" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(state.download).toHaveBeenCalledTimes(2);
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it("explains an authenticated HTTP denial rather than rendering an upstream payload", async () => {
    state.download.mockRejectedValue(new NativeExportDownloadError("forbidden"));
    render(<ExportsPage />); fireEvent.click(downloadButton());
    expect((await screen.findByRole("alert")).textContent).toContain("errors.forbidden");
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"])("does not enable native downloads for %s", (role) => {
    state.role = role; render(<ExportsPage />);
    expect(screen.getByRole("alert").textContent).toContain("errors.forbidden");
    expect(screen.queryByRole("button", { name: "common.tooltips.download" })).toBeNull();
    expect(state.download).not.toHaveBeenCalled();
  });

  it.each([
    { organizationId: "other-org" }, { storeId: "unassigned-store" },
    { status: "RUNNING" as const, downloadAvailable: false }, { downloadAvailable: false, downloadUnavailableReason: "exportFileMissing" as const },
  ])("does not download a foreign, unassigned or unavailable job (%j)", (patch) => {
    state.jobs = [job(patch)]; render(<ExportsPage />);
    expect(downloadButton()).toHaveProperty("disabled", true); fireEvent.click(downloadButton());
    expect(state.download).not.toHaveBeenCalled();
  });
});

describe("export history pending audience", () => {
  it.each(["organization", "role", "store"])("aborts and invalidates a pending share after %s changes", async (change) => {
    let finish!: (value: { status: string }) => void;
    state.download.mockImplementation(() => new Promise<{ status: string }>((resolve) => { finish = resolve; }));
    const view = render(<ExportsPage />); fireEvent.click(downloadButton());
    const input = state.download.mock.calls[0][0]; expect(input.shouldShare()).toBe(true);
    if (change === "organization") state.organizationId = "other-org";
    else if (change === "role") state.role = "MANAGER";
    else state.stores = [{ id: "another-store", name: "Another store" }];
    view.rerender(<ExportsPage />);
    expect(input.signal.aborted).toBe(true); expect(input.shouldShare()).toBe(false);
    await act(async () => { finish({ status: "failed" }); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.download).toHaveBeenCalledTimes(1);
  });

  it("aborts acquisition and prevents the earned callback from sharing after unmount", async () => {
    let finish!: (value: { status: string }) => void;
    state.download.mockImplementation(() => new Promise<{ status: string }>((resolve) => { finish = resolve; }));
    const view = render(<ExportsPage />); fireEvent.click(downloadButton());
    const input = state.download.mock.calls[0][0]; view.unmount();
    expect(input.signal.aborted).toBe(true); expect(input.shouldShare()).toBe(false);
    await act(async () => { finish({ status: "shared" }); });
    expect(state.toast).not.toHaveBeenCalled();
  });

  it("does not let an old request finish or clear the next account's pending operation", async () => {
    let finishOld!: (value: { status: string }) => void, finishNew!: (value: { status: string }) => void;
    state.download.mockImplementationOnce(() => new Promise<{ status: string }>((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<{ status: string }>((resolve) => { finishNew = resolve; }));
    const view = render(<ExportsPage />); fireEvent.click(downloadButton());
    state.userId = "new-owner"; state.organizationId = "new-org";
    state.jobs = [job({ id: "new-job", organizationId: "new-org", downloadUrl: "/api/exports/new-job" })];
    view.rerender(<ExportsPage />); fireEvent.click(downloadButton());
    expect(state.download).toHaveBeenCalledTimes(2);
    await act(async () => { finishOld({ status: "failed" }); });
    expect(screen.getByRole("button", { name: "common.loading" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { finishNew({ status: "shared" }); });
    expect(downloadButton()).toHaveProperty("disabled", false);
  });
});
