import { createElement, type ComponentType } from "react";
import type { IconProps, IconWeight } from "@phosphor-icons/react";
import {
  AddressBook,
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowUp,
  ArrowsDownUp,
  ArrowsLeftRight,
  Barcode,
  BookOpen,
  CashRegister,
  ChartBar,
  ChartLineUp,
  ChartPieSlice,
  Check,
  CheckCircle,
  CheckSquare,
  Clock,
  ClockCounterClockwise,
  Copy,
  CreditCard,
  CurrencyDollar,
  Database,
  DeviceMobile,
  DotsSixVertical,
  DotsThree,
  Envelope,
  Eye,
  EyeSlash,
  FilePdf,
  FileText,
  FileXls,
  Gauge,
  GearSix,
  GridFour,
  Handshake,
  House,
  IdentificationCard,
  ImageSquare,
  Lifebuoy,
  List,
  ListChecks,
  Key,
  Lock,
  MagnifyingGlass,
  Megaphone,
  Minus,
  Monitor,
  Package,
  PaperPlaneTilt,
  Path,
  PencilSimple,
  PlugsConnected,
  Plus,
  PlusCircle,
  Printer,
  Pulse,
  Question,
  Receipt,
  ReceiptX,
  Rocket,
  Ruler,
  SealCheck,
  ShoppingBagOpen,
  SignOut,
  SlidersHorizontal,
  Sparkle,
  StackMinus,
  StackPlus,
  Storefront,
  Tag,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  Translate,
  Trash,
  Tray,
  Truck,
  UploadSimple,
  User,
  Users,
  Warehouse,
  WarningCircle,
  X,
  XCircle,
  CaretDown,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  ShieldCheck,
} from "@phosphor-icons/react";

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
const actionIcon = (Icon: ComponentType<IconProps>, weight: IconWeight = "regular") =>
  createBazaarIcon(Icon, weight);

export const DashboardIcon = navIcon(Gauge);
export const InventoryIcon = navIcon(Warehouse);
export const InventoryOverviewIcon = navIcon(ChartPieSlice);
export const ProductMovementIcon = navIcon(ClockCounterClockwise);
export const StockCountsIcon = navIcon(ListChecks);
export const TransferIcon = navIcon(ArrowsLeftRight);
export const WriteOffIcon = navIcon(StackMinus);
export const OrdersIcon = navIcon(FileText);
export const SalesOrdersIcon = navIcon(Receipt);
export const PurchaseOrdersIcon = navIcon(ShoppingBagOpen);
export const PosIcon = navIcon(CashRegister);
export const CustomerDatabaseIcon = navIcon(AddressBook);
export const SuppliersIcon = navIcon(Handshake);
export const ProductsIcon = navIcon(Package);
export const StoresIcon = navIcon(Storefront);
export const UnitsIcon = navIcon(Ruler);
export const UsersIcon = navIcon(Users);
export const IntegrationsIcon = navIcon(PlugsConnected);
export const ReportsIcon = navIcon(ChartLineUp);
export const SettingsIcon = navIcon(GearSix);
export const ImportIcon = navIcon(UploadSimple);
export const RegisterIcon = navIcon(CashRegister);
export const HomeIcon = navIcon(House);

export const AddIcon = actionIcon(Plus);
export const MinusIcon = actionIcon(Minus);
export const CirclePlusIcon = actionIcon(PlusCircle);
export const UploadIcon = actionIcon(UploadSimple);
export const DownloadIcon = actionIcon(DownloadSimple);
export const BackIcon = actionIcon(ArrowLeft);
export const ArrowRightIcon = actionIcon(ArrowRight);
export const ExternalLinkIcon = actionIcon(ArrowUpRight);
export const ReceiveIcon = navIcon(StackPlus);
export const SortIcon = actionIcon(ArrowsDownUp);
export const ArrowUpIcon = actionIcon(ArrowUp);
export const ArrowDownIcon = actionIcon(ArrowDown);
export const GripIcon = actionIcon(DotsSixVertical);
export const ImagePlusIcon = actionIcon(ImageSquare);
export const AdjustIcon = actionIcon(SlidersHorizontal);
export const PdfIcon = actionIcon(FilePdf);
export const PrintIcon = actionIcon(Printer);
export const InstallAppIcon = actionIcon(DeviceMobile);
export const MailIcon = actionIcon(Envelope);
export const SendIcon = actionIcon(PaperPlaneTilt);
export const TruckIcon = actionIcon(Truck);

export const StatusSuccessIcon = actionIcon(CheckCircle);
export const StatusWarningIcon = actionIcon(WarningCircle);
export const StatusDangerIcon = actionIcon(XCircle);
export const StatusPendingIcon = actionIcon(Clock);
export const ActivityIcon = actionIcon(Pulse);

export const MenuIcon = actionIcon(List);
export const CloseIcon = actionIcon(X);
export const EmptyIcon = actionIcon(Tray);
export const SignOutIcon = actionIcon(SignOut);
export const UserIcon = actionIcon(User);
export const ChevronDownIcon = actionIcon(CaretDown);
export const ChevronLeftIcon = actionIcon(CaretLeft);
export const ChevronRightIcon = actionIcon(CaretRight);
export const CheckIcon = actionIcon(Check);
export const SelectAllIcon = actionIcon(CheckSquare);
export const MoreIcon = actionIcon(DotsThree);
export const EditIcon = actionIcon(PencilSimple);
export const ArchiveIcon = actionIcon(Archive);
export const RestoreIcon = actionIcon(ArrowCounterClockwise);
export const ViewIcon = actionIcon(Eye);
export const HideIcon = actionIcon(EyeSlash);
export const DeleteIcon = actionIcon(Trash);
export const OnboardingIcon = navIcon(Rocket);
export const HelpIcon = actionIcon(Question);
export const SupportIcon = actionIcon(Lifebuoy);
export const MetricsIcon = navIcon(ChartBar);
export const DiagnosticsIcon = navIcon(Pulse);
export const PlatformIcon = navIcon(IdentificationCard);
export const JobsIcon = navIcon(Database);
export const BillingIcon = navIcon(CreditCard);
export const WhatsNewIcon = navIcon(Megaphone);
export const SearchIcon = actionIcon(MagnifyingGlass);
export const TagIcon = actionIcon(Tag);
export const PriceIcon = actionIcon(CurrencyDollar);
export const CopyIcon = actionIcon(Copy);
export const LanguageIcon = actionIcon(Translate);
export const GridViewIcon = actionIcon(GridFour);
export const TableViewIcon = actionIcon(List);
export const BarcodeIcon = actionIcon(Barcode);
export const BookOpenIcon = actionIcon(BookOpen);
export const KeyIcon = actionIcon(Key);
export const LockIcon = actionIcon(Lock);
export const SealCheckIcon = actionIcon(SealCheck);
export const ShieldCheckIcon = actionIcon(ShieldCheck);
export const SpreadsheetIcon = actionIcon(FileXls);
export const DesktopPreviewIcon = actionIcon(Monitor);
export const MobilePreviewIcon = actionIcon(DeviceMobile);
export const SparklesIcon = actionIcon(Sparkle);
export const ShareIcon = actionIcon(Path);
export const AlignLeftIcon = actionIcon(TextAlignLeft);
export const AlignCenterIcon = actionIcon(TextAlignCenter);
export const AlignRightIcon = actionIcon(TextAlignRight);
export const FailedReceiptIcon = actionIcon(ReceiptX);
