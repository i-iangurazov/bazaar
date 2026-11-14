import { expect, it } from "vitest";
import { baamTestEnvironment } from "../../scripts/baam/environment";

it("isolates media encryption and provider/database settings while sharing the synthetic key across fixture processes", () => {
  const source = { NODE_ENV: "test" as const, DATABASE_URL: "postgresql://customer.example/private", BAAM_MEDIA_ENCRYPTION_KEY: "customer-key",
    OPENAI_API_KEY: "customer-key", DEEPSEEK_API_KEY: "customer-key" };
  const first = baamTestEnvironment(source), second = baamTestEnvironment({NODE_ENV: "test"});
  expect(first.DATABASE_URL).toContain("127.0.0.1:55440/bazaar_hardening_baam");
  expect(first.OPENAI_API_KEY).toBe(""); expect(first.DEEPSEEK_API_KEY).toBe("");
  expect(first.BAAM_MEDIA_ENCRYPTION_KEY).not.toBe(source.BAAM_MEDIA_ENCRYPTION_KEY);
  expect(Buffer.from(first.BAAM_MEDIA_ENCRYPTION_KEY!, "base64")).toHaveLength(32);
  expect(second.BAAM_MEDIA_ENCRYPTION_KEY).toBe(first.BAAM_MEDIA_ENCRYPTION_KEY);
  expect(first.HARDENING_EXTERNAL_PROVIDER_MODE).toBe("disabled");
});
