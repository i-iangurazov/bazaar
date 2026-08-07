import { App } from "@capacitor/app";
import { Device } from "@capacitor/device";

import { isPluginAvailable, getNativePlatform } from "@/lib/native/platform";

export type NativeDiagnosticEvent =
  | "runtime_ready"
  | "network_offline"
  | "network_online"
  | "deep_link_failed"
  | "push_registration_failed"
  | "native_share_failed";

export const reportNativeDiagnostic = async (event: NativeDiagnosticEvent, detail?: string) => {
  if (!isPluginAvailable("App")) return;
  try {
    const [app, device] = await Promise.all([
      App.getInfo(),
      isPluginAvailable("Device") ? Device.getInfo() : null,
    ]);
    await fetch("/api/mobile/diagnostics", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        detail: detail?.slice(0, 120),
        platform: getNativePlatform(),
        appVersion: app.version,
        build: app.build,
        osVersion: device?.osVersion,
      }),
      keepalive: true,
    });
  } catch {
    // Diagnostics must never affect the customer flow.
  }
};
