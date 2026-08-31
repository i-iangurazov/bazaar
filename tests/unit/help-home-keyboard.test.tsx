// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HelpHome } from "@/components/help/HelpHome";

const data = {
  guides: [],
  quickSearches: [],
  tasks: [],
  journey: [],
  roles: [],
  categories: [],
};

describe("Bazaar Guide keyboard search", () => {
  it.each([
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ])("focuses search for the platform shortcut", (modifier) => {
    render(<HelpHome locale="en" data={data} />);
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(window, { key: "k", ...modifier });

    expect(document.activeElement).toBe(search);
  });

  it("does not steal the K key without a command modifier", () => {
    render(<HelpHome locale="en" data={data} />);

    fireEvent.keyDown(window, { key: "k" });

    expect(document.activeElement).toBe(document.body);
  });
});
