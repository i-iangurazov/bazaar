"use client";

import { useEffect } from "react";

export const GlobalNumberInputGuard = () => {
  useEffect(() => {
    const preventWheelStep = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        target.type === "number" &&
        document.activeElement === target
      ) {
        event.preventDefault();
      }
    };

    document.addEventListener("wheel", preventWheelStep, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", preventWheelStep, { capture: true });
  }, []);

  return null;
};
