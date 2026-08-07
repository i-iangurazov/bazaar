import type { ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";

import {
  DashboardIcon,
  ImportIcon,
  IntegrationsIcon,
  InventoryIcon,
  OrdersIcon,
  PosIcon,
  ProductsIcon,
  ReceiveIcon,
  ReportsIcon,
  SettingsIcon,
  StockCountsIcon,
  TransferIcon,
  UsersIcon,
  WriteOffIcon,
  OnboardingIcon,
} from "@/components/icons";

const icons: Record<string, ComponentType<IconProps>> = {
  rocket: OnboardingIcon,
  register: PosIcon,
  products: ProductsIcon,
  inventory: InventoryIcon,
  orders: OrdersIcon,
  reports: ReportsIcon,
  integrations: IntegrationsIcon,
  settings: SettingsIcon,
  receive: ReceiveIcon,
  transfer: TransferIcon,
  writeoff: WriteOffIcon,
  count: StockCountsIcon,
  users: UsersIcon,
  import: ImportIcon,
  dashboard: DashboardIcon,
};

export const HelpIcon = ({ name, className }: { name: string; className?: string }) => {
  const Icon = icons[name] ?? OnboardingIcon;
  return <Icon className={className} aria-hidden />;
};
