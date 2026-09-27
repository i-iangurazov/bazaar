// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePosSaleChannel, type CommercialSaleChannel } from "@/lib/usePosSaleChannel";
import { SaleChannelControl } from "@/components/pos/sale-channel-control";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("per-receipt channel recovery", () => {
  it("adopts a pending selection, survives reload, isolates carts and resets a successful sale", () => {
    const userId = crypto.randomUUID();
    const initial = {
      userId,
      registerId: "register",
      saleId: null as string | null,
      saved: null as CommercialSaleChannel | null,
    };
    const hook = renderHook((props) => usePosSaleChannel(props), { initialProps: initial });
    expect(hook.result.current.channel).toBe("IN_STORE");
    act(() => hook.result.current.set("ONLINE"));
    act(() => hook.result.current.adopt("sale-a"));
    hook.rerender({ ...initial, saleId: "sale-a", saved: "IN_STORE" });
    expect(hook.result.current.channel).toBe("ONLINE");
    hook.unmount();
    const reloaded = renderHook((props) => usePosSaleChannel(props), {
      initialProps: {
        ...initial,
        saleId: "sale-a",
        saved: "IN_STORE" as CommercialSaleChannel | null,
      },
    });
    expect(reloaded.result.current.channel).toBe("ONLINE");
    reloaded.rerender({ ...initial, saleId: "sale-b", saved: "IN_STORE" });
    expect(reloaded.result.current.channel).toBe("IN_STORE");
    reloaded.rerender({ ...initial, saleId: "sale-a", saved: "IN_STORE" });
    expect(reloaded.result.current.get()).toBe("ONLINE"); // failed requests never reset
    act(() => reloaded.result.current.reset());
    reloaded.rerender({ ...initial, saleId: "new-sale", saved: "IN_STORE" });
    expect(reloaded.result.current.channel).toBe("IN_STORE");
  });
  it("uses the server channel on resumed sales and preserves scanner focus for a mouse click", async () => {
    const props = {
      userId: crypto.randomUUID(),
      registerId: "r",
      saleId: "online-order",
      saved: "ONLINE" as const,
    };
    const hook = renderHook(() => usePosSaleChannel(props));
    expect(hook.result.current.channel).toBe("ONLINE");
    const change = vi.fn();
    const fetch = vi.spyOn(globalThis, "fetch");
    function Control() {
      const [channel, setChannel] = useState<CommercialSaleChannel>("IN_STORE");
      return (
        <SaleChannelControl
          value={channel}
          onChange={(value) => {
            setChannel(value);
            change(value);
          }}
        />
      );
    }
    render(
      <>
        <input aria-label="scanner" />
        <Control />
      </>,
    );
    screen.getByRole("textbox").focus();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(change).toHaveBeenCalledWith("ONLINE");
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    await userEvent.click(screen.getByText("checkbox"));
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    expect(change).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenLastCalledWith("IN_STORE");
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    await userEvent.keyboard(" ");
    expect(change).toHaveBeenCalledTimes(3);
    expect(change).toHaveBeenLastCalledWith("ONLINE");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
