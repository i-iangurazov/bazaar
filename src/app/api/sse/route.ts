import { getServerAuthToken } from "@/server/auth/token";
import { isPlatformOwnerEmail } from "@/server/auth/platformOwner";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
import {
  resolveAccessibleStoreIds,
  type StoreAccessUser,
  userHasAllStoreAccess,
} from "@/server/services/storeAccess";
import {
  decrementGauge,
  httpRequestDurationMs,
  incrementCounter,
  incrementGauge,
  httpRequestsTotal,
  observeHistogram,
  sseConnectionsActive,
} from "@/server/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreScope = { organizationId: string; storeId: string };
type CachedStoreScope = StoreScope & { expiresAt: number };

const storeScopeCache = new Map<string, CachedStoreScope>();
const poScopeCache = new Map<string, CachedStoreScope>();
const CACHE_TTL_MS = 60_000;

const now = () => Date.now();

const getCachedScope = (cache: Map<string, CachedStoreScope>, key: string) => {
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt < now()) {
    cache.delete(key);
    return null;
  }
  return { organizationId: hit.organizationId, storeId: hit.storeId };
};

const setCachedScope = (cache: Map<string, CachedStoreScope>, key: string, scope: StoreScope) => {
  cache.set(key, { ...scope, expiresAt: now() + CACHE_TTL_MS });
};

const resolveStoreScope = async (storeId: string) => {
  const cached = getCachedScope(storeScopeCache, storeId);
  if (cached) {
    return cached;
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, organizationId: true },
  });
  if (!store) {
    return null;
  }
  const scope = { organizationId: store.organizationId, storeId: store.id };
  setCachedScope(storeScopeCache, storeId, scope);
  return scope;
};

const resolvePoScope = async (poId: string) => {
  const cached = getCachedScope(poScopeCache, poId);
  if (cached) {
    return cached;
  }
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { organizationId: true, storeId: true },
  });
  if (!po) {
    return null;
  }
  const scope = { organizationId: po.organizationId, storeId: po.storeId };
  setCachedScope(poScopeCache, poId, scope);
  return scope;
};

type EventAccess = {
  organizationId: string;
  allowedStoreIds: Set<string> | null;
};

const resolveCurrentEventAccess = async (sessionUser: StoreAccessUser) => {
  const currentUser = await prisma.user.findFirst({
    where: {
      id: sessionUser.id,
      organizationId: sessionUser.organizationId,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      organizationId: true,
      role: true,
      isOrgOwner: true,
    },
  });
  if (!currentUser?.organizationId) {
    return null;
  }
  const accessUser: StoreAccessUser = {
    id: currentUser.id,
    organizationId: currentUser.organizationId,
    role: currentUser.role,
    isOrgOwner: currentUser.isOrgOwner,
    isPlatformOwner: isPlatformOwnerEmail(currentUser.email),
  };
  return {
    organizationId: accessUser.organizationId,
    allowedStoreIds: userHasAllStoreAccess(accessUser)
      ? null
      : new Set(await resolveAccessibleStoreIds(prisma, accessUser)),
  } satisfies EventAccess;
};

const canReceiveStoreScope = (access: EventAccess, scope: StoreScope | null) =>
  Boolean(
    scope &&
    scope.organizationId === access.organizationId &&
    (!access.allowedStoreIds || access.allowedStoreIds.has(scope.storeId)),
  );

const resolveEventScope = async (event: { type: string; payload: unknown }) => {
  if (
    event.type === "assortment.updated" ||
    event.type === "pricing.updated" ||
    event.type === "inventory.updated" ||
    event.type === "lowStock.triggered" ||
    event.type === "sale.completed" ||
    event.type === "sale.refunded" ||
    event.type === "debt.settled" ||
    event.type === "shift.opened" ||
    event.type === "shift.closed" ||
    event.type === "shift.updated" ||
    event.type === "customerOrder.created"
  ) {
    const payload = event.payload as { storeId?: string };
    if (!payload.storeId) {
      return null;
    }
    return resolveStoreScope(payload.storeId);
  }

  if (event.type === "purchaseOrder.updated") {
    const payload = event.payload as { poId?: string };
    if (!payload.poId) {
      return null;
    }
    return resolvePoScope(payload.poId);
  }

  return null;
};

export const GET = async (request: Request) => {
  const startedAt = Date.now();
  const token = await getServerAuthToken();
  if (!token?.organizationId) {
    observeHistogram(
      httpRequestDurationMs,
      { method: request.method.toUpperCase(), path: "/api/sse" },
      Date.now() - startedAt,
    );
    return new Response("unauthorized", { status: 401 });
  }

  const userId = String(token.sub ?? (token as { id?: string }).id ?? "");
  if (!userId) {
    return new Response("unauthorized", { status: 401 });
  }
  const accessUser: StoreAccessUser = {
    id: userId,
    organizationId: String(token.organizationId),
    role: String(token.role ?? "STAFF"),
    isOrgOwner: Boolean((token as { isOrgOwner?: boolean | null }).isOrgOwner),
    isPlatformOwner: Boolean((token as { isPlatformOwner?: boolean | null }).isPlatformOwner),
  };
  const initialAccess = await resolveCurrentEventAccess(accessUser);
  if (!initialAccess) {
    return new Response("unauthorized", { status: 401 });
  }

  incrementCounter(httpRequestsTotal, { path: "/api/sse" });

  const encoder = new TextEncoder();
  let cancelStream: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const timers: {
        keepAlive?: ReturnType<typeof setInterval>;
        lifetime?: ReturnType<typeof setTimeout>;
      } = {};
      let unsubscribe = () => {};
      incrementGauge(sseConnectionsActive);
      const stop = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        clearInterval(timers.keepAlive);
        clearTimeout(timers.lifetime);
        request.signal.removeEventListener("abort", close);
        unsubscribe();
        decrementGauge(sseConnectionsActive);
        if (closeController) controller.close();
      };
      const close = () => stop(true);
      cancelStream = () => stop(false);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      const send = async (event: { type: string; payload: unknown }) => {
        // Redis distributes events across organizations. Reject unrelated events
        // before reloading this user's permissions, keeping authorization fresh
        // for every event that could actually be delivered.
        const scope = await resolveEventScope(event);
        if (closed || scope?.organizationId !== accessUser.organizationId) return;
        const access = await resolveCurrentEventAccess(accessUser);
        if (!access) {
          close();
          return;
        }
        const allowed = canReceiveStoreScope(access, scope);
        if (!allowed || closed) {
          return;
        }
        const payload = JSON.stringify(event.payload);
        controller.enqueue(encoder.encode(`event: ${event.type}\n`));
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      unsubscribe = eventBus.subscribe((event) => {
        void send(event).catch((error: unknown) => {
          if (closed) return;
          getLogger().warn({ err: error }, "realtime event delivery failed");
          close();
        });
      });
      const reportHealth = new URL(request.url).searchParams.get("health") === "1";
      const sendHealth = () => {
        if (reportHealth && !closed) {
          controller.enqueue(
            encoder.encode(
              `event: connection.health\ndata: ${JSON.stringify({ healthy: eventBus.isRealtimeHealthy() })}\n\n`,
            ),
          );
        }
      };
      sendHealth();
      if (!reportHealth) controller.enqueue(encoder.encode(": connected\nretry: 1500\n\n"));
      timers.keepAlive = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        sendHealth();
      }, 15000);

      // End cleanly before Vercel's 300-second limit. EventSource reconnects;
      // cancellation, disconnects and rotation all release the same resources.
      timers.lifetime = setTimeout(close, 240_000);
    },
    cancel() {
      cancelStream?.();
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
  observeHistogram(
    httpRequestDurationMs,
    { method: request.method.toUpperCase(), path: "/api/sse" },
    Date.now() - startedAt,
  );
  return response;
};
