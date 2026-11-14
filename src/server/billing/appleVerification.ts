import { createHash } from "node:crypto";
import {
  AppStoreServerAPIClient, AutoRenewStatus, Environment, SignedDataVerifier, Type,
  type JWSTransactionDecodedPayload, type JWSRenewalInfoDecodedPayload, type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { z } from "zod";
import { AppError } from "@/server/services/errors";
import { APPLE_BUNDLE_ID, appleBillingConfig, type AppleProductType } from "./appleConfig";
import { APPLE_ROOT_CERTIFICATES } from "./appleRootCertificates";

const verified = Symbol("apple-signed-transaction");
const verifiedRenewal = Symbol("apple-signed-renewal");
export type VerifiedAppleRenewal = {
  readonly [verifiedRenewal]: true; readonly data: JWSRenewalInfoDecodedPayload & {
    originalTransactionId: string; signedDate: number; environment: "Production" | "Sandbox";
  }; readonly signedRenewalInfo: string; readonly digest: string;
};
export const assertVerifiedAppleRenewal = (receipt: VerifiedAppleRenewal) => {
  if (receipt?.[verifiedRenewal] !== true) throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
};
export type VerifiedAppleTransaction = {
  readonly [verified]: true;
  readonly signedTransactionInfo: string;
  readonly digest: string;
  readonly data: JWSTransactionDecodedPayload & {
    transactionId: string; originalTransactionId: string; productId: string;
    appAccountToken: string; purchaseDate: number; signedDate: number;
    environment: "Production" | "Sandbox";
  };
  readonly productType: AppleProductType;
};
export const assertVerifiedAppleTransaction = (receipt: VerifiedAppleTransaction) => {
  if (receipt?.[verified] !== true) throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
};
const safeTimestamp = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v < 8_640_000_000_000_000;
const validId = (v: unknown): v is string => typeof v === "string" && /^[0-9]{1,40}$/.test(v);
const productTypes: Record<string, AppleProductType> = {
  [Type.AUTO_RENEWABLE_SUBSCRIPTION]: "AUTO_RENEWABLE",
  [Type.NON_RENEWING_SUBSCRIPTION]: "NON_RENEWING",
  [Type.CONSUMABLE]: "CONSUMABLE",
};
export class AppleReceiptVerifier {
  constructor(private readonly verifier: SignedDataVerifier) {}
  async transaction(signedTransactionInfo: string): Promise<VerifiedAppleTransaction> {
    try {
      if (typeof signedTransactionInfo !== "string" || signedTransactionInfo.length > 100_000) throw new Error();
      const data = await this.verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      const productType = data.type && productTypes[data.type];
      if (!validId(data.transactionId) || !validId(data.originalTransactionId) || !data.productId || !productType ||
        !z.string().uuid().safeParse(data.appAccountToken).success || !safeTimestamp(data.purchaseDate) || !safeTimestamp(data.signedDate) ||
        !["Sandbox", "Production"].includes(String(data.environment)) || data.bundleId !== APPLE_BUNDLE_ID ||
        data.signedDate > Date.now() + 300_000 || data.purchaseDate > data.signedDate + 300_000 ||
        (data.expiresDate !== undefined && (!safeTimestamp(data.expiresDate) || data.expiresDate <= data.purchaseDate)) ||
        (data.revocationDate !== undefined && !safeTimestamp(data.revocationDate)) ||
        (data.quantity !== undefined && (!Number.isSafeInteger(data.quantity) || data.quantity < 1 || data.quantity > 100)) ||
        (data.price !== undefined && (!Number.isSafeInteger(data.price) || data.price < 0)) ||
        (data.currency !== undefined && !/^[A-Z]{3}$/.test(data.currency)) ||
        ((data.price === undefined) !== (data.currency === undefined)) ||
        (productType === "AUTO_RENEWABLE" && !data.expiresDate)) throw new Error();
      const normalized = { ...data, appAccountToken: data.appAccountToken!.toLowerCase() } as VerifiedAppleTransaction["data"];
      return { [verified]: true, data: normalized, productType, signedTransactionInfo,
        digest: createHash("sha256").update(signedTransactionInfo).digest("hex") };
    } catch { throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400); }
  }
  async renewal(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload> {
    try { return await this.verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo); }
    catch { throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400); }
  }
  async verifiedRenewal(signedRenewalInfo: string): Promise<VerifiedAppleRenewal> {
    const data = await this.renewal(signedRenewalInfo);
    if (signedRenewalInfo.length > 100_000 || !validId(data.originalTransactionId) || !safeTimestamp(data.signedDate) ||
      data.signedDate > Date.now() + 300_000 || !["Production", "Sandbox"].includes(String(data.environment)) ||
      ![AutoRenewStatus.ON, AutoRenewStatus.OFF].includes(data.autoRenewStatus as AutoRenewStatus) ||
      (data.appAccountToken !== undefined && !z.string().uuid().safeParse(data.appAccountToken).success) ||
      (data.gracePeriodExpiresDate !== undefined && !safeTimestamp(data.gracePeriodExpiresDate)))
      throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
    return { [verifiedRenewal]: true, data: { ...data, ...(data.appAccountToken ? { appAccountToken: data.appAccountToken.toLowerCase() } : {}) } as VerifiedAppleRenewal["data"],
      signedRenewalInfo, digest: createHash("sha256").update(signedRenewalInfo).digest("hex") };
  }
  async notification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
    try {
      if (signedPayload.length > 250_000) throw new Error();
      const data = await this.verifier.verifyAndDecodeNotification(signedPayload);
      if (!z.string().uuid().safeParse(data.notificationUUID).success || data.version !== "2.0" ||
        !safeTimestamp(data.signedDate) || data.signedDate > Date.now() + 300_000 || !data.notificationType) throw new Error();
      return data;
    } catch { throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400); }
  }
}
const verifierCache = new Map<string, AppleReceiptVerifier>();
export function appleReceiptVerifier(environment: "Production" | "Sandbox") {
  const config = appleBillingConfig();
  if (environment === "Production" && !config.appAppleId) throw new AppError("appleUnavailable", "CONFLICT", 409);
  const key = `${environment}:${config.appAppleId ?? ""}`;
  const prior = verifierCache.get(key);
  if (prior) return prior;
  const verifier = new AppleReceiptVerifier(new SignedDataVerifier(APPLE_ROOT_CERTIFICATES, true,
    environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX, APPLE_BUNDLE_ID, config.appAppleId));
  verifierCache.set(key, verifier);
  return verifier;
}
/** Try each permitted trust context; an unverified JWS payload never selects an environment. */
export async function verifyAppleTransaction(signedTransactionInfo: string) {
  for (const environment of ["Production", "Sandbox"] as const) {
    try { return await appleReceiptVerifier(environment).transaction(signedTransactionInfo); } catch { /* Try the other cryptographically checked context. */ }
  }
  throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
}
export function appleApiClient(environment: string) {
  const config = appleBillingConfig();
  if (!config.apiReady || !["Production", "Sandbox"].includes(environment)) throw new AppError("appleUnavailable", "CONFLICT", 409);
  return new AppStoreServerAPIClient(config.privateKey, config.keyId, config.issuerId, APPLE_BUNDLE_ID,
    environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX);
}
