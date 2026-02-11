"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

import {
  applyThemePreference,
  persistThemeCookie,
  resolveThemePreference,
} from "@/lib/theme";

export const ThemeSync = () => {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    const nextTheme = resolveThemePreference(session.user.themePreference);
    applyThemePreference(nextTheme);
    persistThemeCookie(nextTheme);
  }, [session?.user.themePreference, status]);

  return null;
};
