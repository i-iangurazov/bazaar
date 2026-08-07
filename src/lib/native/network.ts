import { Network, type ConnectionType } from "@capacitor/network";
import type { PluginListenerHandle } from "@capacitor/core";

import { isPluginAvailable } from "@/lib/native/platform";

export type BazaarConnectivity = {
  state: "online" | "offline" | "reconnecting";
  connectionType: ConnectionType;
};

let snapshot: BazaarConnectivity = {
  state: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  connectionType: "unknown",
};
const listeners = new Set<() => void>();
let nativeListener: PluginListenerHandle | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const publish = (next: BazaarConnectivity) => {
  if (snapshot.state === next.state && snapshot.connectionType === next.connectionType) return;
  snapshot = next;
  for (const listener of listeners) listener();
};

const applyConnection = (connected: boolean, connectionType: ConnectionType) => {
  if (!connected) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    publish({ state: "offline", connectionType });
    return;
  }
  if (snapshot.state === "offline") {
    publish({ state: "reconnecting", connectionType });
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      publish({ state: "online", connectionType });
    }, 900);
    return;
  }
  publish({ state: "online", connectionType });
};

export const getConnectivitySnapshot = () => snapshot;
export const getConnectivityServerSnapshot = (): BazaarConnectivity => ({
  state: "online",
  connectionType: "unknown",
});
export const subscribeConnectivity = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const initializeNativeNetwork = async () => {
  if (typeof window === "undefined") return () => undefined;

  const online = () => applyConnection(true, "unknown");
  const offline = () => applyConnection(false, "none");
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);

  if (isPluginAvailable("Network")) {
    try {
      const status = await Network.getStatus();
      applyConnection(status.connected, status.connectionType);
      nativeListener = await Network.addListener("networkStatusChange", (next) => {
        applyConnection(next.connected, next.connectionType);
      });
    } catch {
      applyConnection(navigator.onLine, navigator.onLine ? "unknown" : "none");
    }
  } else {
    applyConnection(navigator.onLine, navigator.onLine ? "unknown" : "none");
  }

  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    void nativeListener?.remove();
    nativeListener = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };
};
