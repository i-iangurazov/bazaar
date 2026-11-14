// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Execute the exact expression evaluated by WKWebView, rather than a separate
// JavaScript rewrite of its readiness rules. Native origin/frame enforcement
// remains in the compiled controller and the existing billing-origin checks.
const source = readFileSync("ios/App/App/BazaarBridgeViewController.swift", "utf8");
const expression = source.match(/private static let readinessScript = #"""([\s\S]*?)"""#/)?.[1];
if (!expression) throw new Error("Native startup readiness expression is missing");
// Model the browser's top-level frame identity explicitly; document and styles
// remain the real jsdom DOM. A non-self top object exercises the child frame.
const mainFrame = {} as { top: object };
mainFrame.top = mainFrame;
// The Swift multiline literal starts with a newline. Parentheses prevent JS
// automatic semicolon insertion from turning `return\n...` into undefined.
const evaluate = new Function("window", "document", "getComputedStyle", `return (${expression});`) as (
  context: { top: object }, doc: Document, style: typeof getComputedStyle,
) => boolean;
const ready = (context: { top: object } = mainFrame) =>
  Boolean(evaluate(context, document, getComputedStyle));

describe("native startup uses actual document readiness", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-native-runtime");
    document.body.innerHTML = "";
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 320, height: 200, top: 0, left: 0, right: 320, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the cover over SSR login markup until the global native runtime actually hydrates", () => {
    document.body.innerHTML = '<script src="/_next/static/chunks/app.js"></script><main><form><label>Email<input /></label><button>Sign in</button></form></main>';
    expect(ready()).toBe(false);
    document.documentElement.dataset.nativeRuntime = "capacitor";
    expect(ready()).toBe(true);
  });

  it("accepts a visible hydrated app without waiting for every optional asset to finish", () => {
    document.body.innerHTML = "<main><h1>Dashboard</h1><button>Products</button></main>";
    document.documentElement.dataset.nativeRuntime = "capacitor";
    vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
    expect(ready()).toBe(true);
  });

  it("does not dismiss for an empty, hidden, transparent, loading or child-frame document", () => {
    document.documentElement.dataset.nativeRuntime = "capacitor";
    for (const html of ["", "<main></main>", '<main style="visibility:hidden">Private page</main>',
      '<main style="opacity:0">Private page</main>']) {
      document.body.innerHTML = html;
      expect(ready()).toBe(false);
    }
    document.body.innerHTML = "<main>Visible page</main>";
    expect(ready({ top: {} })).toBe(false);
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    expect(ready()).toBe(false);
  });

  it("allows a complete visible plain document while refusing a half-loaded or empty fallback", () => {
    document.body.innerHTML = "<main><h1>Support</h1><p>A visible server document.</p></main>";
    expect(ready()).toBe(true);
    vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
    expect(ready()).toBe(false);
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    expect(ready()).toBe(false);
  });
});
