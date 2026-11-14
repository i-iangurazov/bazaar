import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/server/services/errors";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const appleCompletionKindSchema = z.enum(["CANCELED", "NOT_STARTED", "DEFERRED", "RECORDED_ONLY"]);
export const appleCompletionChallengeInputSchema = z.object({ intentId: z.string().min(1).max(80), attemptId: z.string().uuid(),
  keyFingerprint: digest, outcome: appleCompletionKindSchema, transactionDigest: digest.optional(), renewalDigest: digest.optional() }).strict()
  .refine((v) => v.outcome === "DEFERRED" ? Boolean(v.transactionDigest && v.renewalDigest) : !v.transactionDigest && !v.renewalDigest);
export const appleCompletionSubmitInputSchema = z.object({ challenge: z.string().min(30).max(3000), signature: z.string().min(80).max(100),
  signedTransactionInfo: z.string().min(30).max(100_000).optional(), signedRenewalInfo: z.string().min(30).max(100_000).optional() }).strict();
const claimsSchema = z.object({ version: z.literal(1), purpose: z.literal("bazaar.apple.completion.v1"), nonce: digest,
  intentId: z.string().min(1).max(80), attemptId: z.string().uuid(), keyFingerprint: digest, origin: z.string().url(),
  outcome: appleCompletionKindSchema, transactionDigest: digest.nullable(), renewalDigest: digest.nullable(),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive() }).strict()
  .refine((v) => v.outcome === "DEFERRED" ? Boolean(v.transactionDigest && v.renewalDigest) : !v.transactionDigest && !v.renewalDigest);
export type AppleCompletionClaims = z.infer<typeof claimsSchema>;
const unavailable = () => new AppError("appleCompletionUnavailable", "CONFLICT", 409);
export const appleEvidenceDigest = (value: string) => createHash("sha256").update(value).digest("hex");

export function parseAppleCompletionPublicKey(encoded: string) {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 200) throw new Error();
    const der = Buffer.from(encoded, "base64"), key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (der.toString("base64") !== encoded || key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      !key.export({ format: "der", type: "spki" }).equals(der)) throw new Error();
    return { key, publicKey: encoded, fingerprint: createHash("sha256").update(der).digest("hex") };
  } catch { throw new AppError("appleCompletionKeyInvalid", "BAD_REQUEST", 400); }
}
function challengeKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) throw unavailable();
  return createHmac("sha256", secret).update("bazaar.apple.completion.challenge.v1").digest();
}
export function mintAppleCompletionChallenge(input: z.infer<typeof appleCompletionChallengeInputSchema>, origin: string, now = Date.now()) {
  const claims: AppleCompletionClaims = { version: 1, purpose: "bazaar.apple.completion.v1", nonce: randomBytes(32).toString("hex"),
    intentId: input.intentId, attemptId: input.attemptId.toLowerCase(), keyFingerprint: input.keyFingerprint, origin,
    outcome: input.outcome, transactionDigest: input.transactionDigest ?? null, renewalDigest: input.renewalDigest ?? null,
    issuedAt: now, expiresAt: now + 300_000 };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { challenge: `${body}.${createHmac("sha256", challengeKey()).update(body).digest("base64url")}`, expiresAt: new Date(claims.expiresAt).toISOString() };
}
/** Verify the server seal before looking up a case. Time is checked again at commit. */
export function readAppleCompletionChallenge(challenge: string): AppleCompletionClaims {
  try {
    if (challenge.length > 3000) throw new Error();
    const parts = challenge.split(".");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const expected = createHmac("sha256", challengeKey()).update(parts[0]).digest(), actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (claims.expiresAt - claims.issuedAt !== 300_000) throw new Error();
    return claims;
  } catch { throw unavailable(); }
}
export function assertFreshAppleCompletion(claims: AppleCompletionClaims, now = Date.now()) {
  if (claims.issuedAt > now + 5000 || claims.expiresAt <= now) throw new AppError("appleCompletionChallengeExpired", "CONFLICT", 409);
}
export function verifyAppleCompletionSignature(challenge: string, signature: string, publicKey: string) {
  try {
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== signature ||
      !verify("sha256", Buffer.from(challenge, "utf8"), { key: parseAppleCompletionPublicKey(publicKey).key, dsaEncoding: "ieee-p1363" }, bytes)) throw new Error();
  } catch { throw unavailable(); }
}
