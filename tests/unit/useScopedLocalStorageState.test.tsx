// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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

const ScopedProbe = ({ storageKey }: { storageKey: string | null }) => {
  const { value, setValue, isReady, hasStoredValue } = useScopedLocalStorageState<string[]>({
    storageKey,
    defaultValue: [],
    parse: parseStringArray,
  });

  return (
    <div>
      <output>
        {isReady ? `${hasStoredValue ? "stored" : "fresh"}:${value.join(",")}` : "loading"}
      </output>
      <button type="button" onClick={() => setValue(["typed"])}>
        Change
      </button>
    </div>
  );
};

const ScopedDefaultProbe = ({ storageKey }: { storageKey: string | null }) => {
  const { value, setValue, isReady } = useScopedLocalStorageState<string[]>({
    storageKey,
    defaultValue: [],
    parse: parseStringArray,
  });

  React.useEffect(() => {
    if (storageKey && isReady && value.length === 0) {
      setValue(["programmatic-default"]);
    }
  }, [isReady, setValue, storageKey, value.length]);

  return (
    <output data-testid="scoped-default-value">{isReady ? value.join(",") : "loading"}</output>
  );
};

describe("useScopedLocalStorageState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not loop when the caller passes a fresh default value", async () => {
    render(<UnstableDefaultValueProbe />);

    expect(await screen.findByText("ready:1:0")).toBeTruthy();
  });

  it("hydrates a delayed scope without overwriting its stored value", async () => {
    window.localStorage.setItem("products:org:user", JSON.stringify(["stored-value"]));
    const { rerender } = render(<ScopedProbe storageKey={null} />);

    expect(await screen.findByText("fresh:")).toBeTruthy();
    rerender(<ScopedProbe storageKey="products:org:user" />);

    expect(await screen.findByText("stored:stored-value")).toBeTruthy();
    expect(window.localStorage.getItem("products:org:user")).toBe(JSON.stringify(["stored-value"]));
  });

  it("preserves a user change made while the scope is still resolving", async () => {
    window.localStorage.setItem("products:org:user", JSON.stringify(["older-value"]));
    const { rerender } = render(<ScopedProbe storageKey={null} />);

    expect(await screen.findByText("fresh:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByText("fresh:typed")).toBeTruthy();
    rerender(<ScopedProbe storageKey="products:org:user" />);

    expect(await screen.findByText("fresh:typed")).toBeTruthy();
    await waitFor(() => {
      expect(window.localStorage.getItem("products:org:user")).toBe(JSON.stringify(["typed"]));
    });
  });

  it("hydrates a delayed scope before consumers apply a programmatic default", async () => {
    window.localStorage.setItem("inventory:org:user", JSON.stringify(["stored-value"]));
    const { rerender } = render(<ScopedDefaultProbe storageKey={null} />);

    expect((await screen.findByTestId("scoped-default-value")).textContent).toBe("");
    rerender(<ScopedDefaultProbe storageKey="inventory:org:user" />);

    expect(await screen.findByText("stored-value")).toBeTruthy();
    expect(window.localStorage.getItem("inventory:org:user")).toBe(
      JSON.stringify(["stored-value"]),
    );
  });
});
