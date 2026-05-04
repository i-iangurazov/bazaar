"use client";

import { useEffect } from "react";

const canRegisterServiceWorker = () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]";
  return window.isSecureContext || isLocalhost;
};

export const PwaServiceWorkerRegister = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !canRegisterServiceWorker()) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installation remains available through browser metadata; failed SW registration
      // should not break authenticated app flows.
    });
  }, []);

  return null;
};
