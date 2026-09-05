// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn(), resolve: vi.fn(), refetch: vi.fn(), toast: vi.fn(), retryHook: vi.fn(), resolveHook: vi.fn(), mobile: false }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { role: "ADMIN" } } }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { adminJobs: { list: { useQuery: mocks.query }, retry: { useMutation: mocks.retryHook }, resolve: { useMutation: mocks.resolveHook } } } }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
type Job = { id: string; jobName: string; attempts: number; lastError: string; lastErrorAt: Date; resolvedAt: Date | null; retryAttemptId: string | null; retryStartedAt: Date | null };
vi.mock("@/components/responsive-data-list", () => ({ ResponsiveDataList: ({ items, renderDesktop, renderMobile }: { items: Job[]; renderDesktop: (items: Job[]) => ReactNode; renderMobile: (job: Job) => ReactNode }) => mocks.mobile ? <>{items.map(job => <div key={job.id}>{renderMobile(job)}</div>)}</> : renderDesktop(items) }));
vi.mock("@/components/row-actions", () => ({ RowActions: ({ actions }: { actions: Array<{ key: string; label: string; disabled: boolean; onSelect: () => void }> }) => <>{actions.map(action => <button key={action.key} disabled={action.disabled} onClick={action.onSelect}>{action.label}</button>)}</> }));
import AdminJobsPage from "@/app/(app)/admin/jobs/page";

const job = (claim: string | null = null): Job => ({ id: "synthetic-job", jobName: "Synthetic reporting job", attempts: 2, lastError: "Synthetic failure", lastErrorAt: new Date("2026-09-05T12:00:00Z"), resolvedAt: null, retryAttemptId: claim, retryStartedAt: claim ? new Date("2026-09-05T12:05:00Z") : null });
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={{ adminJobs: messages.adminJobs, errors: messages.errors, common: messages.common }}><AdminJobsPage /></NextIntlClientProvider>);

describe("admin jobs retry outcomes and reconciliation acknowledgement", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.mobile = false;
    mocks.query.mockReturnValue({ data: [job()], isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.retryHook.mockReturnValue({ mutate: mocks.retry, isLoading: false });
    mocks.resolveHook.mockReturnValue({ mutate: mocks.resolve, isLoading: false });
    mocks.refetch.mockResolvedValue({ data: [job()] });
  });
  afterEach(cleanup);

  it("reports a failed retry as an error even though the request succeeded", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.retry).toHaveBeenCalledWith({ jobId: "synthetic-job" });
    await act(async () => { await mocks.retryHook.mock.calls[0][0].onSuccess({ status: "failed", job: job() }); });
    expect(mocks.toast).toHaveBeenCalledWith({ variant: "error", description: messages.adminJobs.retryFailed });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("reports only a resolved retry as success", async () => {
    renderPage();
    await act(async () => { await mocks.retryHook.mock.calls[0][0].onSuccess({ status: "resolved", job: { ...job(), resolvedAt: new Date() } }); });
    expect(mocks.toast).toHaveBeenCalledWith({ variant: "success", description: messages.adminJobs.retrySuccess });
  });

  it.each([false, true])("blocks a claimed retry and explains running/unknown outcome in mobile=%s", mobile => {
    mocks.mobile = mobile;
    mocks.query.mockReturnValue({ data: [job("claimed-attempt")], isLoading: false, isError: false, refetch: mocks.refetch });
    renderPage();
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true); fireEvent.click(retry); expect(mocks.retry).not.toHaveBeenCalled();
    expect(screen.getByText(messages.adminJobs.statusNeedsReconciliation)).toBeTruthy();
    expect(screen.getByText(messages.adminJobs.retryClaimed)).toBeTruthy();
  });

  it("requires reconciliation acknowledgement before any manual resolve and resets it when reopened", () => {
    mocks.query.mockReturnValue({ data: [job("claimed-attempt")], isLoading: false, isError: false, refetch: mocks.refetch });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(messages.adminJobs.resolveClaimWarning)).toBeTruthy();
    const descriptionId = dialog.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toContain(messages.adminJobs.resolveConfirmDescription);
    const confirm = within(dialog).getByRole("button", { name: messages.adminJobs.resolveConfirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); fireEvent.click(confirm); expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: messages.adminJobs.resolveAcknowledgement }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm); expect(mocks.resolve).toHaveBeenCalledWith({ jobId: "synthetic-job" });
    fireEvent.click(within(dialog).getByRole("button", { name: messages.common.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect((within(screen.getByRole("dialog")).getByRole("button", { name: messages.adminJobs.resolveConfirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refreshes server state after an uncertain/concurrent retry error and never shows success", () => {
    renderPage();
    act(() => { mocks.retryHook.mock.calls[0][0].onError(new Error("jobRetryInProgress")); });
    expect(mocks.toast).toHaveBeenCalledWith({ variant: "error", description: messages.errors.jobRetryInProgress });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps acknowledgement and manual resolve separate from retry", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.getByText(messages.adminJobs.resolveConfirmDescription)).toBeTruthy();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("requires renewed acknowledgement after a concurrent-state manual resolution failure", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: messages.adminJobs.resolveAcknowledgement }));
    act(() => { mocks.resolveHook.mock.calls[0][0].onError(new Error("jobRetryStateChanged")); });
    expect((within(dialog).getByRole("button", { name: messages.adminJobs.resolveConfirm }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith({ variant: "error", description: messages.errors.jobRetryStateChanged });
  });
});
