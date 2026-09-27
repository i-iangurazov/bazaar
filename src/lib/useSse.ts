"use client";

import { useEffect, useRef, useState } from "react";

export type SseEvent = {
  type: string;
  payload: unknown;
};

export const useSse = (
  handlers: Record<string, (payload: unknown) => void>,
  options?: { onConnect?: () => void; monitorHealth?: boolean },
) => {
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  }, [handlers, options]);

  useEffect(() => {
    const monitorHealth = optionsRef.current?.monitorHealth === true;
    const source = new EventSource(monitorHealth ? "/api/sse?health=1" : "/api/sse");
    let healthy = false;
    let healthTimeout: ReturnType<typeof setTimeout> | undefined;
    const updateHealth = (next: boolean) => {
      setConnected(next);
      if (next && !healthy) optionsRef.current?.onConnect?.();
      healthy = next;
    };
    const onHealth = (message: MessageEvent) => {
      clearTimeout(healthTimeout);
      try {
        updateHealth(JSON.parse(message.data).healthy === true);
      } catch {
        updateHealth(false);
      }
      // A silent or stalled stream must restore polling even without an error event.
      healthTimeout = setTimeout(() => updateHealth(false), 35_000);
    };
    const onOpen = () => {
      updateHealth(!monitorHealth);
    };
    const onError = () => {
      clearTimeout(healthTimeout);
      updateHealth(false);
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    if (monitorHealth) source.addEventListener("connection.health", onHealth);

    const listener = (eventName: string) => (message: MessageEvent) => {
      const handler = handlersRef.current[eventName];
      if (!handler) {
        return;
      }
      try {
        const data = JSON.parse(message.data);
        handler(data);
      } catch {
        handler(null);
      }
    };

    const eventNames = Object.keys(handlersRef.current);
    const subscriptions = eventNames.map((eventName) => {
      const handler = listener(eventName);
      source.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      clearTimeout(healthTimeout);
      source.removeEventListener("connection.health", onHealth);
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      subscriptions.forEach(({ eventName, handler }) => {
        source.removeEventListener(eventName, handler);
      });
      source.close();
    };
  }, []);

  return connected;
};
