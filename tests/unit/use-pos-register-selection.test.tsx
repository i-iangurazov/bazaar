// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildPosRegisterStorageKey } from "@/lib/posRegisterContext";
import { usePosRegisterSelection } from "@/lib/usePosRegisterSelection";

const navigation = vi.hoisted(() => ({
  pathname: "/pos",
  search: "",
  replace: vi.fn(),
  router: null as { replace: ReturnType<typeof vi.fn> } | null,
}));

const auth = vi.hoisted(() => ({
  user: {
    id: "user-a",
    organizationId: "org-a",
    role: "CASHIER",
    name: "User A",
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: auth.user }, status: "authenticated" }),
}));

const registers = [
  { id: "register-a", isActive: true },
  { id: "register-b", isActive: true },
];

describe("usePosRegisterSelection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigation.pathname = "/pos";
    navigation.search = "";
    navigation.replace.mockReset();
    navigation.router = { replace: navigation.replace };
    auth.user = {
      id: "user-a",
      organizationId: "org-a",
      role: "CASHIER",
      name: "User A",
    };
  });

  it("isolates register preferences when accounts switch on the same browser", async () => {
    const userAKey = buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-a" });
    const userBKey = buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-b" });
    if (!userAKey || !userBKey) {
      throw new Error("expected scoped keys");
    }
    window.localStorage.setItem(userAKey, "register-a");
    window.localStorage.setItem(userBKey, "register-b");
    window.localStorage.setItem("pos:selected-register", "register-b");

    const { result, rerender } = renderHook(() =>
      usePosRegisterSelection({ registers, registersReady: true }),
    );
    await waitFor(() => expect(result.current.registerId).toBe("register-a"));
    expect(window.localStorage.getItem("pos:selected-register")).toBeNull();

    act(() => {
      auth.user = {
        id: "user-b",
        organizationId: "org-a",
        role: "CASHIER",
        name: "User B",
      };
      rerender();
    });
    await waitFor(() => expect(result.current.registerId).toBe("register-b"));

    act(() => {
      auth.user = {
        id: "user-a",
        organizationId: "org-a",
        role: "CASHIER",
        name: "User A",
      };
      rerender();
    });
    await waitFor(() => expect(result.current.registerId).toBe("register-a"));
  });

  it("lets an explicit valid URL win and persists an explicit selection immediately", async () => {
    const key = buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-a" });
    if (!key) {
      throw new Error("expected scoped key");
    }
    window.localStorage.setItem(key, "register-a");
    navigation.search = "registerId=register-b";

    const { result } = renderHook(() =>
      usePosRegisterSelection({ registers, registersReady: true }),
    );
    await waitFor(() => expect(result.current.registerId).toBe("register-b"));
    expect(window.localStorage.getItem(key)).toBe("register-b");

    act(() => result.current.selectRegister("register-a"));
    expect(result.current.registerId).toBe("register-a");
    expect(window.localStorage.getItem(key)).toBe("register-a");
    expect(navigation.replace).toHaveBeenCalledWith("/pos?registerId=register-a", {
      scroll: false,
    });
  });

  it("clears an invalid stored register without choosing the first available register", async () => {
    const key = buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-a" });
    if (!key) {
      throw new Error("expected scoped key");
    }
    window.localStorage.setItem(key, "removed-register");

    const { result } = renderHook(() =>
      usePosRegisterSelection({ registers, registersReady: true }),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.registerId).toBe("");
    expect(result.current.issue).toBe("invalid-persisted");
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("does not let a stale URL in an open tab leak User A's register into User B", async () => {
    navigation.search = "registerId=register-a";
    const userBKey = buildPosRegisterStorageKey({ organizationId: "org-a", userId: "user-b" });
    if (!userBKey) {
      throw new Error("expected scoped key");
    }
    const { result, rerender } = renderHook(() =>
      usePosRegisterSelection({ registers, registersReady: true }),
    );
    await waitFor(() => expect(result.current.registerId).toBe("register-a"));

    act(() => {
      auth.user = {
        id: "user-b",
        organizationId: "org-a",
        role: "CASHIER",
        name: "User B",
      };
      rerender();
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.registerId).toBe("");
    expect(window.localStorage.getItem(userBKey)).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith("/pos", { scroll: false });
  });
});
