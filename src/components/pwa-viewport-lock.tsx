"use client";

import { useEffect } from "react";

const lockedViewportContent =
  "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

export const PwaViewportLock = () => {
  useEffect(() => {
    const viewportMeta =
      document.querySelector<HTMLMetaElement>("meta[name='viewport']") ??
      document.head.appendChild(document.createElement("meta"));
    const previousContent = viewportMeta.getAttribute("content");

    viewportMeta.name = "viewport";
    viewportMeta.setAttribute("content", lockedViewportContent);

    const activeOptions = { passive: false } as AddEventListenerOptions;
    const preventZoomGesture = (event: Event) => {
      event.preventDefault();
    };
    const preventMultiTouchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };
    const preventTrackpadZoom = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    document.addEventListener("gesturestart", preventZoomGesture, activeOptions);
    document.addEventListener("gesturechange", preventZoomGesture, activeOptions);
    document.addEventListener("gestureend", preventZoomGesture, activeOptions);
    document.addEventListener("touchmove", preventMultiTouchZoom, activeOptions);
    window.addEventListener("wheel", preventTrackpadZoom, activeOptions);

    return () => {
      if (previousContent) {
        viewportMeta.setAttribute("content", previousContent);
      }
      document.removeEventListener("gesturestart", preventZoomGesture);
      document.removeEventListener("gesturechange", preventZoomGesture);
      document.removeEventListener("gestureend", preventZoomGesture);
      document.removeEventListener("touchmove", preventMultiTouchZoom);
      window.removeEventListener("wheel", preventTrackpadZoom);
    };
  }, []);

  return null;
};
