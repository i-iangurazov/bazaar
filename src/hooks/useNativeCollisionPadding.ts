"use client";

import { Capacitor } from "@capacitor/core";
import { useMemo, useSyncExternalStore } from "react";
import {
  createNativeHorizontalSafeArea, nativeHorizontalCollisionPadding,
  type NativeHorizontalSafeArea, type OverlayCollisionPadding,
} from "@/lib/native/horizontalSafeArea";

const zero: NativeHorizontalSafeArea = { left: 0, right: 0 };
let snapshot = zero;
let coordinator: ReturnType<typeof createNativeHorizontalSafeArea> | undefined;
const listeners = new Set<() => void>();
const getSnapshot = () => snapshot;
const serverSnapshot = () => zero;
const subscribe = (listener: () => void) => {
  // Web/Android retain their existing Radix props, with no probes/listeners.
  if (!document.documentElement.classList.contains("native-ios") && Capacitor.getPlatform() !== "ios") return () => {};
  listeners.add(listener);
  if (!coordinator) coordinator = createNativeHorizontalSafeArea((next) => {
    snapshot = next;
    for (const update of listeners) update();
  });
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { coordinator?.dispose(); coordinator = undefined; snapshot = zero; }
  };
};

export function useNativeCollisionPadding(padding?: OverlayCollisionPadding) {
  const safeArea = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  return useMemo(() => nativeHorizontalCollisionPadding(padding, safeArea), [padding, safeArea]);
}
