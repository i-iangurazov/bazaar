// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { BaamAssistant, BaamAssistantProvider } from "@/components/baam-assistant";
import type { BaamData } from "@/components/use-baam-companion";

const mocks = vi.hoisted(() => ({
  pathname: vi.fn(),
  session: vi.fn(),
  capabilities: vi.fn(),
  conversation: vi.fn(),
  history: vi.fn(),
  create: vi.fn(),
  change: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(),
  fetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: mocks.pathname,
  useSearchParams: () => new URLSearchParams("registerId=register"),
}));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invalidate: mocks.invalidate,
      baam: {
        conversation: { fetch: mocks.fetch, invalidate: mocks.invalidate },
        conversations: { invalidate: mocks.invalidate },
      },
    }),
    baam: {
      companion: { useQuery: mocks.capabilities },
      conversation: { useQuery: mocks.conversation },
      conversations: { useInfiniteQuery: mocks.history },
      createConversation: { useMutation: () => ({ mutateAsync: mocks.create }) },
      changeConversation: { useMutation: () => ({ mutateAsync: mocks.change }) },
      send: { useMutation: () => ({ mutateAsync: mocks.send, isLoading: false }) },
      stop: { useMutation: () => ({ mutateAsync: mocks.stop }) },
      execute: { useMutation: () => ({ mutateAsync: mocks.execute }) },
      cancelAction: { useMutation: () => ({ mutateAsync: mocks.cancel }) },
    },
  },
}));
const capabilities = () => ({
  data: {
    actorId: "actor",
    organizationId: "org",
    configured: true,
    voiceConfigured: true,
    stores: [{ id: "store", name: "Test store" }],
  },
  error: null,
});
const blank = (): BaamData => ({
  conversation: {
    id: "dialog",
    userId: "actor",
    organizationId: "org",
    title: "Test dialog",
    storeId: "store",
    scopeStoreIds: ["store"],
    revision: 0,
    nextSequence: 0,
    activeTurnId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  },
  messages: [],
  actions: [],
  activeTurn: null,
  next: null,
});
let saved: BaamData;
const entry = (
  text: string,
  sequence: number,
  role = "assistant",
): BaamData["messages"][number] => ({
  id: `m-${sequence}`,
  conversationId: "dialog",
  turnId: "turn",
  text,
  role,
  sequence,
  parts: [],
  createdAt: new Date(),
});
const shell = (open = true) => (
  <NextIntlClientProvider locale="en" messages={{ errors: messages.errors }}>
    <BaamAssistantProvider>{open ? <BaamAssistant /> : null}</BaamAssistantProvider>
  </NextIntlClientProvider>
);
const input = () =>
  screen.getByRole("textbox", {
    name: "Describe a task or ask a question…",
  }) as HTMLTextAreaElement;
const submit = (text = "Receive 3 boxes") => {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
};
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  saved = blank();
  localStorage.setItem("baam-dialog:org:actor", "dialog");
  mocks.pathname.mockReturnValue("/inventory");
  mocks.session.mockReturnValue({
    status: "authenticated",
    data: { user: { id: "actor", organizationId: "org", role: "MANAGER" } },
  });
  mocks.capabilities.mockReturnValue(capabilities());
  mocks.conversation.mockImplementation((args: { id: string }) => ({
    data: args.id === saved.conversation.id ? saved : undefined,
    error: null,
    isFetching: false,
  }));
  mocks.fetch.mockImplementation(async () => saved);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "new-dialog" });
  mocks.history.mockReturnValue({
    data: { pages: [{ items: [saved.conversation] }] },
    isLoading: false,
    hasNextPage: false,
  });
  mocks.send.mockImplementation(async (request: { text: string }) => {
    saved = {
      ...saved,
      messages: [entry(request.text, 1, "user"), entry("Which supplier should I use?", 2)],
    };
  });
});
afterEach(cleanup);

describe("BAAM persistent companion workspace", () => {
  it("preserves the open launcher subtree while the client session resolves", () => {
    function Probe() {
      const [open, setOpen] = useState(false);
      return <button onClick={() => setOpen(true)}>{open ? "Still open" : "Open early"}</button>;
    }
    mocks.session.mockReturnValue({ data: null, status: "loading" });
    const view = render(
      <BaamAssistantProvider>
        <Probe />
      </BaamAssistantProvider>,
    );
    fireEvent.click(screen.getByText("Open early"));
    mocks.session.mockReturnValue({
      data: { user: { id: "actor", organizationId: "org", role: "ADMIN" } },
      status: "authenticated",
    });
    view.rerender(
      <BaamAssistantProvider>
        <Probe />
      </BaamAssistantProvider>,
    );
    expect(screen.getByText("Still open")).toBeTruthy();
  });
  it("keeps an early assistant open in a loading state until the session resolves", () => {
    mocks.session.mockReturnValue({ data: null, status: "loading" });
    const view = render(shell());
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.capabilities).not.toHaveBeenCalled();
    mocks.session.mockReturnValue({
      data: { user: { id: "actor", organizationId: "org", role: "ADMIN" } },
      status: "authenticated",
    });
    view.rerender(shell());
    expect(document.activeElement).toBe(input());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("shows a loading state while restored history is still being fetched", () => {
    mocks.conversation.mockReturnValue({ data: undefined, error: null, isFetching: true });
    render(shell());
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("What can I help you do?")).toBeNull();
  });
  it("opens at the current input with page-specific suggestions and no automatic provider call", () => {
    render(shell());
    expect(document.activeElement).toBe(input());
    expect(screen.getByRole("button", { name: "Receive stock" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends one bounded page context with a durable request ID and displays the saved current answer", async () => {
    render(shell());
    submit();
    await waitFor(() => expect(screen.getByText("Which supplier should I use?")).toBeTruthy());
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "dialog",
        revision: 0,
        text: "Receive 3 boxes",
        locale: "en",
        attachmentIds: [],
        page: { path: "/inventory", registerId: "register" },
        clientRequestId: expect.stringMatching(/^[\da-f-]{36}$/),
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves a failed request and retries with the SAME ID after closing the drawer", async () => {
    mocks.send.mockRejectedValueOnce(new Error("network"));
    const view = render(shell());
    submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    const request = mocks.send.mock.calls[0][0];
    view.rerender(shell(false));
    view.rerender(shell());
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0]).toEqual(request);
  });
  it("prevents duplicate sends while a request is pending and preserves a newly typed draft", async () => {
    let finish!: () => void;
    mocks.send.mockReturnValue(
      new Promise<void>((r) => {
        finish = r;
      }),
    );
    render(shell());
    submit();
    submit();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    fireEvent.change(input(), { target: { value: "A different question" } });
    await act(async () => {
      finish();
    });
    expect(input().value).toBe("A different question");
  });
  it("keeps late responses in their original dialog while a new dialog is sending", async () => {
    let finishOld!: () => void, finishNew!: () => void;
    mocks.send
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            finishOld = r;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            finishNew = r;
          }),
      );
    mocks.fetch.mockImplementation(async ({ id }: { id: string }) => ({
      ...saved,
      conversation: { ...saved.conversation, id },
    }));
    render(shell());
    submit("Old request");
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    submit("New request");
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    fireEvent.change(input(), { target: { value: "New draft" } });
    await act(async () => {
      finishOld();
    });
    expect(input().value).toBe("New draft");
    expect(
      (screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      finishNew();
    });
    expect(input().value).toBe("New draft");
    expect(mocks.send.mock.calls.map(([r]) => r.conversationId)).toEqual(["dialog", "new-dialog"]);
  });
  it("retains a draft across drawer close and full-page handoff", () => {
    const view = render(shell());
    fireEvent.change(input(), { target: { value: "Draft with a product name" } });
    view.rerender(shell(false));
    mocks.pathname.mockReturnValue("/baam");
    view.rerender(shell());
    expect(input().value).toBe("Draft with a product name");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["foreign actor", "revoked permission", "removed store", "foreign conversation"])(
    "hides old content after %s",
    (reason) => {
      saved.messages = [entry("Private recorded sales", 1)];
      const view = render(shell());
      expect(screen.getByText("Private recorded sales")).toBeTruthy();
      const cap = capabilities();
      if (reason === "foreign actor") cap.data.actorId = "other";
      if (reason === "removed store") cap.data.stores = [];
      if (reason === "revoked permission")
        mocks.capabilities.mockReturnValue({ ...cap, error: new Error("forbidden") });
      else mocks.capabilities.mockReturnValue(cap);
      if (reason === "foreign conversation")
        saved = { ...saved, conversation: { ...saved.conversation, userId: "other" } };
      view.rerender(shell());
      expect(screen.queryByText("Private recorded sales")).toBeNull();
    },
  );
  it.each(["STAFF", "CASHIER"])("denies %s even with ownership flags", (role) => {
    mocks.session.mockReturnValue({
      data: { user: { id: "actor", organizationId: "org", role, isOrgOwner: true } },
    });
    render(shell());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
  it("clears visible history on logout, and restores only the signed-in user's server history", () => {
    saved.messages = [entry("Private saved answer", 1)];
    const view = render(shell());
    mocks.session.mockReturnValue({ data: null, status: "unauthenticated" });
    view.rerender(shell());
    expect(screen.queryByText("Private saved answer")).toBeNull();
    mocks.session.mockReturnValue({
      data: { user: { id: "different", organizationId: "org", role: "ADMIN" } },
    });
    view.rerender(shell());
    expect(screen.queryByText("Private saved answer")).toBeNull();
  });
  it("opens a server history item and starts a clean separate dialog", () => {
    saved.messages = [entry("Old answer", 1)];
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByRole("button", { name: /Test dialog/ }));
    expect(screen.getByText("Old answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByText("Old answer")).toBeNull();
    expect(input().value).toBe("");
  });
  it("renames, deletes and explicitly changes store with the server revision", async () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename" }), {
      target: { value: "Stock request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.change).toHaveBeenCalledWith({
        id: "dialog",
        revision: 0,
        title: "Stock request",
      }),
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Choose when needed" }));
    await waitFor(() =>
      expect(mocks.change).toHaveBeenCalledWith({ id: "dialog", revision: 0, storeId: null }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
    await waitFor(() =>
      expect(mocks.change).toHaveBeenCalledWith({ id: "dialog", revision: 0, remove: true }),
    );
  });
  it("does not pull a reader away from old messages when a reply arrives", () => {
    saved.messages = [entry("First", 1)];
    const view = render(shell());
    const history = document.querySelector<HTMLElement>("[data-baam-history]")!;
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1500 },
      clientHeight: { configurable: true, value: 400 },
    });
    history.scrollTop = 40;
    fireEvent.scroll(history);
    saved = { ...saved, messages: [...saved.messages, entry("New reply", 2)] };
    view.rerender(shell());
    expect(history.scrollTop).toBe(40);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(history.scrollTop).toBe(1500);
  });
  it("loads earlier history without losing the reader's position", async () => {
    saved.messages = [entry("Latest", 42)];
    saved.next = 42;
    mocks.fetch.mockResolvedValue({ ...saved, messages: [entry("Earlier", 1)], next: null });
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Earlier messages" }));
    await waitFor(() => expect(screen.getByText("Earlier")).toBeTruthy());
    expect(screen.getByText("Latest")).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith({ id: "dialog", before: 42 });
  });
  it("preserves Shift+Enter and IME composition and sends plain Enter once", async () => {
    render(shell());
    fireEvent.change(input(), { target: { value: "Question" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  });
  it("keeps unconfigured history readable while disabling provider requests", () => {
    saved.messages = [entry("Saved result", 1)];
    const cap = capabilities();
    cap.data.configured = false;
    mocks.capabilities.mockReturnValue(cap);
    render(shell());
    expect(screen.getByText("Saved result")).toBeTruthy();
    submit();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(screen.getByText(/not configured yet/)).toBeTruthy();
  });
  it("offers durable recovery for a stale running action without claiming success", async () => {
    saved.messages = [{ ...entry("Review", 1), parts: [{ type: "action", actionId: "action" }] }];
    saved.actions = [
      {
        id: "action",
        status: "RUNNING",
        summary: { title: "Create tea", details: ["3 units"] },
        result: null,
        errorCode: null,
        scopeRevision: 0,
        turnId: "turn",
        updatedAt: new Date(0),
        canRecover: true,
      },
    ];
    render(shell());
    expect(screen.queryByText("Completed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith({ actionId: "action" }));
  });
});
