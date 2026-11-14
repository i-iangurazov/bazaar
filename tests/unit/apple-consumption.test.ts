import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type fetch from "node-fetch";
import { Response } from "node-fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleConsumptionPayload } from "@/server/billing/appleConsumption";
import { AppleConsumptionClient } from "@/server/billing/appleConsumptionTransport";

const key = readFileSync(join(process.cwd(), "tests/fixtures/apple-synthetic/leaf.key"), "utf8");
const delivered = { customerConsented: true, deliveryStatus: "DELIVERED", sampleContentProvided: false };
describe("Apple consumption V2 minimal facts and official SDK transport", () => {
  afterEach(() => vi.useRealTimers());
  it("omits unknown consumption and neutral refund preference instead of inventing enum values", () => {
    expect(appleConsumptionPayload({ deliveryStatus: "DELIVERED", sampleContentProvided: false })).toEqual(delivered);
    expect(appleConsumptionPayload({ deliveryStatus: null, sampleContentProvided: true })).toBeNull();
    expect(appleConsumptionPayload({ deliveryStatus: "DELIVERED", sampleContentProvided: null })).toBeNull();
  });
  it.each(["UNDELIVERED_QUALITY_ISSUE", "UNDELIVERED_WRONG_ITEM", "UNDELIVERED_SERVER_OUTAGE", "UNDELIVERED_OTHER"])("uses the API-required zero for the buyer's %s classification", deliveryStatus => {
    expect(appleConsumptionPayload({ deliveryStatus, sampleContentProvided: true })).toEqual({ customerConsented: true, deliveryStatus, sampleContentProvided: true, consumptionPercentage: 0 });
  });
  it.each(["Sandbox", "Production"] as const)("uses the official SDK signer and exact %s V2 PUT with a redirect/body/time fence", async environment => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(undefined, { status: 202 }));
    const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", environment, http);
    await client.sendConsumptionInformation("100000000000001", delivered);
    expect(http).toHaveBeenCalledTimes(1);
    const [url, options] = http.mock.calls[0];
    expect(url).toBe(`https://${environment === "Production" ? "api.storekit.apple.com" : "api.storekit-sandbox.apple.com"}/inApps/v2/transactions/consumption/100000000000001`);
    expect(options).toMatchObject({ method: "PUT", redirect: "error", size: 32768, body: JSON.stringify(delivered) });
    const authorization = (options!.headers as Record<string, string>).Authorization;
    const [head, payload, signature] = authorization.slice(7).split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "synthetic-issuer", aud: "appstoreconnect-v1", bid: "kg.bazaar.app" });
    expect(verify("sha256", Buffer.from(`${head}.${payload}`), { key: createPublicKey(key), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });
  it("cannot use the consumption-only subclass for any other SDK endpoint or path injection", async () => {
    const http = vi.fn<typeof fetch>(); const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.getTransactionInfo("100000000000001")).rejects.toThrow("appleConsumptionTransportRefused");
    await expect(client.sendConsumptionInformation("1/../../notifications", delivered)).rejects.toThrow("appleConsumptionTransportRefused");
    expect(http).not.toHaveBeenCalled();
  });
  it("refuses a query parameter or different method even with the exact consumption path", async () => {
    class Probe extends AppleConsumptionClient {
      probe(method: string, query: string) { return this.makeFetchRequest("/inApps/v2/transactions/consumption/1", new URLSearchParams(query), method, JSON.stringify(delivered), {}); }
    }
    const http = vi.fn<typeof fetch>(); const client = new Probe(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.probe("PUT", "cursor=foreign")).rejects.toThrow("appleConsumptionTransportRefused");
    await expect(client.probe("POST", "")).rejects.toThrow("appleConsumptionTransportRefused");
    expect(http).not.toHaveBeenCalled();
  });
  it("rejects extra personal fields, denial preferences and false consent before any network request", async () => {
    const http = vi.fn<typeof fetch>(); const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.sendConsumptionInformation("1", { ...delivered, customerConsented: false })).rejects.toThrow("appleConsumptionTransportRefused");
    await expect(client.sendConsumptionInformation("1", { ...delivered, refundPreference: "DECLINE" })).rejects.toThrow("appleConsumptionTransportRefused");
    expect(http).not.toHaveBeenCalled();
  });
  it("accepts only202 and keeps unexpected success/redirect outcomes distinct from delivery acknowledgement", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(undefined, { status: 200 })).mockResolvedValueOnce(new Response(undefined, { status: 302 }));
    const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.sendConsumptionInformation("1", delivered)).rejects.toThrow("appleConsumptionOutcomeUnknown");
    await expect(client.sendConsumptionInformation("1", delivered)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(2); expect(http.mock.calls.every(([, options]) => options!.redirect === "error")).toBe(true);
  });
  it("bounds response-body reads as well as the request before releasing its abort timer", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(32769), { status: 202, size: 32768 }));
    const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.sendConsumptionInformation("1", delivered)).rejects.toThrow();
    expect(http.mock.calls[0][1]!.size).toBe(32768);
  });
  it("also rejects an oversized streamed response through node-fetch's actual size limiter", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(Readable.from([Buffer.alloc(32769, "x")]), { status: 202, size: 32768 }));
    const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    await expect(client.sendConsumptionInformation("1", delivered)).rejects.toThrow(/over limit|max-size|content size/i);
  });
  it("aborts the actual pending HTTP operation at15s, without an unbounded detached request", async () => {
    vi.useFakeTimers();
    const http = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("synthetic aborted")));
    }));
    const client = new AppleConsumptionClient(key, "SYNTHETIC", "synthetic-issuer", "Sandbox", http);
    const assertion = expect(client.sendConsumptionInformation("1", delivered)).rejects.toThrow("synthetic aborted");
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(http.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
