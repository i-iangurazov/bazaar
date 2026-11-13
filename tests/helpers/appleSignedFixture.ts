import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateKey, sign, X509Certificate } from "node:crypto";
import { Environment, SignedDataVerifier, Type, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { APPLE_BUNDLE_ID } from "@/server/billing/appleConfig";
import { AppleReceiptVerifier } from "@/server/billing/appleVerification";
const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures/apple-synthetic", name));
const key = createPrivateKey(fixture("leaf.key"));
const x5c = ["leaf.pem", "intermediate.pem", "root.pem"].map((name) => new X509Certificate(fixture(name)).raw.toString("base64"));
export const syntheticAppleRoot = fixture("root.pem");
export const syntheticAppleStoreKitConsent = { storefrontId: "143586", currency: "USD", priceMillis: "9990", displayPrice: "$9.99" };
export const syntheticAppleVerifier = (environment = Environment.SANDBOX) => new AppleReceiptVerifier(new SignedDataVerifier(
  [syntheticAppleRoot], false, environment, APPLE_BUNDLE_ID, environment === Environment.PRODUCTION ? 1234567890 : undefined));
export function signSyntheticApplePayload(payload: object, header: object = { alg: "ES256", x5c }) {
  const head = Buffer.from(JSON.stringify(header)).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${head}.${body}`;
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${input}.${signature}`;
}
export function syntheticAppleTransaction(input: { appAccountToken: string; productId: string } & Partial<JWSTransactionDecodedPayload>) {
  const now = Date.now();
  return signSyntheticApplePayload({ bundleId: APPLE_BUNDLE_ID, environment: "Sandbox", transactionId: "100000000000001",
    originalTransactionId: "100000000000001", purchaseDate: now, signedDate: now, type: Type.NON_RENEWING_SUBSCRIPTION,
    quantity: 1, inAppOwnershipType: "PURCHASED", price: 9990, currency: "USD", storefrontId: syntheticAppleStoreKitConsent.storefrontId, ...input });
}
