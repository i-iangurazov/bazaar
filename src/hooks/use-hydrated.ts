"use client";

import { useEffect, useState } from "react";

/** Keep JavaScript-only forms from submitting before their handlers are attached. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
