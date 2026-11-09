// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  status: "authenticated",
  stores: [{ id: "assigned-store", name: "Assigned store", code: "QA" }],
  storesError: null as null | { message: string; data?: { code: string } },
  workspace: undefined as unknown,
  workspaceError: null as null | { message: string; data?: { code: string } },
  retries: [] as string[],
  mutation: vi.fn(),
  queries: [] as Array<{ path: string; enabled: boolean }>,
  payments: {
    ready: false,
    mode: "disabled",
    provider: "GOPAY",
    termsVersion: "qa-v1",
    termsUrl: "https://example.invalid/terms/v1",
    invoices: [] as Array<{
      id: string; provider: string; isTest: boolean; status: string; quantity: number;
      amountMinor: number; createdAt: Date; checkoutUrl: string | null; lastIssue: string | null;
    }>,
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "viewer", organizationId: "org", role: state.role } },
    status: state.status,
  }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) =>
    Object.assign((key: string, params?: Record<string, unknown>) =>
      `${namespace}.${key}${params ? ` ${JSON.stringify(params)}` : ""}`, { has: () => true }),
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const result = (path: string, data: unknown, error: unknown = null) => ({
    data,
    error,
    isLoading: false,
    refetch: async () => {
      state.retries.push(path);
      return { data, error: null };
    },
  });
  const queryOptions = (path: string, options?: { enabled?: boolean }) => {
    state.queries.push({ path, enabled: options?.enabled !== false });
  };
  const procedures = Object.fromEntries(
    [
      "save",
      "begin",
      "finish",
      "enable",
      "preview",
      "mode",
      "archive",
      "seen",
      "erase",
      "send",
      "checkout",
      "checkPayment",
    ].map((key) => [
      key,
      {
        useMutation: () => ({
          mutate: state.mutation,
          mutateAsync: state.mutation,
          isLoading: false,
        }),
      },
    ]),
  );
  const conversation = {
    id: "conversation",
    name: "Test customer",
    phone: "996700000001",
    mode: "HUMAN",
    needsHuman: true,
    archived: false,
    version: 1,
    inboundSequence: 1,
    windowOpen: true,
    countrySupported: true,
    messages: [],
  };
  return {
    trpc: {
      whatsappAi: {
        ...procedures,
        payments: { useQuery: () => result("payments", state.payments) },
        stores: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
            queryOptions("stores", options);
            return result("stores", state.stores, state.storesError);
          },
        },
        workspace: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
            queryOptions("workspace", options);
            return result("workspace", state.workspace, state.workspaceError);
          },
        },
        conversations: {
          useInfiniteQuery: () => ({
            ...result("conversations", {
              pages: [
                { items: [{ ...conversation, preview: "Customer question" }], nextCursor: null },
              ],
            }),
            hasNextPage: false,
          }),
        },
        conversation: {
          useQuery: ({ conversationId }: { conversationId: string }) =>
            result("conversation", conversationId ? conversation : undefined),
        },
      },
      useUtils: () => ({
        whatsappAi: {
          workspace: { invalidate: vi.fn(), getData: () => state.workspace },
          conversations: { invalidate: vi.fn() },
          conversation: { invalidate: vi.fn() },
        },
      }),
    },
  };
});

import WhatsAppAiPage from "@/app/(app)/operations/integrations/whatsapp-ai/page";
import type { Workspace } from "@/app/(app)/operations/integrations/whatsapp-ai/workspace-ui";
import { whatsappKnowledgeSchema, whatsappProfileSchema } from "@/lib/whatsapp-ai";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Costs } from "@/app/(app)/operations/integrations/whatsapp-ai/workspace-panels";

const TestWorkspace = () => (
  <TooltipProvider>
    <WhatsAppAiPage />
  </TooltipProvider>
);

const workspace = (): Workspace => ({
  entitled: true,
  active: true,
  canConnect: true,
  store: { name: "Assigned store", currencyCode: "KGS" },
  connection: null,
  profile: whatsappProfileSchema.parse({ assistantName: "Saved assistant" }),
  knowledge: whatsappKnowledgeSchema.parse({
    storeName: "Assigned store",
    delivery: "Saved delivery",
  }),
  readiness: {
    ready: false,
    transportReady: false,
    onboardingReady: false,
    previewReady: false,
    reasons: [],
    workerReady: false,
    manualWorkerReady: false,
  },
  quota: {
    period: "2026-11",
    renewsAt: new Date("2026-11-30T18:00:00Z"),
    included: 1000,
    includedUsed: 0,
    reserved: 0,
    paidRemaining: 0,
    paidReserved: 0,
    remaining: 1000,
    active: true,
    inbound: 0,
    delivered: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedSpendUsd: 0,
  },
  pack: {
    priceMinor: 349000,
    messages: 1000,
    offerVersion: "2026-11-07-kg-v1",
    paymentsApproved: false,
  },
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.status = "authenticated";
  state.stores = [{ id: "assigned-store", name: "Assigned store", code: "QA" }];
  state.storesError = null;
  state.workspace = workspace();
  state.workspaceError = null;
  state.retries = [];
  state.queries = [];
  Object.assign(state.payments, {
    ready: false, mode: "disabled", provider: "GOPAY", termsVersion: "qa-v1", invoices: [],
  });
});

const openTab = (tab: string) =>
  fireEvent.click(screen.getByRole("tab", { name: `whatsappAi.tabs.${tab}` }));
const openConversation = () => {
  openTab("conversations");
  fireEvent.click(screen.getByRole("button", { name: /Test customer/ }));
};

describe("WhatsApp workspace recovery", () => {
  it("shows GoPay test status and historical FreedomPay pack invoices independently", () => {
    Object.assign(state.payments, {
      ready: true, mode: "sandbox", invoices: [
        { id: "go-test", provider: "GOPAY", isTest: true, status: "PAID", quantity: 1,
          amountMinor: 349000, createdAt: new Date("2026-11-09T00:00:00Z"), checkoutUrl: null, lastIssue: null },
        { id: "fp-existing", provider: "FREEDOMPAY", isTest: false, status: "PENDING", quantity: 1,
          amountMinor: 349000, createdAt: new Date("2026-11-08T00:00:00Z"),
          checkoutUrl: "https://example.invalid/existing", lastIssue: null },
      ],
    });
    render(<TooltipProvider><Costs storeId="assigned-store" data={workspace()} reload={vi.fn()} /></TooltipProvider>);
    expect(screen.getByText('billing.payments.sandbox {"provider":"GoPay"}')).toBeTruthy();
    expect(screen.getByText('whatsappAi.paymentHelp {"provider":"GoPay"}')).toBeTruthy();
    expect(screen.getByText(/^billing.payments.testPaid/)).toBeTruthy();
    expect(screen.getByText("billing.payments.testInvoice")).toBeTruthy();
    expect(screen.queryByText(/^whatsappAi.invoiceStates.PAID/)).toBeNull();
    expect(screen.getByText('billing.payments.providerDescription {"provider":"FreedomPay"}')).toBeTruthy();
    const link = screen.getByRole("link", { name: "whatsappAi.continuePayment" });
    expect(link.getAttribute("href")).toBe("https://example.invalid/existing");
    expect(link.getAttribute("target")).toBe("_blank");
  });
  it("keeps pack collection disabled until the payment merchant is ready", () => {
    const connected = workspace();
    connected.connection = { state: "CONNECTED" } as Workspace["connection"];
    connected.readiness.manualWorkerReady = true;
    render(<TooltipProvider><Costs storeId="assigned-store" data={connected} reload={vi.fn()} /></TooltipProvider>);
    expect(screen.getByText("whatsappAi.paymentsUnavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: /^whatsappAi.pay / }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("sends the selected provider with pack consent and resets consent when the provider changes", async () => {
    Object.assign(state.payments, { ready: true, mode: "sandbox" });
    state.mutation.mockResolvedValue({ status: "PENDING" });
    const connected = workspace();
    connected.connection = { state: "CONNECTED" } as Workspace["connection"];
    connected.readiness.manualWorkerReady = true;
    const view = render(<TooltipProvider><Costs storeId="assigned-store" data={connected} reload={vi.fn()} /></TooltipProvider>);
    const pay = screen.getByRole("button", { name: /^whatsappAi.pay / }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(pay.disabled).toBe(false);
    fireEvent.click(pay);
    await waitFor(() => expect(state.mutation).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({ expectedProvider: "GOPAY", termsVersion: "qa-v1", termsAccepted: true }),
    })));
    state.payments.provider = "FREEDOMPAY";
    view.rerender(<TooltipProvider><Costs storeId="assigned-store" data={connected} reload={vi.fn()} /></TooltipProvider>);
    expect((screen.getByRole("checkbox") as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
    expect(pay.disabled).toBe(true);
  });
  it.each([
    { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } },
    { message: "Failed to fetch" },
  ])("keeps all local drafts through a temporary error and retry: $message", (error) => {
    const view = render(<TestWorkspace />);
    openTab("assistant");
    fireEvent.change(screen.getByRole("textbox", { name: "whatsappAi.assistantName" }), {
      target: { value: "Unsaved assistant" },
    });
    openTab("knowledge");
    fireEvent.change(screen.getByRole("textbox", { name: "whatsappAi.knowledge.delivery" }), {
      target: { value: "Unsaved delivery" },
    });
    openConversation();
    fireEvent.change(screen.getByRole("textbox", { name: "whatsappAi.reply" }), {
      target: { value: "Unsaved reply" },
    });

    state.workspaceError = error;
    view.rerender(<TestWorkspace />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "whatsappAi.reply" }) as HTMLTextAreaElement).value,
    ).toBe("Unsaved reply");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.retries).toEqual(["workspace"]);

    state.workspaceError = null;
    state.workspace = workspace();
    view.rerender(<TestWorkspace />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "whatsappAi.reply" }) as HTMLTextAreaElement).value,
    ).toBe("Unsaved reply");
    openTab("assistant");
    expect(
      (screen.getByRole("textbox", { name: "whatsappAi.assistantName" }) as HTMLInputElement).value,
    ).toBe("Unsaved assistant");
    openTab("knowledge");
    expect(
      (
        screen.getByRole("textbox", {
          name: "whatsappAi.knowledge.delivery",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Unsaved delivery");
    expect(state.mutation).not.toHaveBeenCalled();
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"])(
    "hides cached private workspace and clears drafts on %s",
    (code) => {
      const view = render(<TestWorkspace />);
      openTab("assistant");
      fireEvent.change(screen.getByRole("textbox", { name: "whatsappAi.assistantName" }), {
        target: { value: "Private draft" },
      });
      state.workspaceError = { message: "accessDenied", data: { code } };
      view.rerender(<TestWorkspace />);
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByDisplayValue("Private draft")).toBeNull();
      expect(screen.queryByText("Test customer")).toBeNull();

      state.workspaceError = null;
      view.rerender(<TestWorkspace />);
      openTab("assistant");
      expect(
        (screen.getByRole("textbox", { name: "whatsappAi.assistantName" }) as HTMLInputElement)
          .value,
      ).toBe("Saved assistant");
    },
  );

  it("hides retained workspace when the selected store is no longer accessible", () => {
    const view = render(<TestWorkspace />);
    openTab("assistant");
    state.stores = [];
    view.rerender(<TestWorkspace />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("whatsappAi.noStores")).toBeTruthy();
    expect(state.queries.at(-1)).toEqual({ path: "workspace", enabled: false });
  });

  it("hides private store names and workspace on a store-list access denial", () => {
    const view = render(<TestWorkspace />);
    state.storesError = { message: "forbidden", data: { code: "FORBIDDEN" } };
    view.rerender(<TestWorkspace />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "whatsappAi.store" })).toBeNull();
  });

  it.each(["loading", "unauthenticated"])(
    "hides cached ADMIN data when session is %s",
    (status) => {
      const view = render(<TestWorkspace />);
      state.status = status;
      view.rerender(<TestWorkspace />);
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.getByText("whatsappAi.accessDenied")).toBeTruthy();
      expect(state.queries.slice(-2).every((query) => !query.enabled)).toBe(true);
    },
  );

  it("hides cached workspace after role access is revoked", () => {
    const view = render(<TestWorkspace />);
    state.role = "CASHIER";
    view.rerender(<TestWorkspace />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("whatsappAi.accessDenied")).toBeTruthy();
  });
});
