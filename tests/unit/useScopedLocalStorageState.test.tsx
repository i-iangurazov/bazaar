// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useScopedLocalStorageState } from "@/lib/useScopedLocalStorageState";

const parseStringArray = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const UnstableDefaultValueProbe = () => {
  const [postMountRenderCount, setPostMountRenderCount] = React.useState(0);
  const { value, isReady } = useScopedLocalStorageState<string[]>({
    storageKey: null,
    defaultValue: [],
    parse: parseStringArray,
  });

  React.useEffect(() => {
    setPostMountRenderCount((current) => current + 1);
  }, []);

  return <div>{isReady ? `ready:${postMountRenderCount}:${value.length}` : "loading"}</div>;
};

describe("useScopedLocalStorageState", () => {
  it("does not loop when the caller passes a fresh default value", async () => {
    render(<UnstableDefaultValueProbe />);

    expect(await screen.findByText("ready:1:0")).toBeTruthy();
  });
});
