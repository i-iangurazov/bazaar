import { createElement } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  BookUser as AddressBook,
  Archive,
  RotateCcw as ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowUp,
  ArrowUpDown as ArrowsDownUp,
  ArrowLeftRight as ArrowsLeftRight,
  Barcode,
  BookOpen,
  Calculator as CashRegister,
  Calendar,
  ChartColumn as ChartBar,
  ChartNoAxesCombined as ChartLineUp,
  ChartPie as ChartPieSlice,
  Check,
  CircleCheck as CheckCircle,
  SquareCheck as CheckSquare,
  Clock,
  ClipboardList,
  Coins,
  History as ClockCounterClockwise,
  Copy,
  CreditCard,
  DollarSign as CurrencyDollar,
  Database,
  Smartphone as DeviceMobile,
  GripVertical as DotsSixVertical,
  Ellipsis as DotsThree,
  Mail as Envelope,
  Eye,
  EyeOff as EyeSlash,
  FileText,
  FileSpreadsheet as FileXls,
  Gauge,
  Settings as GearSix,
  Gift,
  Grid2X2 as GridFour,
  Handshake,
  Hash,
  House,
  ContactRound as IdentificationCard,
  Image as ImageSquare,
  LifeBuoy as Lifebuoy,
  Menu as List,
  ListChecks,
  Key,
  Lock,
  Search as MagnifyingGlass,
  Megaphone,
  MessageCircle,
  Mic,
  Minus,
  Monitor,
  Package,
  Send as PaperPlaneTilt,
  Share2 as Path,
  Pencil as PencilSimple,
  PlugZap as PlugsConnected,
  Plus,
  CirclePlus as PlusCircle,
  Printer,
  Activity as Pulse,
  CircleHelp as Question,
  Receipt,
  ReceiptText as ReceiptX,
  Rocket,
  Ruler,
  BadgeCheck as SealCheck,
  ShoppingBag as ShoppingBagOpen,
  LogOut as SignOut,
  SlidersHorizontal,
  Square,
  Sparkles as Sparkle,
  PackageMinus as StackMinus,
  PackagePlus as StackPlus,
  Store as Storefront,
  Network as TreeStructure,
  Tag,
  AlignCenter as TextAlignCenter,
  AlignLeft as TextAlignLeft,
  AlignRight as TextAlignRight,
  Languages as Translate,
  Trash,
  Inbox as Tray,
  Truck,
  Upload as UploadSimple,
  User,
  Users,
  Volume2,
  Warehouse,
  CircleAlert as WarningCircle,
  X,
  CircleX as XCircle,
  ChevronDown as CaretDown,
  ChevronLeft as CaretLeft,
  ChevronRight as CaretRight,
  Download as DownloadSimple,
  ShieldCheck,
} from "lucide-react";

// Keep the Bazaar icon API stable while all screens use Espresso's Lucide stroke style.
const createBazaarIcon = (Icon: LucideIcon) => {
  const BazaarIcon = ({ strokeWidth = 1.6, ...props }: LucideProps) =>
    createElement(Icon, { ...props, strokeWidth });
  BazaarIcon.displayName = Icon.displayName ?? "BazaarIcon";
  return BazaarIcon;
};

const navIcon = createBazaarIcon;
const actionIcon = createBazaarIcon;

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
export const StoreGroupsIcon = navIcon(TreeStructure);
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
export const PdfIcon = actionIcon(FileText);
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
/** Loyalty programme: a bonus/reward gift, deliberately distinct from every other nav icon. */
export const LoyaltyIcon = navIcon(Gift);
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
export const CalendarIcon = actionIcon(Calendar);
export const ClipboardIcon = actionIcon(ClipboardList);
export const CoinsIcon = actionIcon(Coins);
export const HashIcon = actionIcon(Hash);
export const ChatIcon = actionIcon(MessageCircle);
export const MicrophoneIcon = actionIcon(Mic);
export const StopIcon = actionIcon(Square);
export const SpeakerIcon = actionIcon(Volume2);

export { BaamIcon } from "./baam-icon";
