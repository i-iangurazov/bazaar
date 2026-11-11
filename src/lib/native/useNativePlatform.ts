"use client";

import { useEffect, useState } from "react";
import { getNativePlatform, type BazaarNativePlatform } from "@/lib/native/platform";

/** Wait for hydration before exposing a platform-specific payment flow. */
export function useNativePlatform() {
  const [platform, setPlatform] = useState<BazaarNativePlatform | null>(null);
  useEffect(() => setPlatform(getNativePlatform()), []);
  return platform;
}
