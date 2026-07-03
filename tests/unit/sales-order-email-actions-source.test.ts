import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("sales order email action source", () => {
  it("snapshots current tracking and customer form values before send side effects", async () => {
    const source = await readSource("src/app/(app)/sales/orders/[id]/page.tsx");
    const handler = source.slice(
      source.indexOf("const handleSendTrackingEmail"),
      source.indexOf("const handleSubmitLine"),
    );

    expect(handler).toContain("const customerInput = {");
    expect(handler).toContain("const trackingInput = trackingMutationInput(order.id)");
    expect(handler).toContain("if (!trackingInput.trackingNumber)");
    expect(handler).toContain("if (!customerInput.customerEmail)");
    expect(handler).toContain("await setCustomerMutation.mutateAsync(customerInput)");
    expect(handler).toContain("await saveTrackingBeforeSendMutation.mutateAsync(trackingInput)");
  });
});
