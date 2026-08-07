import { App } from "@capacitor/app";
import { Device } from "@capacitor/device";
import { PushNotifications, type Token } from "@capacitor/push-notifications";

import { getNativePlatform, isPluginAvailable } from "@/lib/native/platform";

export const getNativeInstallationId = async () => {
  if (!isPluginAvailable("Device")) return null;
  const result = await Device.getId();
  return result.identifier;
};

export const registerPushTokenWithBazaar = async (token: Token) => {
  const platform = getNativePlatform();
  if (platform === "web") return false;
  const [installation, app, device] = await Promise.all([
    getNativeInstallationId(),
    App.getInfo(),
    Device.getInfo(),
  ]);
  if (!installation) return false;
  const response = await fetch("/api/mobile/devices", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installationId: installation,
      platform,
      token: token.value,
      appVersion: app.version,
      buildNumber: app.build,
      deviceName: device.name || device.model,
      osVersion: device.osVersion,
    }),
  });
  return response.ok;
};

export const disableNativePushBeforeSignOut = async () => {
  if (!isPluginAvailable("PushNotifications")) return;
  try {
    const installationId = await getNativeInstallationId();
    if (installationId) {
      await fetch("/api/mobile/devices", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId }),
        keepalive: true,
      });
    }
  } catch {
    // The server registration is also disabled when a new user claims this installation.
  }
  try {
    await PushNotifications.unregister();
  } catch {
    // OS/provider unregistration is best effort after the server-side disable attempt.
  }
};
