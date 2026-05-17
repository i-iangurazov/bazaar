"use client";

import { useEffect, useState } from "react";

export const mobileShellMediaQuery = "(max-width: 767px)";

export const useIsMobile = () => {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileShellMediaQuery);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, []);

  return matches;
};
