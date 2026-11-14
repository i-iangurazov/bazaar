// @vitest-environment jsdom
import { createRef, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BaamComposer } from "@/components/baam-composer";
import type { BaamController } from "@/components/use-baam-companion";

const consent = vi.hoisted(() => ({ ready: false }));
vi.mock("@/components/ai-privacy-consent", () => ({ AiPrivacyConsent: ({children}: {children: ReactNode}) => consent.ready ? children : <p>Checking consent</p> }));
afterEach(() => { cleanup(); consent.ready = false; });

function fixture() {
  const inputRef = createRef<HTMLTextAreaElement>();
  const controller = { inputRef, workflows: [], allowed: true, available: true, question: "", attachments: [],
    voice: {recording:false, requesting:false}, capabilities:{data:{}}, t: (key: string) => key,
  } as unknown as BaamController;
  const tree = () => <><button data-baam-launcher>Open</button><input aria-label="Other page field" />
    <div data-baam-drawer tabIndex={-1}><button>Other dialog action</button><BaamComposer c={controller} /></div></>;
  return { tree, inputRef };
}

it("focuses the composer when it mounts after the consent query while the launcher still has focus", () => {
  const f = fixture(), view = render(f.tree());
  view.getByRole("button", {name:"Open"}).focus();
  expect(f.inputRef.current).toBeNull();
  consent.ready = true; view.rerender(f.tree());
  expect(document.activeElement).toBe(view.getByRole("textbox", {name:"placeholder"}));
  expect(f.inputRef.current).toBe(document.activeElement);
});

it.each(["Other page field", "Other dialog action"])("preserves deliberately moved focus: %s", (name) => {
  const f = fixture(), view = render(f.tree());
  view.getByRole(name === "Other page field" ? "textbox" : "button", {name}).focus();
  const before = document.activeElement;
  consent.ready = true; view.rerender(f.tree());
  expect(document.activeElement).toBe(before);
  expect(f.inputRef.current).toBe(view.getByRole("textbox", {name:"placeholder"}));
});
