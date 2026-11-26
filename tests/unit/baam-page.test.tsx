// @vitest-environment jsdom
import { useState } from "react";
import Link from "next/link";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Capacitor } from "@capacitor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { BaamAssistant, BaamAssistantProvider, type BaamPhoneLayout } from "@/components/baam-assistant";
import type { BaamData } from "@/components/use-baam-companion";
// This suite isolates an already-consented person's chat/draft behavior.
// Explicit permission/refusal/revocation have a separate component suite.
vi.mock("@/components/ai-privacy-consent", () => ({ AiPrivacyConsent: ({ children }: { children: React.ReactNode }) => children }));

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
        conversation: {
          fetch: mocks.fetch,
          invalidate: mocks.invalidate,
          getData: () => undefined,
          setData: (_input: unknown, data: BaamData) => {
            saved = data;
          },
        },
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
    activeWorkflowId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  },
  messages: [],
  actions: [],
  workflows: [],
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
const shell = (open = true, nativeViewport = false, compactViewport = false, phoneLayout?: BaamPhoneLayout) => (
  <NextIntlClientProvider locale="en" messages={{ errors: messages.errors }}>
    <BaamAssistantProvider>{open ? <BaamAssistant nativeViewport={nativeViewport} compactViewport={compactViewport}
      phoneLayout={phoneLayout}
      workspaceHeader={compactViewport || phoneLayout ? <Link href="/inventory" prefetch={false}>Return to inventory</Link> : undefined} /> : null}</BaamAssistantProvider>
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
  mocks.create.mockResolvedValue({ id: "new-dialog", revision: 0 });
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
    return { data: saved };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  it("offers printer, sales and subscription guidance in the workspace, not write commands", async () => {
    mocks.pathname.mockReturnValue("/baam");
    render(shell());
    expect(screen.getByRole("button", { name: "How to make a sale" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help with your subscription" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "How to set up a printer" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      command: { kind: "help", query: "printing" },
    })));
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
  it("sends the first question using the creation revision without a second conversation request", async () => {
    localStorage.removeItem("baam-dialog:org:actor");
    render(shell());
    submit("First question");
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "new-dialog", revision: 0, text: "First question",
    })));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves a newly typed draft when retrying a failed request", async () => {
    mocks.send.mockRejectedValueOnce(new Error("network"));
    render(shell());
    submit("First request");
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.change(input(), { target: { value: "Next question I am typing" } });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0]).toEqual(mocks.send.mock.calls[0][0]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("Next question I am typing");
  });
  it("shows dispatch before the server claims the turn and stops only the displayed turn", async () => {
    let finish!: (result: { data: BaamData }) => void;
    mocks.send.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(shell());
    submit("Open a product");
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Sending your request…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop response" })).toBeNull();
    saved = { ...saved, activeTurn: {
      id: "shown-turn", clientRequestId: mocks.send.mock.calls[0][0].clientRequestId,
      status: "RUNNING", cancelRequested: false,
    } };
    view.rerender(shell());
    expect(screen.getByText("Working on your request…")).toBeTruthy();
    mocks.stop.mockImplementationOnce(async () => {
      saved = { ...saved, activeTurn: null };
      return { stopped: true };
    });
    fireEvent.change(input(), { target: { value: "Another draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({
      conversationId: "dialog", turnId: "shown-turn",
    }));
    await act(async () => { finish({ data: saved }); });
    expect(input().value).toBe("Another draft");
    expect(JSON.parse(sessionStorage.getItem("baam-draft:org:actor:dialog") ?? "{}").pending).toBeUndefined();
  });
  it.each([false, true])("preserves a failed request and retries with the SAME ID after reopening (short native viewport: %s)", async (compactViewport) => {
    mocks.send.mockRejectedValueOnce(new Error("network"));
    const view = render(shell(true, compactViewport, compactViewport));
    submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    const request = mocks.send.mock.calls[0][0];
    view.rerender(shell(false, compactViewport, compactViewport));
    view.rerender(shell(true, compactViewport, compactViewport));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0]).toEqual(request);
  });
  it.each([false, true])(
    "restores a cached new-dialog draft on initial open and remount (failed outbox: %s)",
    (hasFailedOutbox) => {
      localStorage.removeItem("baam-dialog:org:actor");
      const pending = hasFailedOutbox
        ? {
            conversationId: "dialog",
            clientRequestId: "c6154bf4-98dc-4747-a138-61db13b7706e",
            revision: 0,
            text: "Previously submitted request",
            locale: "en",
            attachmentIds: [],
            page: { path: "/inventory" },
          }
        : undefined;
      sessionStorage.setItem(
        "baam-draft:org:actor:new",
        JSON.stringify({ text: "Unsent new-dialog draft", pending, at: Date.now() }),
      );
      const view = render(shell());
      expect(input().value).toBe("Unsent new-dialog draft");
      expect(Boolean(screen.queryByRole("button", { name: "Retry" }))).toBe(hasFailedOutbox);
      view.rerender(shell(false));
      view.rerender(shell());
      expect(input().value).toBe("Unsent new-dialog draft");
      expect(Boolean(screen.queryByRole("button", { name: "Retry" }))).toBe(hasFailedOutbox);
      expect(JSON.parse(sessionStorage.getItem("baam-draft:org:actor:new") ?? "null"))
        .toMatchObject({ text: "Unsent new-dialog draft", ...(pending ? { pending } : {}) });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it("prevents duplicate sends while a request is pending and preserves a newly typed draft", async () => {
    let finish!: () => void;
    mocks.send.mockReturnValue(
      new Promise<{ data: BaamData }>((r) => {
        finish = () => r({ data: saved });
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
          new Promise<{ data: BaamData }>((r) => {
            finishOld = () =>
              r({ data: { ...saved, conversation: { ...saved.conversation, id: "dialog" } } });
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ data: BaamData }>((r) => {
            finishNew = () =>
              r({ data: { ...saved, conversation: { ...saved.conversation, id: "new-dialog" } } });
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
    expect(input().value).toBe("New draft");
    await act(async () => {
      finishOld();
    });
    expect(input().value).toBe("New draft");
    expect(JSON.parse(sessionStorage.getItem("baam-draft:org:actor:new-dialog") ?? "null"))
      .toMatchObject({ text: "New draft" });
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
  it.each([false, true])("does not pull a reader away from old messages when a reply arrives (native viewport: %s)", (nativeViewport) => {
    saved.messages = [entry("First", 1)];
    const view = render(shell(true, nativeViewport));
    const history = document.querySelector<HTMLElement>(nativeViewport ? '[data-baam-scrollport="workspace"]' : "[data-baam-history]")!;
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1500 },
      clientHeight: { configurable: true, value: 400 },
    });
    history.scrollTop = 40;
    fireEvent.scroll(history);
    saved = { ...saved, messages: [...saved.messages, entry("New reply", 2)] };
    view.rerender(shell(true, nativeViewport));
    expect(history.scrollTop).toBe(40);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(history.scrollTop).toBe(1500);
  });
  it.each([false, true])("loads earlier history without losing the reader's position (native viewport: %s)", async (nativeViewport) => {
    saved.messages = [entry("Latest", 42)];
    saved.next = 42;
    mocks.fetch.mockResolvedValue({ ...saved, messages: [entry("Earlier", 1)], next: null });
    render(shell(true, nativeViewport));
    fireEvent.click(screen.getByRole("button", { name: "Earlier messages" }));
    await waitFor(() => expect(screen.getByText("Earlier")).toBeTruthy());
    expect(screen.getByText("Latest")).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith({ id: "dialog", before: 42 });
  });
  it("preserves existing messages and offers the same earlier page again after a read fails", async () => {
    saved = { ...saved, messages: [entry("Latest", 42)], next: 42 };
    mocks.fetch.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({
      ...saved, messages: [entry("Earlier", 1)], next: null,
    });
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Earlier messages" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Latest")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Earlier messages" }));
    expect(await screen.findByText("Earlier")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.fetch.mock.calls).toEqual([[{ id: "dialog", before: 42 }], [{ id: "dialog", before: 42 }]]);
  });
  it("keeps the native composer outside the scrolling content and preserves its draft through history", () => {
    render(shell(true, true));
    const scrollport = document.querySelector('[data-baam-scrollport="workspace"]')!;
    expect(scrollport.querySelector("[data-baam-history]")).toBeTruthy();
    expect(scrollport.contains(input())).toBe(false);
    expect(document.querySelector("[data-baam-composer]")?.contains(input())).toBe(true);
    fireEvent.change(input(), { target: { value: "Draft above the keyboard" } });
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(screen.queryByRole("textbox", { name: "Describe a task or ask a question…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    expect(input().value).toBe("Draft above the keyboard");
    expect(document.activeElement).toBe(input());
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps iPhone controls and running status outside the transcript through keyboard changes", () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    saved = {
      ...saved,
      messages: [entry("Old reply", 1), entry("Latest answer", 2)],
      activeTurn: { id: "turn", clientRequestId: "request", status: "RUNNING", cancelRequested: false },
    };
    const view = render(shell(true, true, false, "normal"));
    const transcript = document.querySelector<HTMLElement>('[data-baam-scrollport="workspace"]')!;
    let viewportHeight = 400;
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1500 },
      clientHeight: { configurable: true, get: () => viewportHeight },
    });
    expect(transcript.contains(screen.getByRole("combobox"))).toBe(true);
    const draft = input();
    draft.focus();
    fireEvent.change(draft, { target: { value: "My unfinished question" } });
    transcript.scrollTop = 1100;
    fireEvent.scroll(transcript);

    viewportHeight = 220;
    view.rerender(shell(true, true, true, "keyboard"));
    const toolbar = document.querySelector("[data-baam-phone-toolbar]")!;
    const status = document.querySelector("[data-baam-response-progress]")!;
    expect(toolbar.contains(screen.getByRole("link", { name: "Return to inventory" }))).toBe(true);
    expect(toolbar.contains(screen.getByRole("button", { name: "Conversations" }))).toBe(true);
    expect(toolbar.contains(screen.getByRole("button", { name: "New conversation" }))).toBe(true);
    expect(toolbar.contains(screen.getByRole("button", { name: "BAAM actions" }))).toBe(true);
    expect(transcript.contains(toolbar)).toBe(false);
    expect(transcript.contains(screen.getByText("Latest answer"))).toBe(true);
    expect(status.textContent).toContain("Working on your request…");
    expect(status.previousElementSibling).toBe(transcript);
    expect(status.nextElementSibling?.contains(draft)).toBe(true);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(input()).toBe(draft);
    expect(draft.value).toBe("My unfinished question");
    expect(document.activeElement).toBe(draft);
    expect(transcript.scrollTop).toBe(1500);

    transcript.scrollTop = 120;
    fireEvent.scroll(transcript);
    viewportHeight = 180;
    act(() => resize?.());
    expect(transcript.scrollTop).toBe(120);
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(transcript.scrollTop).toBe(0);
    expect(transcript.querySelector("[data-baam-dialogs]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    expect(transcript.scrollTop).toBe(120);
    expect(input().value).toBe("My unfinished question");
    view.rerender(shell(true, true, false, "normal"));
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(transcript.scrollTop).toBe(120);
  });
  it("keeps compact native navigation and voice auto-send explanation in the scrolling content", () => {
    const view = render(shell(true, true, true));
    const scrollport = document.querySelector('[data-baam-scrollport="workspace"]')!;
    const composer = document.querySelector("[data-baam-composer]")!;
    const draft = input();
    expect(scrollport.contains(screen.getByRole("link", { name: "Return to inventory" }))).toBe(true);
    expect(scrollport.textContent).toContain("sent automatically after recording");
    expect(composer.textContent).not.toContain("sent automatically after recording");
    const form = draft.closest("form")!;
    expect(form.contains(screen.getByRole("button", { name: "Send message" }))).toBe(true);
    expect(form.contains(screen.getByRole("button", { name: "Record a voice message" }))).toBe(true);
    expect(draft.rows).toBe(1);
    fireEvent.change(draft, { target: { value: "Still the same draft" } });
    view.rerender(shell(true, true, false));
    expect(input()).toBe(draft);
    expect(draft.value).toBe("Still the same draft");
    expect(draft.rows).toBe(2);
    expect(document.activeElement).toBe(draft);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("explains unavailable transcription in the iOS composer", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    const configured = capabilities();
    mocks.capabilities.mockReturnValue({
      ...configured,
      data: { ...configured.data, voiceConfigured: false },
    });
    render(shell(true, true, true));
    expect((screen.getByRole("button", { name: "Record a voice message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Voice input is currently unavailable.")).toBeTruthy();
    expect(screen.queryByText(/sent automatically after recording/)).toBeNull();
  });
  it("retains short native return navigation while the session is still loading", () => {
    mocks.session.mockReturnValue({ status: "loading", data: null });
    render(shell(true, true, true));
    expect(screen.getByRole("link", { name: "Return to inventory" }).getAttribute("href")).toBe("/inventory");
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(mocks.send).not.toHaveBeenCalled();
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
  it("keeps history and deterministic forms usable without a provider key", async () => {
    saved.messages = [entry("Saved result", 1)];
    const cap = capabilities();
    cap.data.configured = false;
    mocks.capabilities.mockReturnValue(cap);
    render(shell());
    expect(screen.getByText("Saved result")).toBeTruthy();
    submit("Create a product");
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/not configured yet/)).toBeNull();
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
