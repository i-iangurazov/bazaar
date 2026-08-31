import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { normalizeDynamicRouteId } from "@/lib/dynamicRouteId";

export const DynamicRouteIdGuard = ({ id, children }: { id: unknown; children: ReactNode }) => {
  if (!normalizeDynamicRouteId(id)) {
    notFound();
  }

  return children;
};
