import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { planSchema } from "@/server/services/baamPlan";

const contextSchema = z
  .object({
    version: z.literal(1),
    actorId: z.string().min(1),
    organizationId: z.string().min(1),
    authorizationFingerprint: z.string().min(1),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    storeId: z.string().min(1).optional(),
    plan: planSchema,
    productId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
  })
  .strict();
export type BaamContext = z.infer<typeof contextSchema>;
const lifetime = 30 * 60 * 1000;
const signature = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(`baam-context-v1.${payload}`).digest();

// This token is context, never authentication. Every use requires current
// server authentication and fresh tenant/store authorization. No figures or
// user text are stored. HMAC purpose separation prevents cross-protocol reuse.
export const issueBaamContext = (
  input: Omit<BaamContext, "version" | "issuedAt" | "expiresAt">,
  secret: string,
  now = Date.now(),
) => {
  if (!secret) throw new Error("baamContextNotConfigured");
  const value = contextSchema.parse({
    ...input,
    version: 1,
    issuedAt: now,
    expiresAt: now + lifetime,
  });
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
};

export const readBaamContext = (
  token: string,
  identity: { actorId: string; organizationId: string; authorizationFingerprint: string },
  secret: string,
  now = Date.now(),
): BaamContext | null => {
  try {
    if (!secret || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
      return null;
    const [payload, signed] = token.split(".");
    const actual = Buffer.from(signed, "base64url");
    const expected = signature(payload, secret);
    if (
      actual.length !== expected.length ||
      actual.toString("base64url") !== signed ||
      !timingSafeEqual(actual, expected)
    )
      return null;
    const value = contextSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (
      value.actorId !== identity.actorId ||
      value.organizationId !== identity.organizationId ||
      value.authorizationFingerprint !== identity.authorizationFingerprint ||
      value.issuedAt > now ||
      value.expiresAt <= now ||
      value.expiresAt - value.issuedAt !== lifetime
    )
      return null;
    return value;
  } catch {
    return null;
  }
};
