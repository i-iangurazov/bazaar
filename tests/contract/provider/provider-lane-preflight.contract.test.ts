import { describe, expect, it } from "vitest";

import { configureTestRuntimeEnvironment } from "../../helpers/testRuntimeIsolation";

describe("external-provider contract lane preflight", () => {
  it("preserves only the selected sandbox contract and disables Redis", () => {
    const policy = configureTestRuntimeEnvironment(process.env);

    expect(policy).toMatchObject({
      lane: "provider-contract",
      redisKeyPrefix: "",
      providerContract: process.env.BAZAAR_TEST_PROVIDER_CONTRACT,
    });
    expect(policy.allowedNetworkHosts).not.toHaveLength(0);
    expect(process.env.REDIS_URL).toBe("");
    expect(process.env.REDIS_KEY_PREFIX).toBe("");
  });
});
