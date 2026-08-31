import type { ReactNode } from "react";

import { DynamicRouteIdGuard } from "@/components/dynamic-route-id-guard";

const SalesOrderIdLayout = async ({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  return <DynamicRouteIdGuard id={id}>{children}</DynamicRouteIdGuard>;
};

export default SalesOrderIdLayout;
