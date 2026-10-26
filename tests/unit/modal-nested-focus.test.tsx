// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);

function NestedDialogs() {
  const [childOpen, setChildOpen] = useState(false);
  const [replaceTrigger, setReplaceTrigger] = useState(false);
  return (
    <>
      <Modal open title="Parent dialog" onOpenChange={() => {}}>
        {replaceTrigger ? (
          <p>Responsive parent content</p>
        ) : (
          <button onClick={() => setChildOpen(true)}>Open child</button>
        )}
      </Modal>
      <Modal open={childOpen} title="Child dialog" onOpenChange={setChildOpen}>
        <button onClick={() => setReplaceTrigger(true)}>Replace parent trigger</button>
        <button onClick={() => setChildOpen(false)}>Cancel child</button>
      </Modal>
    </>
  );
}

describe("nested modal focus recovery", () => {
  it("returns to the still-open parent when its original trigger disappeared", async () => {
    render(<NestedDialogs />);
    const parent = screen.getByRole("dialog", { name: "Parent dialog" });
    const trigger = screen.getByRole("button", { name: "Open child" });
    trigger.focus();
    fireEvent.click(trigger);
    const replace = await screen.findByRole("button", { name: "Replace parent trigger" });
    await waitFor(() => expect(document.activeElement?.closest('[role="dialog"]')).toBe(
      screen.getByRole("dialog", { name: "Child dialog" }),
    ));
    replace.focus();
    fireEvent.click(replace);
    expect(trigger.isConnected).toBe(false);
    const cancel = screen.getByRole("button", { name: "Cancel child" });
    cancel.focus();
    fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(parent));
    expect(screen.queryByRole("dialog", { name: "Child dialog" })).toBeNull();
  });
});
