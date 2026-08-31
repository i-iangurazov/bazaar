import { describe, expect, it } from "vitest";

import { getContextualHelpGuideId, getContextualHelpHref } from "@/content/help/contextual";

describe("contextual Bazaar Guide links", () => {
  it.each([
    ["/products", "products/add-product"],
    ["/inventory/receiving", "inventory/receiving"],
    ["/inventory/transfers/123/edit", "inventory/transfer"],
    ["/inventory/write-offs", "inventory/write-off"],
    ["/inventory/counts/new", "inventory/inventory-count"],
    ["/pos/sell", "pos/make-sale"],
    ["/pos/shifts", "pos/close-shift"],
    ["/sales/orders/new", "orders/create-order"],
    ["/sales/orders/42", "orders/process-order"],
    ["/customers/new", "customers/add-customer"],
    ["/customers", "customers/review-history"],
    ["/settings/users", "settings/add-employee"],
    ["/stores", "getting-started/choose-store"],
    ["/reports/analytics", "reports/analytics-basics"],
    ["/operations/integrations/m-market", "integrations/connect-marketplace"],
  ])("maps %s to %s", (pathname, guideId) => {
    expect(getContextualHelpGuideId(pathname)).toBe(guideId);
    expect(getContextualHelpHref(pathname)).toContain(`/help/${guideId}?from=`);
  });

  it("does not invent contextual help for unrelated routes", () => {
    expect(getContextualHelpGuideId("/billing")).toBeNull();
  });
});
