// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "authenticated", role: "STAFF", loading: true,
  error: null as null | { message: string; data: { code: string } },
  data: undefined as undefined | { id: string; name: string; email: string; preferredLocale: string; themePreference: string },
  refetch: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({
  data: state.status === "authenticated" ? { user: { id: "synthetic-user", organizationId: "synthetic-org", role: state.role } } : null,
  status: state.status, update: vi.fn(),
}) }));
vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }) }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/account-privacy-settings", () => ({ AccountPrivacySettings: () => {
  const [open, setOpen] = useState(false);
  return <section>
    <button onClick={() => setOpen(true)}>Independent account deletion and AI privacy choices</button>
    {open ? <div role="dialog" aria-label="Account deletion confirmation"><label>Deletion confirmation<input aria-label="Deletion confirmation" /></label></div> : null}
  </section>;
} }));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ isLoading: false, mutate: vi.fn() });
  return { trpc: {
    useUtils: () => ({}),
    userSettings: {
      getMyProfile: { useQuery: () => ({ data: state.data, isLoading: state.loading, error: state.error, refetch: state.refetch }) },
      updateMyProfile: { useMutation: mutation }, updateMyPreferences: { useMutation: mutation },
    },
    orgSettings: { getBusinessProfile: { useQuery: () => ({ data: undefined, isLoading: false }) }, updateBusinessProfile: { useMutation: mutation } },
    stores: { updateProductSettings: { useMutation: mutation } },
  } };
});

import ProfilePage from "@/app/(app)/settings/profile/page";

beforeEach(() => { vi.clearAllMocks(); state.status = "authenticated"; state.role = "STAFF"; state.loading = true; state.error = null; state.data = undefined; });
afterEach(cleanup);

describe("personal privacy remains accessible independently of profile reads", () => {
  it.each(["ADMIN", "MANAGER", "STAFF", "CASHIER"])("keeps privacy controls visible while the %s profile loads", (role) => {
    state.role = role;
    render(<ProfilePage />);
    expect(screen.getByRole("button", { name: "Independent account deletion and AI privacy choices" })).toBeTruthy();
    expect(screen.getByText("common.loading")).toBeTruthy();
  });
  it("keeps privacy controls visible after a profile error and retries only the failed read", () => {
    state.loading = false;
    state.error = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<ProfilePage />);
    expect(screen.getByRole("button", { name: "Independent account deletion and AI privacy choices" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
  it("does not show personal account actions before authentication resolves", () => {
    state.status = "loading";
    render(<ProfilePage />);
    expect(screen.queryByRole("button", { name: "Independent account deletion and AI privacy choices" })).toBeNull();
  });
  it("preserves an open confirmation and typed input when a deferred profile fails then recovers", () => {
    const ui = render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "Independent account deletion and AI privacy choices" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Deletion confirmation" }), { target: { value: "DELETE" } });
    state.loading = false;
    state.error = { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } };
    ui.rerender(<ProfilePage />);
    expect((screen.getByRole("textbox", { name: "Deletion confirmation" }) as HTMLInputElement).value).toBe("DELETE");
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    state.error = null;
    state.data = { id: "synthetic-user", name: "Synthetic Staff", email: "staff@example.invalid", preferredLocale: "en", themePreference: "LIGHT" };
    ui.rerender(<ProfilePage />);
    expect(screen.getByRole("dialog", { name: "Account deletion confirmation" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Deletion confirmation" }) as HTMLInputElement).value).toBe("DELETE");
  });
});
