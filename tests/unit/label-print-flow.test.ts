import { describe, expect, it } from "vitest";

import {
  buildSavedLabelPrintValues,
  hasSavedLabelPrintProfile,
  resolveLabelPrintFlowAction,
} from "@/lib/labelPrintFlow";

describe("label print flow", () => {
  it("quick prints when a saved profile exists", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: { id: "profile-1", labelDefaultCopies: 3 },
        storeId: "store-1",
      }),
    ).toBe("quickPrint");
  });

  it("keeps inventory quick print out of settings when a saved profile exists", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: { id: "inventory-profile", labelDefaultCopies: 2 },
        storeId: "store-1",
      }),
    ).toBe("quickPrint");
  });

  it("shows first-time setup when no saved profile exists", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: { id: null, labelDefaultCopies: 1 },
        storeId: "store-1",
      }),
    ).toBe("setupRequired");
  });

  it("routes inventory quick print to setup when the profile is missing", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: null,
        storeId: "store-1",
      }),
    ).toBe("setupRequired");
  });

  it("opens settings only for explicit settings actions", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: { id: "profile-1" },
        storeId: "store-1",
        explicitSettings: true,
      }),
    ).toBe("openSettings");
  });

  it("waits while the profile is loading", () => {
    expect(
      resolveLabelPrintFlowAction({
        settings: null,
        storeId: "store-1",
        isLoading: true,
      }),
    ).toBe("loading");
  });

  it("respects saved default copies", () => {
    const values = buildSavedLabelPrintValues({
      settings: {
        id: "profile-1",
        labelTemplate: "xp365b-roll-58x40",
        labelDefaultCopies: 4,
        labelWidthMm: 60,
        labelHeightMm: 35,
      },
      storeId: "store-1",
    });

    expect(values).toMatchObject({
      template: "xp365b-roll-58x40",
      storeId: "store-1",
      quantity: 4,
      widthMm: 60,
      heightMm: 35,
      allowWithoutBarcode: false,
    });
  });

  it("keeps existing stores safe without a saved profile", () => {
    expect(hasSavedLabelPrintProfile({ id: null })).toBe(false);
    expect(
      buildSavedLabelPrintValues({
        settings: { id: null },
        storeId: "store-1",
      }).quantity,
    ).toBe(1);
  });
});
