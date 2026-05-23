"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import {
  applyThemePreference,
  persistThemeCookie,
  resolveThemePreference,
} from "@/lib/theme";

export const isPublicLandingPath = (pathname: string | null) => pathname === "/";

export const ThemeSync = () => {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (isPublicLandingPath(pathname)) {
      document.documentElement.classList.remove("dark");
      document.documentElement.dataset.forceLightTheme = "landing";
      return;
    }

    if (document.documentElement.dataset.forceLightTheme === "landing") {
      delete document.documentElement.dataset.forceLightTheme;
    }

    if (status !== "authenticated") {
      return;
    }
    const nextTheme = resolveThemePreference(session.user.themePreference);
    applyThemePreference(nextTheme);
    persistThemeCookie(nextTheme);
  }, [pathname, session?.user.themePreference, status]);

  return null;
};
