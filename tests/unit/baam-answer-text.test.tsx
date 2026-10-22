// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BaamAnswerText } from "@/components/baam-answer-text";
import { BaamSpeech } from "@/components/baam-speech";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("formats readable lists and emphasis while allowing only server-provided application links", () => {
  const { container } = render(
    <BaamAnswerText
      text={
        "### Steps\n\n1. **Open** products\n2. Check `SKU`\n\n[Products](/products) [Fake](/admin/made-up) [External](https://example.com)\n\n<img src=x onerror=alert(1)>"
      }
      links={["/products", "https://example.com"]}
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe("Steps");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(container.querySelector("strong")?.textContent).toBe("Open");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link").getAttribute("href")).toBe("/products");
  expect(container.querySelector("img")).toBeNull();
});
it("reads the chosen language, stops and cleans up speech without auto-playing", () => {
  const speak = vi.fn(),
    cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel, getVoices: () => [] });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
      lang = "";
    },
  );
  const { unmount } = render(<BaamSpeech text="Товар табылды" locale="kg" />);
  expect(speak).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  expect(speak.mock.calls[0][0]).toMatchObject({ text: "Товар табылды", lang: "ky-KG" });
  fireEvent.click(screen.getByRole("button"));
  expect(speak).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button"));
  expect(speak).toHaveBeenCalledTimes(2);
  unmount();
  expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(3);
});
it("renders a narrow scrollable table with authorized links and literal escaped names", () => {
  const { container } = render(
    <BaamAnswerText
      text={
        "| Товар | Сумма |\n|---|---|\n| [Чай](/products/tea) | **300 KGS** |\n| \\[Имя\\] | 0 |"
      }
      links={["/products/tea"]}
    />,
  );
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByRole("link").getAttribute("href")).toBe("/products/tea");
  expect(container.textContent).toContain("[Имя]");
  expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
});
