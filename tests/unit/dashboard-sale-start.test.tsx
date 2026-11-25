// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardSaleStart } from "@/lib/useDashboardSaleStart";

const mocks = vi.hoisted(() => ({
  fetchRegisters: vi.fn(),
  matchMedia: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      pos: { registers: { list: { fetch: mocks.fetchRegisters } } },
    }),
  },
}));

const defaultScope = { storeId: "store-a", fallbackHref: "/pos?store=store-a", scopeKey: "scope-a" };
const openRegister = {
  id: "register/a",
  storeId: "store-a",
  isActive: true,
  openShift: { status: "OPEN" },
};

describe("mobile dashboard sale", () => {
  beforeEach(() => {
    mocks.fetchRegisters.mockReset();
    mocks.matchMedia.mockReset();
    mocks.matchMedia.mockReturnValue({ matches: true });
    mocks.push.mockReset();
    vi.stubGlobal("matchMedia", mocks.matchMedia);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("opens the only eligible register without changing the normal POS link", async () => {
    mocks.fetchRegisters.mockResolvedValue([
      openRegister,
      { ...openRegister, id: "closed", openShift: null },
      { ...openRegister, id: "inactive", isActive: false },
    ]);
    const { result } = renderHook(() => useDashboardSaleStart(defaultScope));
    const preventDefault = vi.fn();

    await act(async () => result.current.onNavigate({ preventDefault }));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.fetchRegisters).toHaveBeenCalledExactlyOnceWith(
      { storeId: "store-a" },
      { staleTime: 0, retry: false, networkMode: "always" },
    );
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/pos/sell?registerId=register%2Fa");
  });

  it.each([
    { situation: "no open shift", registers: [{ ...openRegister, openShift: null }] },
    { situation: "multiple open shifts", registers: [openRegister, { ...openRegister, id: "another" }] },
    { situation: "another store's shift", registers: [{ ...openRegister, storeId: "store-b" }] },
    { situation: "no accessible register", registers: [] },
  ])("uses the normal POS entry with $situation", async ({ registers }) => {
    mocks.fetchRegisters.mockResolvedValue(registers);
    const { result } = renderHook(() => useDashboardSaleStart(defaultScope));

    await act(async () => result.current.onNavigate({ preventDefault: vi.fn() }));

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(defaultScope.fallbackHref);
  });

  it("uses the normal POS entry when the fresh store lookup is denied", async () => {
    mocks.fetchRegisters.mockRejectedValue(new Error("storeAccessDenied"));
    const { result } = renderHook(() => useDashboardSaleStart(defaultScope));

    await act(async () => result.current.onNavigate({ preventDefault: vi.fn() }));

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(defaultScope.fallbackHref);
  });

  it("leaves desktop Link navigation alone", async () => {
    mocks.matchMedia.mockReturnValue({ matches: false });
    const { result } = renderHook(() => useDashboardSaleStart(defaultScope));
    const preventDefault = vi.fn();

    await act(async () => result.current.onNavigate({ preventDefault }));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.fetchRegisters).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows pending state and does one lookup for repeated taps", async () => {
    let finishLookup!: (registers: typeof openRegister[]) => void;
    mocks.fetchRegisters.mockReturnValue(new Promise((resolve) => { finishLookup = resolve; }));
    const { result } = renderHook(() => useDashboardSaleStart(defaultScope));
    const preventDefault = vi.fn();
    let navigate!: Promise<void>;

    act(() => {
      navigate = result.current.onNavigate({ preventDefault });
      void result.current.onNavigate({ preventDefault });
    });
    expect(result.current.pending).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRegisters).toHaveBeenCalledOnce();

    await act(async () => {
      finishLookup([openRegister]);
      await navigate;
    });
    expect(result.current.pending).toBe(false);
    expect(mocks.push).toHaveBeenCalledOnce();
  });

  it.each(["scope change", "store selection", "route exit"])(
    "ignores the old lookup after %s",
    async (reason) => {
      let finishLookup!: (registers: typeof openRegister[]) => void;
      mocks.fetchRegisters.mockReturnValue(new Promise((resolve) => { finishLookup = resolve; }));
      const { result, rerender, unmount } = renderHook(
        (scope: typeof defaultScope) => useDashboardSaleStart(scope),
        { initialProps: defaultScope },
      );
      let navigate!: Promise<void>;
      act(() => { navigate = result.current.onNavigate({ preventDefault: vi.fn() }); });

      if (reason === "scope change") {
        rerender({ storeId: "store-b", fallbackHref: "/pos?store=store-b", scopeKey: "scope-b" });
        rerender(defaultScope);
        expect(result.current.pending).toBe(false);
      } else if (reason === "store selection") {
        act(() => result.current.cancel());
      } else {
        unmount();
      }

      await act(async () => {
        finishLookup([openRegister]);
        await navigate;
      });
      expect(mocks.push).not.toHaveBeenCalled();
    },
  );
});
