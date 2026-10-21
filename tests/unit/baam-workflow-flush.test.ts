import { expect, it } from "vitest";
import { flushBaamWorkflowForms, registerBaamWorkflowFlush } from "@/lib/baam/workflowFlush";
it("saves edits from both assistant views before a command and removes unmounted forms", async () => {
  const order: string[] = [];
  const removePage = registerBaamWorkflowFlush("flush-a", async () => {
    order.push("page saved");
  });
  const removeDrawer = registerBaamWorkflowFlush("flush-a", async () => {
    order.push("drawer saved");
  });
  const removeForeign = registerBaamWorkflowFlush("flush-b", async () => {
    order.push("other conversation");
  });
  try {
    await flushBaamWorkflowForms("flush-a");
    order.push("send confirmation");
    expect(order).toEqual(["page saved", "drawer saved", "send confirmation"]);
    removeDrawer();
    order.length = 0;
    await flushBaamWorkflowForms("flush-a");
    expect(order).toEqual(["page saved"]);
  } finally {
    removePage();
    removeDrawer();
    removeForeign();
  }
});
it("blocks a command when saving the displayed form fails", async () => {
  const remove = registerBaamWorkflowFlush("flush-failed", async () => {
    throw new Error("baamWorkflowChanged");
  });
  try {
    await expect(flushBaamWorkflowForms("flush-failed")).rejects.toThrow("baamWorkflowChanged");
  } finally {
    remove();
  }
});
