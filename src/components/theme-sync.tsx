"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import {
  applyThemePreference,
  persistThemeCookie,
  resolveThemePreference,
} from "@/lib/theme";

export const ThemeSync = () => {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    const nextTheme = resolveThemePreference(session.user.themePreference);
    applyThemePreference(nextTheme);
    persistThemeCookie(nextTheme);
  }, [pathname, session?.user.themePreference, status]);

  return null;
};
