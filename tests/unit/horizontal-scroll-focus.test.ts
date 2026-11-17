// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { scrollChildIntoHorizontalView } from "@/lib/horizontalScrollFocus";

const rect = (left: number, right: number) =>
  ({ left, right, top: 0, bottom: 20, width: right - left, height: 20 }) as DOMRect;

describe("horizontal focus scrolling", () => {
  it("scrolls a focused control at the right edge fully into view", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    container.append(button);
    container.scrollLeft = 100;
    container.getBoundingClientRect = () => rect(0, 500);
    button.getBoundingClientRect = () => rect(480, 520);

    scrollChildIntoHorizontalView(container, button);

    expect(container.scrollLeft).toBe(132);
  });

  it("scrolls back when focus moves to the left edge", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    container.append(button);
    container.scrollLeft = 100;
    container.getBoundingClientRect = () => rect(0, 500);
    button.getBoundingClientRect = () => rect(-20, 20);

    scrollChildIntoHorizontalView(container, button);

    expect(container.scrollLeft).toBe(68);
  });

  it("ignores controls outside the scroll container", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    container.scrollLeft = 100;
    container.getBoundingClientRect = () => rect(0, 500);
    button.getBoundingClientRect = () => rect(480, 520);

    scrollChildIntoHorizontalView(container, button);

    expect(container.scrollLeft).toBe(100);
  });
});
