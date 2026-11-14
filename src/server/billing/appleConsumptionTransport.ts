import { AppStoreServerAPIClient, APIException, Environment, type ConsumptionRequest } from "@apple/app-store-server-library";
import fetch, { Response } from "node-fetch";
import { z } from "zod";
import { APPLE_BUNDLE_ID, appleBillingConfig } from "./appleConfig";

export class AppleConsumptionTransportError extends Error {
  constructor(public readonly code: string, public readonly status?: number) { super(code); }
}

/** The official SDK owns JWT creation and V2 payload dispatch. Only its HTTP
 * transport is fenced: one method/path, exact Apple origin, bounded time/body,
 * and no redirect of credentials. No alternate endpoint or caller URL exists. */
export class AppleConsumptionClient extends AppStoreServerAPIClient {
  private readonly consumptionOrigin: string;
  constructor(signingKey: string, keyId: string, issuerId: string, environment: "Production" | "Sandbox",
    private readonly fetchImpl: typeof fetch = fetch) {
    super(signingKey, keyId, issuerId, APPLE_BUNDLE_ID, environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX);
    this.consumptionOrigin = environment === "Production" ? "https://api.storekit.apple.com" : "https://api.storekit-sandbox.apple.com";
  }
  protected override async makeFetchRequest(path: string, query: URLSearchParams, method: string,
    body: string | Buffer | undefined, headers: Record<string, string>): Promise<Response> {
    if (method !== "PUT" || !/^\/inApps\/v2\/transactions\/consumption\/[0-9]{1,40}$/.test(path) || query.toString() || typeof body !== "string")
      throw new AppleConsumptionTransportError("appleConsumptionTransportRefused");
    const payload = z.object({ customerConsented: z.literal(true),
      deliveryStatus: z.enum(["DELIVERED", "UNDELIVERED_QUALITY_ISSUE", "UNDELIVERED_WRONG_ITEM", "UNDELIVERED_SERVER_OUTAGE", "UNDELIVERED_OTHER"]),
      sampleContentProvided: z.boolean(), consumptionPercentage: z.literal(0).optional() }).strict().safeParse(JSON.parse(body));
    if (!payload.success || (payload.data.deliveryStatus === "DELIVERED" ? payload.data.consumptionPercentage !== undefined : payload.data.consumptionPercentage !== 0))
      throw new AppleConsumptionTransportError("appleConsumptionTransportRefused");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(this.consumptionOrigin + path, { method, body, headers, redirect: "error", signal: controller.signal, size: 32_768 });
      // Buffer the bounded response before releasing the timer/consent locks.
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 32_768) throw new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown");
      if (response.ok && response.status !== 202) throw new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown");
      return new Response(text || undefined, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { clearTimeout(timer); }
  }
}

export async function sendAppleConsumptionInformation(environment: "Production" | "Sandbox", transactionId: string, payload: ConsumptionRequest) {
  const config = appleBillingConfig();
  if (!config.apiReady) throw new AppleConsumptionTransportError("appleConsumptionReportingDisabled");
  try {
    await new AppleConsumptionClient(config.privateKey, config.keyId, config.issuerId, environment).sendConsumptionInformation(transactionId, payload);
  } catch (e) {
    if (e instanceof AppleConsumptionTransportError) throw e;
    if (e instanceof APIException) throw new AppleConsumptionTransportError("appleConsumptionProviderRejected", e.httpStatusCode);
    // A connection/timeout failure is never represented as proof of non-send.
    throw new AppleConsumptionTransportError("appleConsumptionOutcomeUnknown");
  }
}
