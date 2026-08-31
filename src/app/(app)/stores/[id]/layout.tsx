import type { ReactNode } from "react";

import { DynamicRouteIdGuard } from "@/components/dynamic-route-id-guard";

const StoreIdLayout = async ({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  return <DynamicRouteIdGuard id={id}>{children}</DynamicRouteIdGuard>;
};

export default StoreIdLayout;
