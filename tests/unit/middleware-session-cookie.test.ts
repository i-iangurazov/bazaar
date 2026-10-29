import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { middleware } from "@/middleware";

const secret = "middleware-cookie-isolated-test-secret";
const payload = { sub: "test-admin", role: "ADMIN", organizationId: "test-org" };
afterEach(() => vi.unstubAllEnvs());

describe("middleware and sign-in session cookie agreement", () => {
  it.each([
    ["production", "https://bazaar.test", "__Secure-next-auth.session-token"],
    ["production", "http://localhost:3122", "__Secure-next-auth.session-token"],
    ["development", "http://localhost:3121", "next-auth.session-token"],
    ["development", "https://localhost:3121", "next-auth.session-token"],
  ] as const)("accepts the cookie issued by %s sign-in at %s", async (mode, origin, cookieName) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("NEXTAUTH_URL", origin);
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const token = await encode({ secret, token: payload });
    const response = await middleware(
      new NextRequest(`${origin}/operations/integrations`, {
        headers: { cookie: `${cookieName}=${token}` },
      }),
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("uses the current secure production session when a stale development cookie also exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3122");
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const token = await encode({ secret, token: payload });
    const response = await middleware(
      new NextRequest("http://localhost:3122/operations/integrations", {
        headers: {
          cookie: `next-auth.session-token=expired; __Secure-next-auth.session-token=${token}`,
        },
      }),
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects an invalid secure session even when a valid development cookie is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3122");
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    const token = await encode({ secret, token: payload });
    const response = await middleware(
      new NextRequest("http://localhost:3122/operations/integrations", {
        headers: {
          cookie: `__Secure-next-auth.session-token=invalid; next-auth.session-token=${token}`,
        },
      }),
    );
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
});
