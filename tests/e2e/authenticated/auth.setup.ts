import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test as setup } from "@playwright/test";

import {
  assertAuthenticatedE2EBaseUrl,
  authenticatedE2EAccounts,
  authenticatedE2EAccountKeys,
  authenticatedE2EPassword,
  authenticatedE2EStorageStatePath,
} from "./contract";

for (const accountKey of authenticatedE2EAccountKeys) {
  setup(`authenticate local ${accountKey} fixture`, async ({ baseURL, request }) => {
    const baseOrigin = assertAuthenticatedE2EBaseUrl(baseURL);
    const account = authenticatedE2EAccounts[accountKey];
    const csrfResponse = await request.get(`${baseOrigin}/api/auth/csrf`, {
      failOnStatusCode: true,
    });
    const csrfPayload = (await csrfResponse.json()) as { csrfToken?: unknown };
    expect(typeof csrfPayload.csrfToken).toBe("string");

    const callbackResponse = await request.post(`${baseOrigin}/api/auth/callback/credentials`, {
      form: {
        csrfToken: String(csrfPayload.csrfToken),
        email: account.email,
        password: authenticatedE2EPassword,
        callbackUrl: `${baseOrigin}${account.homePath}`,
        json: "true",
      },
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect([200, 302, 303]).toContain(callbackResponse.status());

    await expect
      .poll(
        async () => {
          const sessionResponse = await request.get(`${baseOrigin}/api/auth/session`, {
            failOnStatusCode: false,
          });
          if (!sessionResponse.ok()) return null;
          const session = (await sessionResponse.json()) as {
            user?: {
              email?: string;
              role?: string;
              isPlatformOwner?: boolean;
              isOrgOwner?: boolean;
            };
          };
          return session.user ?? null;
        },
        { timeout: 15_000 },
      )
      .toMatchObject({
        email: account.email,
        role: account.role,
        isPlatformOwner: "isPlatformOwner" in account ? Boolean(account.isPlatformOwner) : false,
        isOrgOwner: "isOrgOwner" in account ? Boolean(account.isOrgOwner) : false,
      });

    const statePath = authenticatedE2EStorageStatePath(accountKey);
    await mkdir(dirname(statePath), { recursive: true });
    await request.storageState({ path: statePath });
  });
}
