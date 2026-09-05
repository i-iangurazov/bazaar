// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { BaamAssistant, BaamAssistantProvider } from "@/components/baam-assistant";

const mocks = vi.hoisted(() => ({ session: vi.fn(), capabilities: vi.fn(), overview: vi.fn(), mutation: vi.fn(), ask: vi.fn(), retryCapabilities: vi.fn(), retryOverview: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("@/lib/trpc", () => ({ trpc: { baam: {
  capabilities: { useQuery: mocks.capabilities }, overview: { useQuery: mocks.overview }, ask: { useMutation: mocks.mutation },
} } }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
import BaamPage from "@/app/(app)/baam/page";

const audience = { actorId: "actor", organizationId: "org" };
const capabilities = () => ({ data: { available: true, reason: "configured", mode: "ai", audience }, error: null, isFetching: false, refetch: mocks.retryCapabilities });
const overview = () => ({ data: { audience, scope: { organizationId: "org", storeIds: ["store"], availableStores: [{ id: "store", name: "Authorized synthetic store" }] } }, error: null, isFetching: false, refetch: mocks.retryOverview });
const answer = () => ({
  answer: "Recorded sales after returns are -30.00 KGS. Check the completed returns before inferring a sales decline.",
  mode: "ai", audience, followUps: ["Check recorded payments"],
  evidence: {
    period: { dateFrom: "2026-09-01", dateTo: "2026-09-02", timeZone: "Asia/Bishkek" },
    comparisonPeriod: { dateFrom: "2026-08-30", dateTo: "2026-08-31", timeZone: "Asia/Bishkek" },
    storeNames: ["Authorized synthetic store"], queriedAt: "2026-09-05T12:00:00.000Z",
    currentQueriedAt: "2026-09-05T12:00:00.000Z", previousQueriedAt: "2026-09-05T12:00:01.000Z",
    metricVersion: "completed-sales-kgs-v1", queryHashes: ["synthetic"],
  },
});
const shell = (children: React.ReactNode) => <NextIntlClientProvider locale="en" messages={{ baam: messages.baam, errors: messages.errors }}>
  <BaamAssistantProvider>{children}</BaamAssistantProvider>
</NextIntlClientProvider>;
const page = () => shell(<BaamPage />);
const input = () => screen.getByRole("textbox", { name: "Your question for BAAM" });
const submit = (question = "Explain returns") => {
  fireEvent.change(input(), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role: "MANAGER" } } });
  mocks.capabilities.mockReturnValue(capabilities()); mocks.overview.mockReturnValue(overview());
  mocks.mutation.mockReturnValue({ mutateAsync: mocks.ask, isLoading: false }); mocks.ask.mockResolvedValue(answer());
});
afterEach(cleanup);

describe("BAAM assistant workspace", () => {
  it("starts with questions and suggestions without a duplicate metric dashboard or automatic AI call", () => {
    render(page());
    expect(screen.getByText("What would you like to understand?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "What changed in this period?" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull(); expect(screen.queryByTestId("baam-metric-net")).toBeNull();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("submits a scoped question and shows the real answer with expandable evidence and followups", async () => {
    render(page());
    fireEvent.click(screen.getByText(/Answer scope/));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-02" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Store" }), { target: { value: "store" } });
    submit();
    await screen.findByText(answer().answer);
    expect(mocks.ask).toHaveBeenCalledWith({ question: "Explain returns", dateFrom: "2026-09-01", dateTo: "2026-09-02", storeId: "store", locale: "en" });
    fireEvent.click(screen.getByText("Evidence and scope"));
    expect(screen.getByText(/Applied period: 2026-09-01 to 2026-09-02/).textContent).toContain("Authorized synthetic store");
    expect(screen.getByText(/Source completeness is unknown/)).toBeTruthy();
    expect(screen.getByText(/Metric definitions: completed-sales-kgs-v1/)).toBeTruthy();
    expect(screen.getByText(/Selected-period records queried at/)).toBeTruthy();
    expect(screen.getByText(/Comparison-period records queried at/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open analytics · apply the same dates and stores" }).getAttribute("href")).toBe("/reports/analytics");
    fireEvent.click(screen.getByRole("button", { name: "Check recorded payments" }));
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
  });

  it("shows truthful unconfigured availability and sends no questions or overview requests", () => {
    mocks.capabilities.mockReturnValue({ ...capabilities(), data: { ...capabilities().data, available: false, reason: "not_configured" } });
    render(page());
    expect(screen.getByText(messages.errors.baamNotConfigured)).toBeTruthy();
    expect((input() as HTMLTextAreaElement).disabled).toBe(true);
    expect(mocks.overview.mock.calls[0][1].enabled).toBe(false); expect(mocks.ask).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"])("blocks %s before activating any assistant query", role => {
    mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role } } });
    render(page()); expect(screen.getByRole("alert")).toBeTruthy();
    expect(mocks.capabilities).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("rejects stale capability/store cache from another actor", () => {
    mocks.capabilities.mockReturnValue({ ...capabilities(), data: { ...capabilities().data, audience: { ...audience, actorId: "previous" } } });
    mocks.overview.mockReturnValue({ ...overview(), data: { ...overview().data, audience: { ...audience, actorId: "previous" } } });
    render(page()); expect((input() as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("option", { name: "Authorized synthetic store" })).toBeNull(); expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("rejects a reply whose audience does not match the current actor", async () => {
    mocks.ask.mockResolvedValue({ ...answer(), audience: { ...audience, actorId: "wrong" } });
    render(page()); submit();
    await screen.findByRole("alert"); expect(screen.queryByText(answer().answer)).toBeNull();
  });

  it("retains a failed question and scope, then retries without inventing an answer", async () => {
    mocks.ask.mockRejectedValueOnce({ message: "baamUnavailable" });
    render(page()); submit("Explain the change");
    await screen.findByText(messages.errors.baamUnavailable);
    expect((input() as HTMLTextAreaElement).value).toBe("Explain the change"); expect(screen.queryByText(answer().answer)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findByText(answer().answer);
    expect(mocks.ask.mock.calls[0][0]).toEqual(mocks.ask.mock.calls[1][0]);
  });

  it("prevents duplicate submissions while an earlier question is pending", async () => {
    let resolveAnswer!: (value: ReturnType<typeof answer>) => void;
    mocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve; }));
    render(page()); submit(); fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    await act(async () => resolveAnswer(answer()));
  });

  it("hides previous answers after a failed permission refresh", async () => {
    const view = render(page()); submit(); await screen.findByText(answer().answer);
    mocks.overview.mockReturnValue({ ...overview(), error: { message: "storeAccessDenied", data: { code: "FORBIDDEN" } } });
    view.rerender(page());
    expect(screen.queryByText(answer().answer)).toBeNull(); expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("clears the conversation and draft when the authenticated account changes", async () => {
    const view = render(page()); submit(); await screen.findByText(answer().answer);
    mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "next-actor", organizationId: "org", role: "MANAGER" } } });
    mocks.capabilities.mockReturnValue({ ...capabilities(), data: { ...capabilities().data, audience: { ...audience, actorId: "next-actor" } } });
    mocks.overview.mockReturnValue({ ...overview(), data: { ...overview().data, audience: { ...audience, actorId: "next-actor" } } });
    view.rerender(page());
    expect(screen.queryByText(answer().answer)).toBeNull(); expect((input() as HTMLTextAreaElement).value).toBe("");
  });

  it("hides old answers after a successful refresh removes an authorized store", async () => {
    const view = render(page()); submit(); await screen.findByText(answer().answer);
    mocks.overview.mockReturnValue({ ...overview(), data: { ...overview().data, scope: {
      organizationId: "org", storeIds: ["other-store"], availableStores: [{ id: "other-store", name: "Another authorized store" }],
    } } });
    view.rerender(page());
    expect(screen.queryByText(answer().answer)).toBeNull();
    expect(screen.queryByText(/Applied period:/)).toBeNull();
    mocks.ask.mockResolvedValue({ ...answer(), answer: "Only the newly authorized store was queried." });
    submit(); await screen.findByText("Only the newly authorized store was queried.");
    expect(screen.queryByText(answer().answer)).toBeNull();
  });

  it("keeps a pending request, draft, and scope through drawer close and full workspace handoff", async () => {
    let resolveAnswer!: (value: ReturnType<typeof answer>) => void;
    mocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve; }));
    const view = render(shell(<BaamAssistant compact />));
    fireEvent.click(screen.getByText(/Answer scope/));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-02" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Store" }), { target: { value: "store" } });
    submit("Keep this question");
    view.rerender(shell(null));
    view.rerender(page());
    expect((input() as HTMLTextAreaElement).value).toBe("Keep this question");
    expect((screen.getByRole("button", { name: "Send question" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(messages.baam.assistant.thinking);
    await act(async () => resolveAnswer(answer()));
    await screen.findByText(answer().answer);
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-09-01");
    expect((screen.getByRole("combobox", { name: "Store" }) as HTMLSelectElement).value).toBe("store");
    expect(mocks.ask).toHaveBeenCalledTimes(1);
  });

  it("retains the completed answer if a request finishes while the drawer is closed", async () => {
    let resolveAnswer!: (value: ReturnType<typeof answer>) => void;
    mocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve; }));
    const view = render(shell(<BaamAssistant compact />)); submit();
    view.rerender(shell(null));
    await act(async () => resolveAnswer(answer()));
    view.rerender(page());
    expect(screen.getByText(answer().answer)).toBeTruthy();
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(mocks.retryCapabilities).toHaveBeenCalledTimes(1);
    expect(mocks.retryOverview).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting and capability queries dormant until the assistant first opens", () => {
    const view = render(shell(null));
    expect(mocks.capabilities.mock.lastCall?.[1].enabled).toBe(false);
    expect(mocks.overview.mock.lastCall?.[1].enabled).toBe(false);
    view.rerender(page());
    expect(mocks.capabilities.mock.lastCall?.[1].enabled).toBe(true);
    expect(mocks.overview.mock.lastCall?.[1].enabled).toBe(true);
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("offers an explicit retry when a capability or store query fails", async () => {
    mocks.capabilities.mockReturnValue({ ...capabilities(), data: undefined, error: { message: "baamUnavailable" } });
    const view = render(page());
    fireEvent.click(screen.getByRole("button", { name: messages.baam.retry }));
    expect(mocks.retryCapabilities).toHaveBeenCalledTimes(1);
    expect(mocks.retryOverview).not.toHaveBeenCalled();
    mocks.capabilities.mockReturnValue(capabilities());
    mocks.overview.mockReturnValue({ ...overview(), error: { message: "baamUnavailable" } });
    view.rerender(page());
    fireEvent.click(screen.getByRole("button", { name: messages.baam.retry }));
    expect(mocks.retryCapabilities).toHaveBeenCalledTimes(2);
    expect(mocks.retryOverview).toHaveBeenCalledTimes(1);
    mocks.overview.mockReturnValue(overview()); view.rerender(page());
    submit(); await screen.findByText(answer().answer);
  });

  it("purges the RAM conversation on logout even if the same account signs in again", async () => {
    const view = render(page()); submit(); await screen.findByText(answer().answer);
    mocks.session.mockReturnValue({ status: "unauthenticated", data: null }); view.rerender(page());
    expect(screen.queryByText(answer().answer)).toBeNull();
    mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role: "MANAGER" } } });
    view.rerender(page());
    expect(screen.queryByText(answer().answer)).toBeNull(); expect((input() as HTMLTextAreaElement).value).toBe("");
  });

  it("discards an in-flight answer when store permissions change", async () => {
    let resolveAnswer!: (value: ReturnType<typeof answer>) => void;
    mocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve; }));
    const view = render(page()); submit();
    mocks.overview.mockReturnValue({ ...overview(), data: { ...overview().data, scope: {
      organizationId: "org", storeIds: ["other-store"], availableStores: [{ id: "other-store", name: "Another authorized store" }],
    } } });
    view.rerender(page()); await act(async () => resolveAnswer(answer()));
    expect(screen.queryByText(answer().answer)).toBeNull(); expect((input() as HTMLTextAreaElement).value).toBe("");
  });
});
