"use client";

import { useEffect } from "react";

export const ForceLightTheme = () => {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.dataset.forceLightTheme = "landing";

    return () => {
      if (root.dataset.forceLightTheme === "landing") {
        delete root.dataset.forceLightTheme;
      }
    };
  }, []);

  return null;
};
