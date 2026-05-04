import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA service worker source", () => {
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

  it("keeps private and API responses out of the static cache", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('url.pathname.startsWith("/auth")');
    expect(source).toContain('url.pathname.startsWith("/_next/data/")');
    expect(source).toContain("isPrivateOrDynamicRequest(url)");
  });

  it("uses a network-first navigation fallback instead of serving stale app pages", () => {
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain("fetch(request).catch");
    expect(source).toContain('cache.match("/offline.html")');
  });
});
