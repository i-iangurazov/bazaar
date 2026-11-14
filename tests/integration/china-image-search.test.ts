import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import sharp from "sharp";
import { GET, POST } from "@/app/api/china-image-search/route";
import { prisma } from "@/server/db/prisma";
import { getRedisPublisher } from "@/server/redis";
import { imageSearchMode, consumeImageSearchLimit } from "@/server/services/chinaImageSearch";
import { createContractTerms } from "@/server/billing/contractTerms";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const url = "http://localhost:3148/api/china-image-search";
let f: Awaited<ReturnType<typeof seedBase>>;
const cookies = async (user = f.adminUser, claims: Record<string, unknown> = {}) => {
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET!,
    token: {
      sub: user.id,
      sessionVersion: user.sessionVersion,
      role: user.role,
      organizationId: user.organizationId ?? undefined,
      ...claims,
    },
  });
  return `next-auth.session-token=${token}`;
};
const image = () =>
  sharp({ create: { width: 80, height: 80, channels: 3, background: "white" } })
    .withMetadata({ exif: { IFD0: { Artist: "private-synthetic-metadata" } } })
    .jpeg()
    .toBuffer();
const post = async (
  cookie: string,
  options: {
    buffer?: Buffer;
    consent?: string;
    origin?: string;
    fields?: Record<string, string>;
  } = {},
) => {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(options.buffer ?? (await image()))], "photo.jpg", {
      type: "image/jpeg",
    }),
  );
  form.append("consent", options.consent ?? "1");
  for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);
  return POST(
    new Request(url, {
      method: "POST",
      headers: { cookie, origin: options.origin ?? "http://localhost:3148" },
      body: form,
    }),
  );
};
const live = () => {
  vi.stubEnv("HIOBUY_IMAGE_SEARCH_MODE", "live");
  vi.stubEnv("HIOBUY_API_KEY", "synthetic-server-only-secret");
  vi.stubEnv("HIOBUY_CATALOG_USE_CONFIRMED", "1");
  vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "mocked");
};
const upstreamResult = () => ({
  channel: "1688",
  total: 1,
  items: [
    {
      id: "123",
      channel: "1688",
      source_url: "https://detail.1688.com/offer/123.html",
      title: { original: "杯子", translated: "Cup" },
      image: "https://cbu01.alicdn.com/test.jpg",
      price: { display_amount: 10, display_currency: "CNY" },
    },
  ],
});

describeDb("1688 image search: real database auth, plan and organization boundaries", () => {
  beforeEach(async () => {
    await resetDatabase();
    f = await seedBase({ plan: "BUSINESS" });
    vi.stubEnv("HIOBUY_IMAGE_SEARCH_MODE", "demo");
    vi.stubEnv("HIOBUY_IMAGE_SEARCH_ORGANIZATION_IDS", f.org.id);
    vi.stubEnv("HIOBUY_API_KEY", "");
    // Clear only this feature's counters in our explicitly isolated test Redis.
    const redis = getRedisPublisher()!;
    const keys = await redis.keys("*china-image*");
    const prefix = redis.options.keyPrefix ?? "";
    if (keys.length)
      await redis.del(
        ...keys.map((key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key)),
      );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts admin and manager photos and labels every fixture without provider calls or database writes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const user of [f.adminUser, f.managerUser]) {
      const result = await post(await cookies(user));
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(await result.json()).toMatchObject({ mode: "demo", channel: "1688", total: 3 });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.productImage.count()).toBe(0);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).toMatchObject({
      photoUrl: null,
    });
  });
  it("revalidates DB roles, activity and session version instead of trusting JWT claims", async () => {
    expect((await post("")).status).toBe(401);
    expect((await post(await cookies(f.staffUser, { role: "ADMIN" }))).status).toBe(403);
    expect((await post(await cookies(f.cashierUser, { role: "ADMIN" }))).status).toBe(403);
    const cookie = await cookies();
    await prisma.user.update({ where: { id: f.adminUser.id }, data: { isActive: false } });
    expect((await post(cookie)).status).toBe(401);
    await prisma.user.update({
      where: { id: f.adminUser.id },
      data: { isActive: true, sessionVersion: { increment: 1 } },
    });
    expect((await post(cookie)).status).toBe(401);
  });
  it("does not borrow another organization's configuration, identity, photo URL or image ID", async () => {
    const foreign = await prisma.organization.create({
      data: { name: "Other photo search organization", plan: "BUSINESS" },
    });
    vi.stubEnv("HIOBUY_IMAGE_SEARCH_ORGANIZATION_IDS", foreign.id);
    expect(
      (
        await GET(
          new Request(url, {
            headers: { cookie: await cookies(f.adminUser, { organizationId: foreign.id }) },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      await (await GET(new Request(url, { headers: { cookie: await cookies() } }))).json(),
    ).toEqual({ mode: "disabled" });
    const result = await post(await cookies(), {
      fields: {
        organizationId: foreign.id,
        image_id: "other-org-image",
        image_url: "http://127.0.0.1/private",
      },
    });
    expect(result.status).toBe(503);
    vi.stubEnv("HIOBUY_IMAGE_SEARCH_ORGANIZATION_IDS", f.org.id);
    expect((await post(await cookies(), { fields: { organizationId: foreign.id } })).status).toBe(
      200,
    );
  });
  it("preserves approved legacy access and enforces the modern marketplace plan and active coverage", async () => {
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
    expect((await post(await cookies())).status).toBe(200);
    await prisma.subscriptionContract.create({
      data: {
        organizationId: f.org.id,
        catalogVersion: "2026-11",
        termsSnapshot: createContractTerms("2026-11"),
      },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    expect((await post(await cookies())).status).toBe(403);
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "BUSINESS" } });
    expect((await post(await cookies())).status).toBe(403);
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "ENTERPRISE" } });
    expect((await post(await cookies())).status).toBe(200);
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { subscriptionStatus: "CANCELED" },
    });
    expect((await post(await cookies())).status).toBe(403);
  });
  it("rejects cross-site requests, impersonation, forged image bytes, empty and oversized images", async () => {
    const cookie = await cookies();
    expect((await post(cookie, { origin: "https://evil.invalid" })).status).toBe(403);
    expect((await post(`${cookie}; impersonation_session=some-session`)).status).toBe(403);
    expect((await post(cookie, { buffer: Buffer.from("<svg>not raster</svg>") })).status).toBe(400);
    expect((await post(cookie, { buffer: Buffer.alloc(0) })).status).toBe(400);
    expect((await post(cookie, { buffer: Buffer.alloc(3 * 1024 * 1024 + 1) })).status).toBe(413);
    // Body cap also applies without Content-Length; does not parse an unbounded stream.
    expect(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { cookie, "content-type": "multipart/form-data; boundary=x" },
            body: Buffer.alloc(4 * 1024 * 1024),
          }),
        )
      ).status,
    ).toBe(413);
  });
  it("requires explicit live setup, provider terms confirmation and per-request photo consent", async () => {
    live();
    expect(imageSearchMode(f.org.id)).toBe("live");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await post(await cookies(), { consent: "0" })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    for (const [key, value] of [
      ["HIOBUY_CATALOG_USE_CONFIRMED", "0"],
      ["HIOBUY_API_KEY", ""],
      ["HARDENING_EXTERNAL_PROVIDER_MODE", "disabled"],
    ]) {
      vi.stubEnv(key, value);
      expect(imageSearchMode(f.org.id)).toBe("disabled");
      live();
    }
  });
  it("executes the live adapter against a mocked transport, strips EXIF and hides the key", async () => {
    live();
    const fetch = vi.fn().mockResolvedValue(Response.json(upstreamResult()));
    vi.stubGlobal("fetch", fetch);
    const result = await post(await cookies(), { fields: { locale: "ru", channel: "taobao" } });
    expect(result.status).toBe(200);
    const json = await result.json();
    expect(json).toMatchObject({
      mode: "live",
      items: [{ price: 10, currency: "CNY", title: "Cup" }],
    });
    expect(JSON.stringify(json)).not.toContain("secret");
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ channel: "1688", language: "ru", page_size: 20 });
    const metadata = await sharp(Buffer.from(sent.image_base64, "base64")).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe("jpeg");
  });
  it("enforces distributed user, organization and global budgets atomically without provider calls", async () => {
    for (let i = 0; i < 3; i++)
      await consumeImageSearchLimit({ organizationId: f.org.id, userId: f.adminUser.id }, "live");
    await expect(
      consumeImageSearchLimit({ organizationId: f.org.id, userId: f.adminUser.id }, "live"),
    ).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 3; i++)
      await consumeImageSearchLimit({ organizationId: f.org.id, userId: f.managerUser.id }, "live");
    await expect(
      consumeImageSearchLimit({ organizationId: f.org.id, userId: "other" }, "live"),
    ).rejects.toMatchObject({ status: 429 });
    const redis = getRedisPublisher()!;
    await redis.set(
      `china-image:global:${new Date().toISOString().slice(0, 10)}`,
      "45",
      "EX",
      3600,
    );
    await expect(
      consumeImageSearchLimit({ organizationId: "other-org", userId: "other" }, "live"),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      consumeImageSearchLimit({ organizationId: "other-org", userId: "other" }, "demo"),
    ).resolves.toBeUndefined();
  });
  it("does not overspend under concurrent requests or fail open when Redis fails", async () => {
    const identity = { organizationId: f.org.id, userId: f.adminUser.id };
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeImageSearchLimit(identity, "live")),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    live();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(getRedisPublisher()!, "eval").mockRejectedValue(
      new Error("private connection details"),
    );
    const response = await post(await cookies());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "imageSearchUnavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resets the daily provider budget at UTC midnight, independently of the business timezone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T23:59:59Z"));
    await getRedisPublisher()!.set("china-image:global:2026-11-14", "45", "EX", 3600);
    const identity = { organizationId: f.org.id, userId: f.adminUser.id };
    await expect(consumeImageSearchLimit(identity, "live")).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
    await expect(consumeImageSearchLimit(identity, "live")).resolves.toBeUndefined();
  });
});
