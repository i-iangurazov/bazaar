import { describe, expect, it } from "vitest";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { APPLE_BUNDLE_ID, appleBillingConfig, APPLE_WHATSAPP_OFFER_VERSION } from "@/server/billing/appleConfig";
import { AppleReceiptVerifier } from "@/server/billing/appleVerification";
import { APPLE_ROOT_CERTIFICATES } from "@/server/billing/appleRootCertificates";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { syntheticAppleTransaction, syntheticAppleVerifier, signSyntheticApplePayload } from "../helpers/appleSignedFixture";
const token = "a0db5ac1-4bc0-46a8-86cd-c34d4ea9e743";
const base = () => ({ appAccountToken: token, productId: "kg.bazaar.synthetic.test" });
describe("official Apple signed transaction verification", () => {
  it("verifies a synthetic ES256 certificate chain and keeps USD milliunits distinct from KGS", async () => {
    const receipt = await syntheticAppleVerifier().transaction(syntheticAppleTransaction(base()));
    expect(receipt.data.currency).toBe("USD"); expect(receipt.data.price).toBe(9990);
    expect(receipt.productType).toBe("NON_RENEWING"); expect(receipt.digest).toHaveLength(64);
  });
  it("does not trust the synthetic chain against production Apple roots", async () => {
    const verifier = new AppleReceiptVerifier(new SignedDataVerifier(APPLE_ROOT_CERTIFICATES, false, Environment.SANDBOX, APPLE_BUNDLE_ID));
    await expect(verifier.transaction(syntheticAppleTransaction(base()))).rejects.toThrow("appleInvalidTransaction");
  });
  it.each([
    { bundleId: "kg.attacker.app" }, { environment: "Production" }, { appAccountToken: "not-a-uuid" },
    { signedDate: Date.now() + 86_400_000 }, { quantity: 0 }, { price: -1 }, { currency: "kgs" },
    { type: "Non-Consumable" }, { transactionId: "forged" }, { purchaseDate: 0 },
    { signedDate: Date.UTC(2000, 0, 1) },
  ])("rejects wrong trust context or malformed authoritative data %#", async (overrides) => {
    await expect(syntheticAppleVerifier().transaction(syntheticAppleTransaction({ ...base(), ...overrides })))
      .rejects.toThrow("appleInvalidTransaction");
  });
  it("rejects changed payload and unsigned or truncated certificate chains", async () => {
    const signed = syntheticAppleTransaction(base());
    const [header, body, signature] = signed.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), price: 1 })).toString("base64url")}.${signature}`;
    await expect(syntheticAppleVerifier().transaction(forged)).rejects.toThrow("appleInvalidTransaction");
    await expect(syntheticAppleVerifier().transaction(signSyntheticApplePayload(base(), { alg: "none" }))).rejects.toThrow("appleInvalidTransaction");
  });
  it("checks notifications with the same chain and app identity", async () => {
    const signed = signSyntheticApplePayload({ version: "2.0", notificationUUID: "ac093c60-d12a-4301-9040-e24842a7e059",
      notificationType: "TEST", signedDate: Date.now(), data: { bundleId: APPLE_BUNDLE_ID, environment: "Sandbox", appAppleId: 1234567890 } });
    expect((await syntheticAppleVerifier().notification(signed)).notificationType).toBe("TEST");
  });
});
describe("reviewed App Store catalog configuration", () => {
  const env = (catalog: object[]) => ({ APPLE_BILLING_MODE: "live", APPLE_APP_ID: "1234567890", APPLE_IAP_KEY_ID: "TEST",
    APPLE_IAP_ISSUER_ID: "TEST", APPLE_IAP_PRIVATE_KEY: "SYNTHETIC PRIVATE KEY", APPLE_BILLING_TERMS_VERSION: LEGAL_TERMS_VERSION,
    APPLE_BILLING_TERMS_APPROVED: "true", APPLE_BILLING_SALES_APPROVED: "true", APPLE_BILLING_CATALOG_JSON: JSON.stringify(catalog) });
  const entry = (i: number) => ({ offerKey: `subscription.synthetic.${i}`, productId: `synthetic.${i}`, productType: "AUTO_RENEWABLE", subscriptionGroupId: "group-one", approved: true });
  it("keeps checkout off without actual reviewed products and approval flags", () => {
    expect(appleBillingConfig({}).ready).toBe(false);
    expect(appleBillingConfig(env([{ ...entry(1), approved: false }])).ready).toBe(false);
    expect(appleBillingConfig(env([entry(1), entry(1)])).ready).toBe(false);
  });
  it("enforces Apple's group limit and disallows splitting interchangeable plans into parallel groups", () => {
    expect(appleBillingConfig(env(Array.from({ length: 100 }, (_, i) => entry(i)))).ready).toBe(true);
    expect(appleBillingConfig(env(Array.from({ length: 101 }, (_, i) => entry(i)))).ready).toBe(false);
    expect(appleBillingConfig(env([entry(1), { ...entry(2), subscriptionGroupId: "group-two" }])).ready).toBe(false);
  });
  it("accepts Apple's 100-character product ID boundary and disables the whole invalid catalog at 101", () => {
    const mapping = entry(1);
    expect(appleBillingConfig(env([{ ...mapping, productId: "a".repeat(100) }])).ready).toBe(true);
    expect(appleBillingConfig(env([{ ...mapping, productId: "a".repeat(101) }])).ready).toBe(false);
    expect(appleBillingConfig(env([mapping, { ...entry(2), productId: "a".repeat(101) }])).catalog).toEqual([]);
  });
  it("requires explicit non-expiring Apple WhatsApp terms", () => {
    const mapping = { offerKey: "whatsapp.synthetic", productId: "synthetic.pack", productType: "CONSUMABLE", approved: true };
    expect(appleBillingConfig(env([mapping])).ready).toBe(false);
    expect(appleBillingConfig(env([{ ...mapping, appleOfferVersion: APPLE_WHATSAPP_OFFER_VERSION }])).ready).toBe(true);
  });
});
