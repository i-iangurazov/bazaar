import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

import { isPluginAvailable } from "@/lib/native/platform";

const safely = async (operation: () => Promise<void>) => {
  if (!isPluginAvailable("Haptics")) return;
  try {
    await operation();
  } catch {
    // Haptics are enhancement-only and must never block a business action.
  }
};

export const nativeHaptics = {
  scan: () => safely(() => Haptics.impact({ style: ImpactStyle.Light })),
  productAdded: () => safely(() => Haptics.impact({ style: ImpactStyle.Medium })),
  success: () => safely(() => Haptics.notification({ type: NotificationType.Success })),
  warning: () => safely(() => Haptics.notification({ type: NotificationType.Warning })),
  error: () => safely(() => Haptics.notification({ type: NotificationType.Error })),
};
