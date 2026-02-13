import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import {
  decrementGauge,
  incrementCounter,
  incrementGauge,
  httpRequestsTotal,
  sseConnectionsActive,
} from "@/server/metrics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storeOrgCache = new Map<string, { organizationId: string; expiresAt: number }>();
const poOrgCache = new Map<string, { organizationId: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

const now = () => Date.now();

const getCachedOrganization = (
  cache: Map<string, { organizationId: string; expiresAt: number }>,
  key: string,
) => {
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt < now()) {
    cache.delete(key);
    return null;
  }
  return hit.organizationId;
};

const setCachedOrganization = (
  cache: Map<string, { organizationId: string; expiresAt: number }>,
  key: string,
  organizationId: string,
) => {
  cache.set(key, { organizationId, expiresAt: now() + CACHE_TTL_MS });
};

const resolveStoreOrganizationId = async (storeId: string) => {
  const cached = getCachedOrganization(storeOrgCache, storeId);
  if (cached) {
    return cached;
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { organizationId: true },
  });
  if (!store) {
    return null;
  }
  setCachedOrganization(storeOrgCache, storeId, store.organizationId);
  return store.organizationId;
};

const resolvePoOrganizationId = async (poId: string) => {
  const cached = getCachedOrganization(poOrgCache, poId);
  if (cached) {
    return cached;
  }
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { organizationId: true },
  });
  if (!po) {
    return null;
  }
  setCachedOrganization(poOrgCache, poId, po.organizationId);
  return po.organizationId;
};

const canReceiveEvent = async (organizationId: string, event: { type: string; payload: unknown }) => {
  if (
    event.type === "inventory.updated" ||
    event.type === "lowStock.triggered" ||
    event.type === "sale.completed" ||
    event.type === "sale.refunded" ||
    event.type === "shift.opened" ||
    event.type === "shift.closed"
  ) {
    const payload = event.payload as { storeId?: string };
    if (!payload.storeId) {
      return false;
    }
    const eventOrgId = await resolveStoreOrganizationId(payload.storeId);
    return eventOrgId === organizationId;
  }

  if (event.type === "purchaseOrder.updated") {
    const payload = event.payload as { poId?: string };
    if (!payload.poId) {
      return false;
    }
    const eventOrgId = await resolvePoOrganizationId(payload.poId);
    return eventOrgId === organizationId;
  }

  return false;
};

export const GET = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token?.organizationId) {
    return new Response("unauthorized", { status: 401 });
  }

  incrementCounter(httpRequestsTotal, { path: "/api/sse" });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      incrementGauge(sseConnectionsActive);
      const send = async (event: { type: string; payload: unknown }) => {
        const allowed = await canReceiveEvent(token.organizationId as string, event);
        if (!allowed || closed) {
          return;
        }
        const payload = JSON.stringify(event.payload);
        controller.enqueue(encoder.encode(`event: ${event.type}\n`));
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      const unsubscribe = eventBus.subscribe((event) => {
        void send(event);
      });
      const keepAlive = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        decrementGauge(sseConnectionsActive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};
