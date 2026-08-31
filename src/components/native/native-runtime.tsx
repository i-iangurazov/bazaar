"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { PushNotifications, type ActionPerformed, type Token } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { parseNativeDeepLink } from "@/lib/native/deepLinks";
import { reportNativeDiagnostic } from "@/lib/native/diagnostics";
import { getConnectivitySnapshot, subscribeConnectivity } from "@/lib/native/network";
import { registerPushTokenWithBazaar } from "@/lib/native/notifications";
import { getNativePlatform, isPluginAvailable, isNativeApp } from "@/lib/native/platform";
import { compareAppVersions } from "@/lib/native/version";

const promptDismissedKey = "bazaar-native-push-prompt-dismissed-v1";

type UpdateState = { required: boolean; storeUrl: string | null };

const notificationPath = (action: ActionPerformed) => {
  const candidate = action.notification.data?.path;
  if (typeof candidate !== "string") return null;
  return parseNativeDeepLink(
    candidate.startsWith("/") ? `https://www.bazaar.kg${candidate}` : candidate,
  );
};

export const NativeRuntime = () => {
  const t = useTranslations("nativeApp");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useSession();
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const registrationListenerRef = useRef<PluginListenerHandle | null>(null);

  const navigateDeepLink = useCallback(
    (rawUrl: string) => {
      const path = parseNativeDeepLink(rawUrl);
      if (!path) {
        void reportNativeDiagnostic("deep_link_failed", "invalid_or_unsupported");
        return;
      }
      router.push(path);
    },
    [router],
  );

  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    const root = document.documentElement;
    root.classList.add("native-app", `native-${getNativePlatform()}`);
    root.dataset.nativeRuntime = "capacitor";
    root.dataset.nativeKeyboard = "hidden";

    // A Capacitor release always streams the current compatible Bazaar frontend;
    // stale PWA asset caches must never sit between the native shell and Vercel.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        );
    }
    if ("caches" in window) {
      void caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((key) => key.startsWith("bazaar-static-")).map((key) => caches.delete(key)),
          ),
        );
    }

    const handles: PluginListenerHandle[] = [];
    const trackListener = (listener: Promise<PluginListenerHandle>) => {
      void listener.then((handle) => {
        if (active) handles.push(handle);
        else void handle.remove();
      });
    };
    let previousConnectivity = getConnectivitySnapshot().state;
    const unsubscribeConnectivity = subscribeConnectivity(() => {
      const next = getConnectivitySnapshot().state;
      if (next === previousConnectivity) return;
      previousConnectivity = next;
      if (next === "offline") void reportNativeDiagnostic("network_offline");
      if (next === "online") void reportNativeDiagnostic("network_online");
    });
    void Promise.all([
      isPluginAvailable("StatusBar")
        ? StatusBar.setStyle({ style: Style.Default }).then(() =>
            StatusBar.setOverlaysWebView({ overlay: true }),
          )
        : Promise.resolve(),
      isPluginAvailable("SplashScreen")
        ? SplashScreen.hide({ fadeOutDuration: 220 })
        : Promise.resolve(),
    ]).then(() => reportNativeDiagnostic("runtime_ready"));

    if (isPluginAvailable("Keyboard")) {
      trackListener(
        Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => {
          root.dataset.nativeKeyboard = "visible";
          root.style.setProperty("--native-keyboard-height", `${keyboardHeight}px`);
        }),
      );
      trackListener(
        Keyboard.addListener("keyboardWillHide", () => {
          root.dataset.nativeKeyboard = "hidden";
          root.style.setProperty("--native-keyboard-height", "0px");
        }),
      );
    }

    if (isPluginAvailable("App")) {
      void App.getLaunchUrl().then((launch) => launch?.url && navigateDeepLink(launch.url));
      trackListener(
        App.addListener("appUrlOpen", ({ url }) => navigateDeepLink(url)),
      );
      trackListener(
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void queryClient.invalidateQueries();
        }),
      );
      void App.getInfo().then(async (app) => {
        try {
          const response = await fetch("/api/mobile/config", { cache: "no-store" });
          if (!response.ok) return;
          const config = (await response.json()) as {
            minimumSupportedAppVersion: string;
            androidStoreUrl: string | null;
            iosStoreUrl: string | null;
          };
          if (compareAppVersions(app.version, config.minimumSupportedAppVersion) < 0) {
            setUpdateState({
              required: true,
              storeUrl: getNativePlatform() === "ios" ? config.iosStoreUrl : config.androidStoreUrl,
            });
          }
        } catch {
          // A version check outage must not replace normal auth/backend error handling.
        }
      });
    }

    return () => {
      active = false;
      for (const handle of handles) void handle.remove();
      unsubscribeConnectivity();
      root.classList.remove("native-app", "native-ios", "native-android");
      delete root.dataset.nativeRuntime;
      delete root.dataset.nativeKeyboard;
      root.style.removeProperty("--native-keyboard-height");
    };
  }, [navigateDeepLink, queryClient]);

  useEffect(() => {
    if (!isNativeApp() || status !== "authenticated" || !isPluginAvailable("PushNotifications")) {
      return;
    }
    const handles: PluginListenerHandle[] = [];
    let active = true;
    const trackListener = (listener: Promise<PluginListenerHandle>) => {
      void listener.then((handle) => {
        if (active) handles.push(handle);
        else void handle.remove();
      });
    };

    const onRegistration = async (token: Token) => {
      const registered = await registerPushTokenWithBazaar(token);
      if (!registered) void reportNativeDiagnostic("push_registration_failed", "server_rejected");
    };

    if (getNativePlatform() === "android") {
      void PushNotifications.createChannel({
        id: "bazaar-important",
        name: "Bazaar",
        description: t("pushDescription"),
        importance: 4,
        visibility: 0,
        vibration: true,
      });
    }

    trackListener(
      PushNotifications.addListener("registration", onRegistration).then((handle) => {
        registrationListenerRef.current = handle;
        return handle;
      }),
    );
    trackListener(
      PushNotifications.addListener("registrationError", () => {
        void reportNativeDiagnostic("push_registration_failed", "provider_registration");
      }),
    );
    trackListener(
      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const path = notificationPath(action);
        if (path) router.push(path);
        else void reportNativeDiagnostic("deep_link_failed", "push_path_invalid");
      }),
    );
    void PushNotifications.checkPermissions().then((permission) => {
      if (!active) return;
      if (permission.receive === "granted") {
        void PushNotifications.register();
      } else if (
        permission.receive === "prompt" &&
        localStorage.getItem(promptDismissedKey) !== "1"
      ) {
        setShowPushPrompt(true);
      }
    });

    return () => {
      active = false;
      registrationListenerRef.current = null;
      for (const handle of handles) void handle.remove();
    };
  }, [router, status, t]);

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive === "granted") {
        await PushNotifications.register();
        setShowPushPrompt(false);
      } else {
        localStorage.setItem(promptDismissedKey, "1");
        setShowPushPrompt(false);
      }
    } catch {
      void reportNativeDiagnostic("push_registration_failed", "permission_request");
    } finally {
      setPushBusy(false);
    }
  };

  if (!isNativeApp()) return null;

  return (
    <>
      {showPushPrompt ? (
        <aside
          className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.75rem)] z-[950] mx-auto max-w-md rounded-2xl border border-primary/25 bg-background p-4 shadow-2xl"
          role="dialog"
          aria-labelledby="native-push-title"
          data-native-push-prompt
        >
          <h2 id="native-push-title" className="font-semibold text-foreground">
            {t("pushTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("pushDescription")}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void enablePush()} disabled={pushBusy}>
              {t("pushAllow")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                localStorage.setItem(promptDismissedKey, "1");
                setShowPushPrompt(false);
              }}
            >
              {t("notNow")}
            </Button>
          </div>
        </aside>
      ) : null}
      {updateState?.required ? (
        <div
          className="fixed inset-0 z-[1000] grid place-items-center bg-background/95 p-6"
          role="alertdialog"
        >
          <div className="max-w-sm text-center">
            <h2 className="text-xl font-bold">{t("updateRequiredTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("updateRequiredDescription")}</p>
            {updateState.storeUrl ? (
              <Button className="mt-5" asChild>
                <a href={updateState.storeUrl}>{t("updateAction")}</a>
              </Button>
            ) : (
              <Button className="mt-5" asChild>
                <Link href="/help">{t("contactSupport")}</Link>
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};
