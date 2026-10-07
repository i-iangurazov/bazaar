"use client";
import { useEffect, useState } from "react";

/** Clearing a search is immediate; typing waits briefly before requesting results. */
export function useDebouncedValue(value: string, delayMs = 180) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return value === "" ? "" : settled;
}
