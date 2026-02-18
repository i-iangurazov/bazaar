import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

import { isProductionRuntime } from "@/server/config/runtime";
import { getLogger } from "@/server/logging";
import { getRedisPublisher, getRedisSubscriber, redisConfigured } from "@/server/redis";
import {
  eventsPublishedTotal,
  eventsPublishFailuresTotal,
  incrementCounter,
} from "@/server/metrics/metrics";

export type EventPayload =
  | { type: "inventory.updated"; payload: { storeId: string; productId: string; variantId?: string | null } }
  | { type: "purchaseOrder.updated"; payload: { poId: string; status: string } }
  | {
      type: "lowStock.triggered";
      payload: { storeId: string; productId: string; variantId?: string | null; onHand: number; minStock: number };
    }
  | {
      type: "sale.completed";
      payload: { saleId: string; storeId: string; registerId?: string | null; shiftId?: string | null; number: string };
    }
  | {
      type: "sale.refunded";
      payload: {
        saleReturnId: string;
        storeId: string;
        registerId?: string | null;
        shiftId?: string | null;
        number: string;
      };
    }
  | {
      type: "shift.opened";
      payload: { shiftId: string; storeId: string; registerId: string };
    }
  | {
      type: "shift.closed";
      payload: { shiftId: string; storeId: string; registerId: string };
    };

type Listener = (event: EventPayload) => void;

type EventEnvelope = {
  sourceId: string;
  event: EventPayload;
};

const CHANNEL = "inventory.events";

const toLogError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
};

class InMemoryEventBus {
  private listeners = new Set<Listener>();

  publish(event: EventPayload) {
    incrementCounter(eventsPublishedTotal, { type: event.type });
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class RedisEventBus {
  private listeners = new Set<Listener>();
  private readonly sourceId = randomUUID();
  private readonly logger = getLogger();
  private subscribed = false;
  private redisHealthy = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private subscriberWithHandlers: Redis | null = null;
  private readonly reconnectDelayMs = 1_500;
  private readonly onMessage = (_channel: string, message: string) => {
    try {
      const envelope = JSON.parse(message) as EventEnvelope;
      if (envelope.sourceId === this.sourceId) {
        return;
      }
      for (const listener of this.listeners) {
        listener(envelope.event);
      }
    } catch (error) {
      this.logger.warn({ error: toLogError(error) }, "failed to parse event payload");
    }
  };

  private readonly onError = (error: unknown) => {
    this.handleRedisFailure(error, "subscriber", "subscriber");
  };

  private readonly onEnd = () => {
    this.handleRedisFailure(new Error("subscriberDisconnected"), "subscriber", "subscriber");
  };

  publish(event: EventPayload) {
    incrementCounter(eventsPublishedTotal, { type: event.type });
    for (const listener of this.listeners) {
      listener(event);
    }

    const publisher = getRedisPublisher();
    if (!publisher || !this.redisHealthy) {
      if (!this.redisHealthy) {
        this.scheduleRecovery();
      }
      return;
    }

    const envelope: EventEnvelope = { sourceId: this.sourceId, event };
    publisher
      .publish(CHANNEL, JSON.stringify(envelope))
      .catch((error) => {
        incrementCounter(eventsPublishFailuresTotal, { type: event.type });
        this.handleRedisFailure(error, "publish", event.type);
      });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    this.ensureSubscription();
    if (!this.redisHealthy) {
      this.scheduleRecovery();
    }
    return () => this.listeners.delete(listener);
  }

  private ensureSubscription() {
    if (this.subscribed || !this.redisHealthy) {
      return;
    }
    const subscriber = getRedisSubscriber();
    if (!subscriber) {
      this.handleRedisFailure(new Error("subscriberUnavailable"), "subscribe", "subscribe");
      return;
    }
    this.attachSubscriberHandlers(subscriber);
    this.subscribed = true;
    void (async () => {
      if (subscriber.status === "wait") {
        await subscriber.connect();
      }
      await subscriber.subscribe(CHANNEL);
    })().catch((error) => {
      incrementCounter(eventsPublishFailuresTotal, { type: "subscribe" });
      this.subscribed = false;
      this.handleRedisFailure(error, "subscribe", "subscribe");
    });
  }

  private attachSubscriberHandlers(subscriber: Redis) {
    if (this.subscriberWithHandlers === subscriber) {
      return;
    }

    if (this.subscriberWithHandlers) {
      this.subscriberWithHandlers.off("message", this.onMessage);
      this.subscriberWithHandlers.off("error", this.onError);
      this.subscriberWithHandlers.off("end", this.onEnd);
    }

    this.subscriberWithHandlers = subscriber;
    subscriber.on("message", this.onMessage);
    subscriber.on("error", this.onError);
    subscriber.on("end", this.onEnd);
  }

  private scheduleRecovery() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryRecover();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  private async tryRecover() {
    const publisher = getRedisPublisher();
    const subscriber = getRedisSubscriber();
    if (!publisher || !subscriber) {
      this.scheduleRecovery();
      return;
    }

    try {
      if (publisher.status === "wait") {
        await publisher.connect();
      }
      await publisher.ping();
      this.attachSubscriberHandlers(subscriber);
      if (subscriber.status === "wait") {
        await subscriber.connect();
      }
      if (this.listeners.size) {
        await subscriber.subscribe(CHANNEL);
        this.subscribed = true;
      } else {
        this.subscribed = false;
      }
      this.redisHealthy = true;
      this.logger.info("redis event bus recovered");
    } catch {
      this.scheduleRecovery();
    }
  }

  private handleRedisFailure(error: unknown, source: "publish" | "subscribe" | "subscriber", eventType: string) {
    if (!this.redisHealthy) {
      return;
    }
    this.redisHealthy = false;
    this.subscribed = false;
    const message = isProductionRuntime()
      ? "redis event bus degraded; cross-instance realtime is unavailable"
      : "redis event bus degraded; falling back to in-memory realtime";
    this.logger.warn({ error: toLogError(error), source, eventType }, message);
    this.scheduleRecovery();
  }
}

type AnyEventBus = InMemoryEventBus | RedisEventBus;

const globalForEventBus = globalThis as typeof globalThis & {
  __bazaarEventBus?: AnyEventBus;
};

export const eventBus: AnyEventBus =
  globalForEventBus.__bazaarEventBus ?? (redisConfigured() ? new RedisEventBus() : new InMemoryEventBus());

if (!globalForEventBus.__bazaarEventBus) {
  globalForEventBus.__bazaarEventBus = eventBus;
}
