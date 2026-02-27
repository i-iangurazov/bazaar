export type ScanContext = "global" | "commandPanel" | "stockCount" | "pos" | "linePicker";

export type ScanSubmitTrigger = "enter" | "tab";

export type ScanMatchType = "barcode" | "sku" | "name";

export type ScanProductType = "product" | "bundle";

export type ScanLookupItem = {
  id: string;
  name: string;
  sku: string;
  matchType: ScanMatchType;
  type: ScanProductType;
  primaryImage: string | null;
};

export type ScanLookupResult = {
  exactMatch: boolean;
  items: ScanLookupItem[];
};

export type ScanResolvedResult =
  | {
      kind: "exact";
      context: ScanContext;
      trigger: ScanSubmitTrigger;
      input: string;
      item: ScanLookupItem;
    }
  | {
      kind: "multiple";
      context: ScanContext;
      trigger: ScanSubmitTrigger;
      input: string;
      items: ScanLookupItem[];
    }
  | {
      kind: "notFound";
      context: ScanContext;
      trigger: ScanSubmitTrigger;
      input: string;
    };

export const resolveScanResult = (input: {
  context: ScanContext;
  trigger: ScanSubmitTrigger;
  query: string;
  lookup: ScanLookupResult;
}): ScanResolvedResult => {
  if (input.lookup.exactMatch && input.lookup.items.length === 1) {
    return {
      kind: "exact",
      context: input.context,
      trigger: input.trigger,
      input: input.query,
      item: input.lookup.items[0],
    };
  }

  if (input.lookup.items.length > 0) {
    return {
      kind: "multiple",
      context: input.context,
      trigger: input.trigger,
      input: input.query,
      items: input.lookup.items,
    };
  }

  return {
    kind: "notFound",
    context: input.context,
    trigger: input.trigger,
    input: input.query,
  };
};

export const shouldSubmitFromKey = (input: {
  key: string;
  supportsTabSubmit?: boolean;
  normalizedValue: string;
  tabSubmitMinLength?: number;
}): ScanSubmitTrigger | null => {
  if (input.key === "Enter") {
    return "enter";
  }

  const minLength = input.tabSubmitMinLength ?? 4;
  if (input.supportsTabSubmit && input.key === "Tab" && input.normalizedValue.length >= minLength) {
    return "tab";
  }

  return null;
};
