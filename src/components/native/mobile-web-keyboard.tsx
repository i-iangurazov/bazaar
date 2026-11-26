"use client";

import { useEffect } from "react";
import { createWebKeyboardViewport } from "@/lib/native/keyboardViewport";
import { hasMobileKeyboard } from "@/lib/native/mobileKeyboard";
import { isNativeApp } from "@/lib/native/platform";

export function MobileWebKeyboard() {
  useEffect(() => {
    if (isNativeApp() || !hasMobileKeyboard()) return;
    return createWebKeyboardViewport(document.documentElement).dispose;
  }, []);
  return null;
}
