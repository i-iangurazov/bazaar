import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET, revalidate } from "@/app/api/version/route";

describe("public deployment identity", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("exposes only the normalized40hex deployment SHA and prevents caching", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "A".repeat(40));
    vi.stubEnv("DATABASE_URL", "synthetic-not-for-public-output");
    const response = await GET();
    expect(await response.json()).toEqual({ sha: "a".repeat(40) });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });
  it.each([undefined, "", "main", "unsafe-value", "a".repeat(40) + "\n"])("returns null for absent/invalid local release identity: %s", async value => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", value);
    expect(await (await GET()).json()).toEqual({ sha: null });
  });
});
