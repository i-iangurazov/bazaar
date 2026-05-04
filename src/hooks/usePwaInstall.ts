"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PromptOutcome = "accepted" | "dismissed" | "unavailable";

type BeforeInstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform?: string;
};

export type BeforeInstallPromptEvent = Event & {
  platforms?: string[];
  userChoice: Promise<BeforeInstallPromptChoice>;
  prompt: () => Promise<void>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export type PwaEnvironment = {
  isInstalled: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isInAppBrowser: boolean;
  isUnsupported: boolean;
  isSecureInstallContext: boolean;
};

const inAppBrowserPattern =
  /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|WhatsApp|Telegram|Messenger|MicroMessenger|Snapchat/i;

export const detectPwaEnvironment = (windowRef: Window): PwaEnvironment => {
  const navigatorRef = windowRef.navigator as NavigatorWithStandalone;
  const userAgent = navigatorRef.userAgent ?? "";
  const vendor = navigatorRef.vendor ?? "";
  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigatorRef.platform === "MacIntel" && (navigatorRef.maxTouchPoints ?? 0) > 1);
  const isChromium = /Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent);
  const isSafari =
    /Safari/i.test(userAgent) && /Apple/i.test(vendor || "Apple") && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|OPR/i.test(userAgent);
  const isInAppBrowser = inAppBrowserPattern.test(userAgent);
  const isInstalled =
    windowRef.matchMedia?.("(display-mode: standalone)").matches === true ||
    windowRef.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    navigatorRef.standalone === true;
  const isLocalhost =
    windowRef.location.hostname === "localhost" ||
    windowRef.location.hostname === "127.0.0.1" ||
    windowRef.location.hostname === "[::1]";
  const isSecureInstallContext = windowRef.isSecureContext || isLocalhost;
  const isUnsupported = !isInstalled && (isInAppBrowser || (!isIOS && !isChromium && !isSafari));

  return {
    isInstalled,
    isIOS,
    isSafari,
    isInAppBrowser,
    isUnsupported,
    isSecureInstallContext,
  };
};

const getDefaultEnvironment = (): PwaEnvironment => ({
  isInstalled: false,
  isIOS: false,
  isSafari: false,
  isInAppBrowser: false,
  isUnsupported: false,
  isSecureInstallContext: true,
});

export const usePwaInstall = () => {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [environment, setEnvironment] = useState<PwaEnvironment>(getDefaultEnvironment);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateEnvironment = () => setEnvironment(detectPwaEnvironment(window));
    updateEnvironment();
    setIsReady(true);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      updateEnvironment();
    };

    const handleAppInstalled = () => {
      setPromptEvent(null);
      updateEnvironment();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<{ outcome: PromptOutcome }> => {
    if (!promptEvent) {
      return { outcome: "unavailable" };
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    setPromptEvent(null);
    return { outcome: choice.outcome };
  }, [promptEvent]);

  return useMemo(
    () => ({
      ...environment,
      canPrompt: Boolean(promptEvent),
      isReady,
      promptInstall,
    }),
    [environment, isReady, promptEvent, promptInstall],
  );
};
