import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  store: vi.fn(),
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
  increment: vi.fn(),
  decrement: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: async () => ({
    sub: "user",
    organizationId: "org",
    role: "ADMIN",
    isOrgOwner: true,
  }),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.user },
    store: { findUnique: mocks.store },
  },
}));
vi.mock("@/server/events/eventBus", () => ({
  eventBus: {
    subscribe: mocks.subscribe,
    isRealtimeHealthy: () => true,
  },
}));
vi.mock("@/server/logging", () => ({ getLogger: () => ({ warn: mocks.warn }) }));
vi.mock("@/server/auth/platformOwner", () => ({ isPlatformOwnerEmail: () => false }));
vi.mock("@/server/services/storeAccess", () => ({
  userHasAllStoreAccess: () => true,
  resolveAccessibleStoreIds: async () => [],
}));
vi.mock("@/server/metrics/metrics", () => ({
  decrementGauge: mocks.decrement,
  incrementGauge: mocks.increment,
  incrementCounter: vi.fn(),
  observeHistogram: vi.fn(),
  httpRequestsTotal: {},
  httpRequestDurationMs: {},
  sseConnectionsActive: {},
}));
import { GET } from "@/app/api/sse/route";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({
    id: "user",
    email: "admin@example.invalid",
    organizationId: "org",
    role: "ADMIN",
    isOrgOwner: true,
  });
  mocks.store.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    organizationId: where.id.startsWith("other-") ? "other-org" : "org",
  }));
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
});
afterEach(() => vi.useRealTimers());
const request = (signal?: AbortSignal, query = "") =>
  new Request(`http://localhost/api/sse${query}`, { signal });
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

it("flushes an initial frame immediately, without waiting for the heartbeat", async () => {
  const response = await GET(request());
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
  await reader.cancel();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("retains the explicit delivery-health frame as the first response", async () => {
  const response = await GET(request(undefined, "?health=1"));
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    'event: connection.health\ndata: {"healthy":true}\n\n',
  );
  await reader.cancel();
});

it("rotates before the platform limit and releases every timer and subscription once", async () => {
  const controller = new AbortController();
  const response = await GET(request(controller.signal));
  const reader = response.body!.getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(240_000);
  let frames = 0;
  while (!(await reader.read()).done) frames++;
  expect(frames).toBeGreaterThan(0);
  controller.abort();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  expect(mocks.decrement).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("cancellation while an event is in flight cannot write into a closed stream", async () => {
  const controller = new AbortController();
  const response = await GET(request(controller.signal));
  const listener = mocks.subscribe.mock.calls[0][0];
  listener({ type: "sale.completed", payload: { storeId: "pending-store" } });
  await response.body!.cancel();
  await flush();
  controller.abort();
  expect(mocks.warn).not.toHaveBeenCalled();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not subscribe or retain timers for a request already disconnected", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(request(controller.signal));
  expect((await response.body!.getReader().read()).done).toBe(true);
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["sale.completed", "products.updated"])("ignores unrelated organizations for %s before reading user permissions again", async type => {
  const response = await GET(request());
  mocks.subscribe.mock.calls[0][0]({ type, payload: { storeId: "other-store", productId: "foreign-product" } });
  await flush();
  expect(mocks.user).toHaveBeenCalledOnce();
  await response.body!.cancel();
});

it.each(["sale.completed", "products.updated"])("refreshes %s authorization and closes on revoked user access", async type => {
  const response = await GET(request());
  const reader = response.body!.getReader();
  await reader.read();
  mocks.user.mockResolvedValueOnce(null);
  mocks.subscribe.mock.calls[0][0]({
    type,
    payload: { storeId: "revoked-store" },
  });
  await flush();
  expect((await reader.read()).done).toBe(true);
  expect(mocks.user).toHaveBeenCalledTimes(2);
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

it("closes and cleans up if permission lookup fails instead of rejecting an unobserved promise", async () => {
  const response = await GET(request());
  const reader = response.body!.getReader();
  await reader.read();
  mocks.user.mockRejectedValueOnce(new Error("database temporarily unavailable"));
  mocks.subscribe.mock.calls[0][0]({
    type: "sale.completed",
    payload: { storeId: "failed-store" },
  });
  await flush();
  expect((await reader.read()).done).toBe(true);
  expect(mocks.warn).toHaveBeenCalledOnce();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
