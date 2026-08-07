import { Capacitor } from "@capacitor/core";

export type BazaarNativePlatform = "ios" | "android" | "web";

export const getNativePlatform = (): BazaarNativePlatform => {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
};

export const isNativeApp = () => Capacitor.isNativePlatform();
export const isIOS = () => getNativePlatform() === "ios";
export const isAndroid = () => getNativePlatform() === "android";

export const isPluginAvailable = (name: string) =>
  isNativeApp() && Capacitor.isPluginAvailable(name);
