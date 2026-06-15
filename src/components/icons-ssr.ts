import { createElement, type ComponentType } from "react";
import type { IconProps, IconWeight } from "@phosphor-icons/react";
import {
  ArrowRight,
  ArrowUpRight,
  Barcode,
  BookOpen,
  CheckCircle,
  CreditCard,
  DeviceMobile,
  FileXls,
  Key,
  Mailbox,
  MagnifyingGlass,
  Package,
  Printer,
  Receipt,
  SealCheck,
  ShieldCheck,
  Storefront,
  Truck,
  Users,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr";

const createBazaarIcon = (
  Icon: ComponentType<IconProps>,
  defaultWeight: IconWeight = "regular",
) => {
  const BazaarIcon = ({ weight, ...props }: IconProps) =>
    createElement(Icon, { ...props, weight: weight ?? defaultWeight });
  BazaarIcon.displayName = Icon.displayName ?? Icon.name ?? "BazaarIcon";
  return BazaarIcon;
};

const navIcon = (Icon: ComponentType<IconProps>) => createBazaarIcon(Icon, "duotone");
const actionIcon = (Icon: ComponentType<IconProps>) => createBazaarIcon(Icon, "regular");

export const ArrowRightIcon = actionIcon(ArrowRight);
export const BarcodeIcon = actionIcon(Barcode);
export const BillingIcon = actionIcon(CreditCard);
export const BookOpenIcon = actionIcon(BookOpen);
export const ExternalLinkIcon = actionIcon(ArrowUpRight);
export const InventoryIcon = navIcon(Warehouse);
export const KeyIcon = actionIcon(Key);
export const MailIcon = actionIcon(Mailbox);
export const MobilePreviewIcon = actionIcon(DeviceMobile);
export const PrintIcon = actionIcon(Printer);
export const ProductsIcon = navIcon(Package);
export const SalesOrdersIcon = navIcon(Receipt);
export const SearchIcon = actionIcon(MagnifyingGlass);
export const SealCheckIcon = actionIcon(SealCheck);
export const ShieldCheckIcon = actionIcon(ShieldCheck);
export const SpreadsheetIcon = actionIcon(FileXls);
export const StatusSuccessIcon = actionIcon(CheckCircle);
export const StoresIcon = navIcon(Storefront);
export const TruckIcon = actionIcon(Truck);
export const UsersIcon = navIcon(Users);
