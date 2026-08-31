"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  CustomerSource,
  EmailAutomationStatus,
  EmailAutomationTrigger,
  EmailCampaignFontFamily,
  EmailCampaignRecipientStatus,
  EmailCampaignStatus,
  EmailCampaignTemplate,
  EmailCampaignType,
} from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";

import {
  AddIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BackIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DeleteIcon,
  DesktopPreviewIcon,
  EditIcon,
  GripIcon,
  ImagePlusIcon,
  MobilePreviewIcon,
  SearchIcon,
  SparklesIcon,
  StatusDangerIcon,
  StatusPendingIcon,
  StatusSuccessIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

import {
  builderBlockHasMeaningfulContent,
  deleteBuilderBlock,
  duplicateBuilderBlock,
  insertBuilderBlock,
  moveBuilderBlock,
  reorderBuilderBlocks,
  resolveBuilderPreviewImageSrc,
  updateBuilderBlock,
} from "./builder-utils";

type AudienceMode = "manual" | "segment";
type AudienceSegment = "all" | "new" | "source" | "withPurchases" | "withoutPurchases";
type TabKey = "campaigns" | "automations" | "senders" | "templates";
type PreviewMode = "desktop" | "mobile";
type BuilderMode = "campaign" | "automation";
type BlockAlignment = "left" | "center" | "right";
type TextFontSize = "small" | "normal" | "large" | "huge";
type WorkspaceTranslationValues = Record<string, string | number>;
type WorkspaceTranslator = (key: string, values?: WorkspaceTranslationValues) => string;

const useWorkspaceTranslations = () =>
  useTranslations("emailMarketingWorkspace") as unknown as WorkspaceTranslator;

const builderDesktopMediaQuery = "(min-width: 1280px) and (pointer: fine)";

type CampaignDashboardItem = {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  blocksJson: unknown;
  status: EmailCampaignStatus;
  senderIdentityId: string | null;
  replyToEmail: string | null;
  brandColor: string | null;
  buttonColor: string | null;
  buttonTextColor: string | null;
  backgroundColor: string | null;
  contentBackgroundColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
  borderColor: string | null;
  fontFamily: EmailCampaignFontFamily;
  bannerImageUrl: string | null;
  senderIdentity?: { displayName: string; fromEmail: string } | null;
  recipientCount: number;
  sentCount: number;
  queuedCount: number;
  sendingCount: number;
  acceptedCount: number;
  deferredCount: number;
  deliveredCount: number;
  bouncedCount: number;
  droppedCount: number;
  suppressedCount: number;
  complainedCount: number;
  failedCount: number;
  cancelledCount: number;
  unresolvedCount: number;
  retryableFailedCount: number;
  updatedAt: Date | string | number;
  createdAt: Date | string | number;
};

type AutomationDashboardItem = {
  id: string;
  trigger: EmailAutomationTrigger;
  status: EmailAutomationStatus;
  name: string;
  subject: string;
  preheader: string | null;
  blocksJson: unknown;
  senderIdentityId: string | null;
  brandColor: string | null;
  buttonColor: string | null;
  buttonTextColor: string | null;
  backgroundColor: string | null;
  contentBackgroundColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
  borderColor: string | null;
  fontFamily: EmailCampaignFontFamily;
  logoStoreId: string | null;
  sentCount: number;
  failedCount: number;
  lastTriggeredAt: Date | string | number | null;
};

type CampaignBlock =
  | {
      id: string;
      type: "header";
      showStoreName?: boolean;
      showLogo?: boolean;
      storeName?: string | null;
      heading?: string | null;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "hero";
      imageUrl?: string | null;
      heading?: string | null;
      subtitle?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "text";
      heading?: string | null;
      body?: string | null;
      bodyBold?: boolean;
      bodyFontSize?: TextFontSize;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "button";
      text?: string | null;
      url?: string | null;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "products";
      productIds?: string[];
      showImage?: boolean;
      showPrice?: boolean;
      showDescription?: boolean;
      showButton?: boolean;
      buttonText?: string | null;
      buttonUrl?: string | null;
      productButtonUrls?: Record<string, string>;
      layout?: "one" | "two";
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "orderSummary";
      title?: string | null;
      summaryText?: string | null;
      itemsLabel?: string | null;
      totalLabel?: string | null;
      emptyOrderText?: string | null;
      quantitySeparator?: string | null;
      sampleItemName?: string | null;
      showSummary?: boolean;
      showItems?: boolean;
      showTotals?: boolean;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "promo";
      title?: string | null;
      discountCode?: string | null;
      description?: string | null;
      expiryText?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
      alignment?: BlockAlignment;
    }
  | {
      id: string;
      type: "divider";
    }
  | {
      id: string;
      type: "footer";
      storeName?: string | null;
      phone?: string | null;
      address?: string | null;
      text?: string | null;
      unsubscribeText?: string | null;
      showUnsubscribe?: boolean;
      alignment?: BlockAlignment;
    };

const uid = () => Math.random().toString(36).slice(2, 10);
const defaultBrandColor = "#111827";
const defaultButtonTextColor = "#ffffff";
const defaultEmailBackgroundColor = "#f4f5f7";
const defaultEmailContentBackgroundColor = "#ffffff";
const defaultEmailTextColor = "#111827";
const defaultEmailMutedTextColor = "#4b5563";
const defaultEmailBorderColor = "#e5e7eb";
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const checkboxClass =
  "h-4 w-4 rounded border border-border text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const blockAlignmentValues = ["left", "center", "right"] as const;
const blockAlignmentIcons = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
} satisfies Record<BlockAlignment, typeof AlignLeftIcon>;
const textFontSizeClasses = {
  small: "text-xs",
  normal: "text-sm",
  large: "text-lg",
  huge: "text-2xl",
} satisfies Record<TextFontSize, string>;

const normalizeBlockAlignment = (alignment?: BlockAlignment | null): BlockAlignment =>
  alignment === "center" || alignment === "right" ? alignment : "left";

const alignmentClassName = (alignment?: BlockAlignment | null) => {
  const normalized = normalizeBlockAlignment(alignment);
  if (normalized === "center") return "text-center";
  if (normalized === "right") return "text-right";
  return "text-left";
};

const logoAlignmentClassName = (alignment?: BlockAlignment | null) => {
  const normalized = normalizeBlockAlignment(alignment);
  if (normalized === "center") return "mx-auto";
  if (normalized === "right") return "ml-auto";
  return "";
};

const textFontSizeClassName = (fontSize?: TextFontSize | null) =>
  (fontSize ? textFontSizeClasses[fontSize] : undefined) ?? "text-sm";

const productButtonUrlForPreview = (
  block: Extract<CampaignBlock, { type: "products" }>,
  productId: string,
) => (block.productButtonUrls?.[productId]?.trim() || block.buttonUrl?.trim() || "").trim();

const getBlockAlignment = (block: CampaignBlock): BlockAlignment =>
  "alignment" in block ? normalizeBlockAlignment(block.alignment) : "left";

const sourceValues = [
  CustomerSource.IMPORT,
  CustomerSource.ORDER,
  CustomerSource.MANUAL,
  CustomerSource.INTEGRATION,
];

const sourceLabel = (t: WorkspaceTranslator, source: CustomerSource) =>
  t(`sources.${source.toLowerCase()}`);

const blockLabel = (t: WorkspaceTranslator, type: CampaignBlock["type"]) =>
  t(`blocks.labels.${type}`);

const blockDescription = (t: WorkspaceTranslator, type: CampaignBlock["type"]) =>
  t(`blocks.descriptions.${type}`);

const blockTypeOptions: CampaignBlock["type"][] = [
  "header",
  "hero",
  "text",
  "button",
  "products",
  "promo",
  "divider",
  "footer",
];

const automationBlockTypeOptions: CampaignBlock["type"][] = [
  "header",
  "text",
  "orderSummary",
  "button",
  "divider",
  "footer",
];

const defaultBlocks = (t: WorkspaceTranslator, storeName?: string | null): CampaignBlock[] => [
  {
    id: `header-${uid()}`,
    type: "header",
    showStoreName: true,
    showLogo: true,
    storeName: storeName ?? "",
    heading: storeName ?? "",
  },
  {
    id: `text-${uid()}`,
    type: "text",
    heading: t("defaults.customerGreeting"),
    body: t("defaults.campaignBody"),
    bodyBold: false,
    bodyFontSize: "normal",
  },
  {
    id: `products-${uid()}`,
    type: "products",
    productIds: [],
    showImage: true,
    showPrice: true,
    showDescription: true,
    showButton: true,
    buttonText: t("defaults.learnMore"),
    productButtonUrls: {},
    layout: "two",
  },
  {
    id: `footer-${uid()}`,
    type: "footer",
    text: t("defaults.marketingFooter"),
    unsubscribeText: t("defaults.unsubscribe"),
    showUnsubscribe: true,
  },
];

const defaultOrderSummaryBlock = (
  t: WorkspaceTranslator,
  id = `order-${uid()}`,
): Extract<CampaignBlock, { type: "orderSummary" }> => ({
  id,
  type: "orderSummary",
  title: t("defaults.orderSummaryTitle"),
  summaryText: t("defaults.orderSummaryLine"),
  itemsLabel: t("defaults.items"),
  totalLabel: t("defaults.total"),
  emptyOrderText: t("defaults.orderEmpty"),
  quantitySeparator: "×",
  sampleItemName: t("defaults.product"),
  showSummary: true,
  showItems: true,
  showTotals: true,
});

const defaultAutomationBlocks = (
  t: WorkspaceTranslator,
  trigger?: EmailAutomationTrigger,
): CampaignBlock[] => [
  {
    id: `header-${uid()}`,
    type: "header",
    showStoreName: true,
    showLogo: true,
    storeName: "",
    heading:
      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
        ? t("defaults.orderStatusChanged")
        : t("defaults.orderThankYou"),
  },
  {
    id: `text-${uid()}`,
    type: "text",
    heading:
      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
        ? t("defaults.orderNowStatus")
        : t("defaults.orderAccepted"),
    body: t("defaults.orderBody"),
    bodyBold: false,
    bodyFontSize: "normal",
  },
  {
    ...defaultOrderSummaryBlock(t),
    summaryText:
      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
        ? t("defaults.orderPreviousAndCurrent")
        : t("defaults.orderSummaryLine"),
  },
  {
    id: `footer-${uid()}`,
    type: "footer",
    text: t("defaults.transactionalFooter"),
    showUnsubscribe: false,
  },
];

const newBlock = (t: WorkspaceTranslator, type: CampaignBlock["type"]): CampaignBlock => {
  const id = `${type}-${uid()}`;
  if (type === "header") return { id, type, showLogo: true, showStoreName: true, storeName: "" };
  if (type === "hero")
    return { id, type, heading: t("defaults.storeNews"), subtitle: "", imageUrl: "" };
  if (type === "text")
    return { id, type, heading: "", body: "", bodyBold: false, bodyFontSize: "normal" };
  if (type === "button") return { id, type, text: t("defaults.learnMore"), url: "" };
  if (type === "products") {
    return {
      id,
      type,
      productIds: [],
      showImage: true,
      showPrice: true,
      showDescription: true,
      showButton: true,
      buttonText: t("defaults.learnMore"),
      productButtonUrls: {},
      layout: "two",
    };
  }
  if (type === "orderSummary") return defaultOrderSummaryBlock(t, id);
  if (type === "promo")
    return { id, type, title: t("defaults.discount"), discountCode: "", description: "" };
  if (type === "divider") return { id, type };
  return {
    id,
    type,
    text: t("defaults.marketingFooter"),
    unsubscribeText: t("defaults.unsubscribe"),
    showUnsubscribe: true,
  };
};

const directImageUrlPattern = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

const looksLikeDirectImageUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return directImageUrlPattern.test(url.pathname + url.search);
  } catch {
    return false;
  }
};

const blockHasContent = (block: CampaignBlock) => {
  if (block.type === "text") return Boolean(block.heading?.trim() || block.body?.trim());
  if (block.type === "products") return Boolean(block.productIds?.length);
  if (block.type === "hero")
    return Boolean(block.heading?.trim() || block.subtitle?.trim() || block.imageUrl?.trim());
  if (block.type === "button") return Boolean(block.text?.trim() && block.url?.trim());
  return true;
};

const blockNeedsDeleteConfirmation = (block: CampaignBlock) =>
  builderBlockHasMeaningfulContent(block);

const editableTextValue = (element: HTMLElement, multiline?: boolean) => {
  const value = (multiline ? element.innerText : (element.textContent ?? "")).replace(
    /\u00a0/g,
    " ",
  );
  return multiline ? value.replace(/\n{3,}/g, "\n\n") : value.replace(/\s+/g, " ").trim();
};

const parseBlocks = (
  t: WorkspaceTranslator,
  value: unknown,
  fallbackBody?: string | null,
): CampaignBlock[] => {
  if (Array.isArray(value)) {
    const parsed = value.filter((item): item is CampaignBlock => {
      return Boolean(item) && typeof item === "object" && "type" in item && "id" in item;
    });
    return parsed.length ? parsed : defaultBlocks(t);
  }
  return [
    { id: `text-${uid()}`, type: "text", body: fallbackBody ?? "" },
    { id: `footer-${uid()}`, type: "footer", showUnsubscribe: true },
  ];
};

const campaignStatusLabel = (t: WorkspaceTranslator, status: EmailCampaignStatus) =>
  t(`campaignStatus.${status.toLowerCase()}`);

const campaignStatusVariant = (status: EmailCampaignStatus) => {
  if (status === EmailCampaignStatus.COMPLETED || status === EmailCampaignStatus.SENT)
    return "success" as const;
  if (
    status === EmailCampaignStatus.QUEUED ||
    status === EmailCampaignStatus.SENDING ||
    status === EmailCampaignStatus.AWAITING_EVENTS
  )
    return "warning" as const;
  if (status === EmailCampaignStatus.FAILED) return "danger" as const;
  return "muted" as const;
};

const recipientLifecycleStatuses = [
  EmailCampaignRecipientStatus.QUEUED,
  EmailCampaignRecipientStatus.SENDING,
  EmailCampaignRecipientStatus.ACCEPTED,
  EmailCampaignRecipientStatus.DEFERRED,
  EmailCampaignRecipientStatus.DELIVERED,
  EmailCampaignRecipientStatus.BOUNCED,
  EmailCampaignRecipientStatus.DROPPED,
  EmailCampaignRecipientStatus.SUPPRESSED,
  EmailCampaignRecipientStatus.COMPLAINED,
  EmailCampaignRecipientStatus.FAILED,
  EmailCampaignRecipientStatus.CANCELLED,
] as const;

const recipientStatusLabel = (t: WorkspaceTranslator, status: EmailCampaignRecipientStatus) =>
  t(`recipientStatus.${status.toLowerCase()}`);

const senderStatusLabel = (t: WorkspaceTranslator, status?: string | null) =>
  t(`senderStatus.${status?.toLowerCase() ?? "pending_dns"}`);

const triggerLabel = (t: WorkspaceTranslator, trigger: EmailAutomationTrigger) =>
  t(`automationTrigger.${trigger.toLowerCase()}`);

const automationStatusLabel = (t: WorkspaceTranslator, status: EmailAutomationStatus) =>
  t(`automationStatus.${status.toLowerCase()}`);

const EditableText = ({
  value,
  placeholder,
  className,
  style,
  multiline,
  selected,
  onChange,
}: {
  value?: string | null;
  placeholder: string;
  className?: string;
  style?: CSSProperties;
  multiline?: boolean;
  selected?: boolean;
  onChange: (value: string) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (
      ref.current &&
      document.activeElement !== ref.current &&
      ref.current.textContent !== (value ?? "")
    ) {
      ref.current.textContent = value ?? "";
    }
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder}
      aria-multiline={multiline}
      data-placeholder={placeholder}
      data-inline-editor
      className={cn(
        "min-h-[1.5rem] rounded-sm px-1 outline-none transition empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] hover:bg-muted/40 focus:bg-primary/5 focus:ring-2 focus:ring-primary/20",
        selected && "bg-primary/5",
        className,
      )}
      style={style}
      onInput={(event) => onChange(editableTextValue(event.currentTarget, multiline))}
      onBlur={(event) => onChange(editableTextValue(event.currentTarget, multiline))}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
};

const SortableBlock = ({
  block,
  selected,
  index,
  canMoveUp,
  canMoveDown,
  onSelect,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  children,
}: {
  block: CampaignBlock;
  selected: boolean;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: ReactNode;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        "group relative rounded-md border bg-white shadow-sm transition",
        selected
          ? "border-primary ring-2 ring-primary/15"
          : "border-transparent hover:border-border",
        isDragging && "z-20 opacity-70",
      )}
      data-email-block-id={block.id}
      onMouseDown={onSelect}
    >
      <button
        type="button"
        className={cn(
          "absolute left-2 top-2 z-10 h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition",
          selected ? "flex" : "hidden group-hover:flex",
        )}
        aria-label={tWorkspace("blocks.drag", { position: index + 1 })}
        {...attributes}
        {...listeners}
      >
        <GripIcon className="h-4 w-4" aria-hidden />
      </button>
      <div
        className={cn(
          "absolute right-2 top-2 z-10 items-center gap-1 rounded-md border border-border bg-background p-1 shadow-sm transition",
          selected ? "flex" : "hidden group-hover:flex",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          aria-label={tWorkspace("actions.moveUp")}
          className="h-8 w-8"
        >
          <ArrowUpIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          aria-label={tWorkspace("actions.moveDown")}
          className="h-8 w-8"
        >
          <ArrowDownIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDuplicate}
          aria-label={tWorkspace("actions.duplicate")}
          className="h-8 w-8"
        >
          <CopyIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDelete}
          aria-label={tWorkspace("actions.delete")}
          className="h-8 w-8 text-danger hover:text-danger"
        >
          <DeleteIcon className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {children}
    </div>
  );
};

const Field = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) => (
  <Label className="block space-y-1.5">
    <span className="block">{label}</span>
    {children}
    {hint ? (
      <span className="block text-xs font-normal leading-5 text-muted-foreground">{hint}</span>
    ) : null}
  </Label>
);

const LogoFileInput = ({
  inputRef,
  onFile,
}: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
}) => (
  <input
    ref={inputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={(event) => {
      onFile(event.target.files?.[0] ?? null);
      event.currentTarget.value = "";
    }}
  />
);

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
};

export const EmailMarketingWorkspace = () => {
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tWorkspace = useWorkspaceTranslations();
  const locale = useLocale();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const builderDesktopReady = useMediaQuery(builderDesktopMediaQuery);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);
  const sendOperationRef = useRef<{ campaignId: string; idempotencyKey: string } | null>(null);
  const utils = trpc.useUtils();

  const [storeId, setStoreId] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("campaigns");
  const [builderMode, setBuilderMode] = useState<BuilderMode>("campaign");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignDetailId, setCampaignDetailId] = useState<string | null>(null);
  const [recipientStatusFilter, setRecipientStatusFilter] = useState<
    "ALL" | EmailCampaignRecipientStatus
  >("ALL");
  const [recipientDetailPage, setRecipientDetailPage] = useState(1);
  const [automationId, setAutomationId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [senderIdentityId, setSenderIdentityId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState("");
  const [blocks, setBlocks] = useState<CampaignBlock[]>(() => defaultBlocks(tWorkspace));
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("segment");
  const [audienceSegment, setAudienceSegment] = useState<AudienceSegment>("all");
  const [source, setSource] = useState<"ALL" | CustomerSource>("ALL");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [productSearch, setProductSearch] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [brandColor, setBrandColor] = useState(defaultBrandColor);
  const [buttonColor, setButtonColor] = useState(defaultBrandColor);
  const [buttonTextColor, setButtonTextColor] = useState(defaultButtonTextColor);
  const [backgroundColor, setBackgroundColor] = useState(defaultEmailBackgroundColor);
  const [contentBackgroundColor, setContentBackgroundColor] = useState(
    defaultEmailContentBackgroundColor,
  );
  const [textColor, setTextColor] = useState(defaultEmailTextColor);
  const [mutedTextColor, setMutedTextColor] = useState(defaultEmailMutedTextColor);
  const [borderColor, setBorderColor] = useState(defaultEmailBorderColor);
  const [fontFamily, setFontFamily] = useState<EmailCampaignFontFamily>(
    EmailCampaignFontFamily.INTER,
  );
  const [logoStoreId, setLogoStoreId] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [senderForm, setSenderForm] = useState({
    displayName: "",
    fromEmail: "",
    replyToEmail: "",
  });
  const builderUnavailableMessage = tWorkspace("builder.unavailableMessage");

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) ?? blocks[0] ?? null;
  const selectedProductIdsForQuery = useMemo(
    () =>
      Array.from(
        new Set(
          blocks.flatMap((block) =>
            block.type === "products" ? (block.productIds ?? []).filter(Boolean) : [],
          ),
        ),
      ),
    [blocks],
  );

  useEffect(() => {
    if (!storeId && stores.length) setStoreId(stores[0]?.id ?? "");
  }, [storeId, stores]);

  const overviewQuery = trpc.emailMarketing.overview.useQuery(
    { storeId, source },
    { enabled: Boolean(storeId) },
  );
  const historyQuery = trpc.emailMarketing.history.useQuery(
    { storeId, limit: 50 },
    { enabled: Boolean(storeId) },
  );
  const hasSendingCampaigns = useMemo(
    () =>
      (historyQuery.data ?? []).some(
        (campaign) =>
          campaign.status === EmailCampaignStatus.QUEUED ||
          campaign.status === EmailCampaignStatus.SENDING,
      ),
    [historyQuery.data],
  );
  const sendingCampaignId = useMemo(
    () =>
      (historyQuery.data ?? []).find(
        (campaign) =>
          campaign.status === EmailCampaignStatus.QUEUED ||
          campaign.status === EmailCampaignStatus.SENDING,
      )?.id ?? null,
    [historyQuery.data],
  );
  const { refetch: refetchCampaignHistory } = historyQuery;
  const campaignDetailQuery = trpc.emailMarketing.detail.useQuery(
    {
      campaignId: campaignDetailId ?? "",
      recipientStatus: recipientStatusFilter === "ALL" ? null : recipientStatusFilter,
      recipientPage: recipientDetailPage,
      recipientPageSize: 100,
    },
    { enabled: Boolean(campaignDetailId) },
  );
  const sendersQuery = trpc.emailMarketing.senders.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );
  const automationsQuery = trpc.emailMarketing.automations.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );
  const { refetch: refetchEmailMarketingOverview } = overviewQuery;
  const logoGalleryQuery = trpc.emailMarketing.logoGallery.useQuery();
  const customersQuery = trpc.emailMarketing.customers.useQuery(
    {
      storeId,
      search: customerSearch,
      source,
      page: customerPage,
      pageSize: 20,
      includeSelectableIds: audienceMode === "manual",
    },
    {
      enabled: Boolean(storeId && builderOpen && builderMode === "campaign"),
      keepPreviousData: true,
    },
  );
  const productsQuery = trpc.emailMarketing.products.useQuery(
    {
      storeId,
      search: productSearch.trim() || null,
      category: null,
      limit: productSearch.trim() ? 25 : 40,
      includeIds: selectedProductIdsForQuery,
    },
    {
      enabled: Boolean(
        storeId &&
        builderOpen &&
        (selectedBlock?.type === "products" || selectedProductIdsForQuery.length > 0),
      ),
    },
  );

  const senderOptions = useMemo(
    () => sendersQuery.data?.senders ?? [],
    [sendersQuery.data?.senders],
  );
  const senderOptionsKey = useMemo(
    () => senderOptions.map((sender) => sender.id).join(","),
    [senderOptions],
  );
  const primarySenderId = sendersQuery.data?.primarySenderId ?? null;
  const effectiveSenderIdentityId = senderIdentityId ?? primarySenderId;
  const selectedSender = useMemo(
    () => senderOptions.find((sender) => sender.id === effectiveSenderIdentityId) ?? null,
    [effectiveSenderIdentityId, senderOptions],
  );
  const defaultSender = sendersQuery.data?.defaultSender ?? null;
  const defaultSenderReady =
    defaultSender?.status === "VERIFIED" || defaultSender?.status === "AVAILABLE";
  const currentSenderReady = effectiveSenderIdentityId
    ? selectedSender?.status === "VERIFIED"
    : defaultSenderReady;
  const currentSenderLabel =
    selectedSender?.fromEmail ?? defaultSender?.fromEmail ?? tWorkspace("senders.bazaarKg");

  useEffect(() => {
    if (!sendersQuery.data) return;
    if (primarySenderId && senderIdentityId !== primarySenderId) {
      setSenderIdentityId(primarySenderId);
      return;
    }
    const stateSender = senderOptions.find((sender) => sender.id === senderIdentityId);
    if (
      !primarySenderId &&
      senderIdentityId &&
      (!stateSender || stateSender.status !== "VERIFIED")
    ) {
      setSenderIdentityId(null);
    }
  }, [primarySenderId, senderIdentityId, senderOptions, senderOptionsKey, sendersQuery.data]);

  useEffect(() => {
    if (!hasSendingCampaigns) return;
    const interval = window.setInterval(() => {
      void refetchCampaignHistory();
      void refetchEmailMarketingOverview();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [hasSendingCampaigns, refetchCampaignHistory, refetchEmailMarketingOverview]);

  const selectedBlockIndex = selectedBlock
    ? blocks.findIndex((block) => block.id === selectedBlock.id)
    : -1;
  const productItems = useMemo(() => productsQuery.data?.items ?? [], [productsQuery.data?.items]);
  const selectedProductMap = useMemo(
    () => new Map(productItems.map((product) => [product.id, product])),
    [productItems],
  );
  const selectedLogo = useMemo(
    () =>
      (logoGalleryQuery.data ?? []).find((logo) => logo.storeId === (logoStoreId || storeId)) ??
      null,
    [logoGalleryQuery.data, logoStoreId, storeId],
  );
  const selectedLogoUrl = selectedLogo?.logoUrl ?? null;
  const bannerUrlLooksDirect = looksLikeDirectImageUrl(bannerImageUrl);

  const campaignInput = useMemo(
    () => ({
      id: campaignId,
      storeId,
      campaignType:
        builderMode === "automation"
          ? EmailCampaignType.TRANSACTIONAL
          : EmailCampaignType.MARKETING,
      senderIdentityId: effectiveSenderIdentityId,
      name: campaignName,
      audience: {
        mode: audienceMode,
        customerIds: selectedCustomerIds,
        segment: audienceSegment,
        source,
        recentDays: 30,
      },
      source,
      template: EmailCampaignTemplate.CUSTOM,
      templateKey: "custom",
      subject,
      preheader: preheader || null,
      senderDisplayName: selectedSender?.displayName ?? selectedStore?.name ?? null,
      replyToEmail: replyToEmail || selectedSender?.replyToEmail || null,
      brandColor,
      buttonColor,
      buttonTextColor,
      backgroundColor,
      contentBackgroundColor,
      textColor,
      mutedTextColor,
      borderColor,
      fontFamily,
      logoStoreId: logoStoreId || storeId || null,
      bannerImageUrl: bannerImageUrl || null,
      blocks,
    }),
    [
      audienceMode,
      audienceSegment,
      backgroundColor,
      bannerImageUrl,
      blocks,
      borderColor,
      brandColor,
      builderMode,
      buttonColor,
      buttonTextColor,
      campaignId,
      campaignName,
      contentBackgroundColor,
      fontFamily,
      logoStoreId,
      mutedTextColor,
      preheader,
      replyToEmail,
      selectedCustomerIds,
      selectedSender?.displayName,
      selectedSender?.replyToEmail,
      selectedStore?.name,
      effectiveSenderIdentityId,
      source,
      storeId,
      subject,
      textColor,
    ],
  );
  const previewMutation = trpc.emailMarketing.preview.useMutation();
  const previewHtml = useMemo(() => {
    const html = previewMutation.data?.rendered.html;
    if (!html || typeof window === "undefined") return html;
    const fallbackHtml = `<div style="display:flex;align-items:center;justify-content:center;min-height:96px;width:100%;box-sizing:border-box;background:#f3f4f6;color:#64748b;font-size:13px;line-height:1.4;text-align:center;padding:16px;border:1px dashed #cbd5e1;">${tWorkspace("preview.imageUnavailable")}</div>`;
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
      const match = tag.match(/\ssrc=(["'])(.*?)\1/i);
      const src = match?.[2];
      if (!src) return tag;
      try {
        const imageUrl = new URL(src, window.location.href);
        const isLocalHost = imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
        return isLocalHost && imageUrl.origin !== window.location.origin ? fallbackHtml : tag;
      } catch {
        return tag;
      }
    });
  }, [previewMutation.data?.rendered.html, tWorkspace]);
  useEffect(() => {
    if (!builderOpen || !storeId) return;
    const timeout = window.setTimeout(() => previewMutation.mutate(campaignInput), 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderOpen, builderMode, campaignInput, storeId]);

  useEffect(() => {
    if (!previewOpen) return;
    const root = previewContentRef.current;
    if (!root) return;
    const replaceWithFallback = (image: HTMLImageElement) => {
      if (image.dataset.previewFallbackApplied) return;
      image.dataset.previewFallbackApplied = "true";
      const fallback = document.createElement("div");
      fallback.textContent = tWorkspace("preview.imageUnavailable");
      fallback.style.cssText =
        "display:flex;align-items:center;justify-content:center;min-height:96px;width:100%;box-sizing:border-box;background:#f3f4f6;color:#64748b;font-size:13px;line-height:1.4;text-align:center;padding:16px;border:1px dashed #cbd5e1;";
      image.replaceWith(fallback);
    };
    const shouldSkipImageLoad = (image: HTMLImageElement) => {
      try {
        const imageUrl = new URL(image.currentSrc || image.src, window.location.href);
        const isLocalHost = imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
        return isLocalHost && imageUrl.origin !== window.location.origin;
      } catch {
        return false;
      }
    };
    root.querySelectorAll("img").forEach((image) => {
      if (!(image instanceof HTMLImageElement)) return;
      if (shouldSkipImageLoad(image)) {
        replaceWithFallback(image);
        return;
      }
      image.addEventListener("error", () => replaceWithFallback(image), { once: true });
    });
  }, [previewOpen, previewHtml, tWorkspace]);

  useEffect(() => {
    if (!builderOpen || builderDesktopReady) return;
    setBuilderOpen(false);
    toast({ variant: "info", description: builderUnavailableMessage });
  }, [builderDesktopReady, builderOpen, builderUnavailableMessage, toast]);

  const createSenderMutation = trpc.emailMarketing.createSender.useMutation({
    onSuccess: async () => {
      setSenderForm({ displayName: "", fromEmail: "", replyToEmail: "" });
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.senderCreated") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const checkDomainMutation = trpc.emailMarketing.checkSenderDomain.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.dnsUpdated") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const archiveSenderMutation = trpc.emailMarketing.archiveSender.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.senderArchived") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const saveDraftMutation = trpc.emailMarketing.saveDraft.useMutation({
    onSuccess: async (campaign) => {
      setCampaignId(campaign.id);
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.draftSaved") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const sendCampaignMutation = trpc.emailMarketing.sendCampaign.useMutation({
    onSuccess: async (result) => {
      sendOperationRef.current = null;
      setConfirmOpen(false);
      setBuilderOpen(false);
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.overview.invalidate(),
      ]);
      const sentNow = result.delivery?.sent ?? 0;
      toast({
        variant: "success",
        description:
          sentNow > 0
            ? tWorkspace("toasts.sendStarted", { count: sentNow })
            : tWorkspace("toasts.campaignQueued", { count: result.recipientCount }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const testMutation = trpc.emailMarketing.sendTest.useMutation({
    onSuccess: () => {
      setTestOpen(false);
      toast({ variant: "success", description: tWorkspace("toasts.testSent") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const duplicateMutation = trpc.emailMarketing.duplicateCampaign.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.campaignDuplicated") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const archiveMutation = trpc.emailMarketing.archiveCampaign.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.campaignArchived") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const deleteDraftMutation = trpc.emailMarketing.deleteCampaignDraft.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.draftDeleted") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const resumeCampaignMutation = trpc.emailMarketing.resumeCampaign.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.overview.invalidate(),
      ]);
      toast({
        variant: result.sent > 0 ? "success" : "info",
        description:
          result.pending > 0
            ? tWorkspace("toasts.moreSent", { sent: result.sent, pending: result.pending })
            : tWorkspace("toasts.sendProcessed", {
                sent: result.sent,
                failed: result.failed,
              }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const reconcileCampaignMutation = trpc.emailMarketing.reconcileCampaign.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.detail.invalidate(),
      ]);
      toast({
        variant: result.failed > 0 ? "info" : "success",
        description: tWorkspace("toasts.reconciled", {
          inspected: result.inspected,
          reconciled: result.reconciled,
          deferred: result.deferred,
        }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const retryTransientMutation = trpc.emailMarketing.retryTransientFailures.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.detail.invalidate(),
      ]);
      toast({
        variant: result.refused > 0 ? "info" : "success",
        description: tWorkspace("toasts.retried", {
          retried: result.retried,
          refused: result.refused,
        }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const cancelQueuedMutation = trpc.emailMarketing.cancelQueuedRecipients.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.detail.invalidate(),
      ]);
      toast({
        variant: "success",
        description: tWorkspace("toasts.queueCancelled", { count: result.cancelled }),
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const exportFailedMutation = trpc.emailMarketing.exportFailedRecipients.useMutation({
    onSuccess: (result) => {
      const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const rows = [
        [
          tWorkspace("campaigns.errorExport.email"),
          tWorkspace("campaigns.errorExport.name"),
          tWorkspace("campaigns.errorExport.status"),
          tWorkspace("campaigns.errorExport.category"),
          tWorkspace("campaigns.errorExport.providerStatus"),
          tWorkspace("campaigns.errorExport.providerReason"),
          tWorkspace("campaigns.errorExport.attempts"),
          tWorkspace("campaigns.errorExport.failedAt"),
        ],
        ...result.recipients.map((recipient) => [
          recipient.email,
          recipient.customer.name,
          recipient.status,
          recipient.normalizedErrorCategory,
          recipient.providerStatus,
          recipient.providerReason,
          recipient.attemptCount,
          recipient.failedAt ? formatDateTime(recipient.failedAt, locale) : "",
        ]),
      ];
      const blob = new Blob(
        [`\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}`],
        { type: "text/csv;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = tWorkspace("campaigns.errorExportFilename", {
        id: result.campaignId,
      });
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const autoResumeCampaignMutation = trpc.emailMarketing.resumeCampaign.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.overview.invalidate(),
      ]);
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const { mutate: autoResumeCampaign, isLoading: autoResumeCampaignLoading } =
    autoResumeCampaignMutation;
  const updateAutomationMutation = trpc.emailMarketing.updateAutomation.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.automations.invalidate();
      toast({ variant: "success", description: tWorkspace("toasts.automationUpdated") });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const testAutomationMutation = trpc.emailMarketing.testAutomation.useMutation({
    onSuccess: () =>
      toast({ variant: "success", description: tWorkspace("toasts.automationTestSent") }),
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (
      !sendingCampaignId ||
      sendCampaignMutation.isLoading ||
      resumeCampaignMutation.isLoading ||
      autoResumeCampaignLoading
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      autoResumeCampaign({ campaignId: sendingCampaignId });
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [
    autoResumeCampaign,
    autoResumeCampaignLoading,
    resumeCampaignMutation.isLoading,
    sendCampaignMutation.isLoading,
    sendingCampaignId,
  ]);

  const scrollBlockIntoView = (id: string) => {
    window.setTimeout(() => {
      document
        .querySelector(`[data-email-block-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  };

  const updateBlock = <T extends CampaignBlock>(id: string, patch: Partial<T>) => {
    setBlocks((current) => updateBuilderBlock(current, id, patch as Partial<CampaignBlock>));
  };

  const showBuilderUnavailable = () => {
    toast({ variant: "info", description: builderUnavailableMessage });
  };

  const addBlock = (type: CampaignBlock["type"], index?: number) => {
    const block = newBlock(tWorkspace, type);
    if (block.type === "hero" && bannerImageUrl.trim()) {
      block.imageUrl = bannerImageUrl.trim();
    }
    setBlocks((current) => insertBuilderBlock(current, block, index));
    setSelectedBlockId(block.id);
    scrollBlockIntoView(block.id);
  };

  const handleBannerImageUrlChange = (value: string) => {
    setBannerImageUrl(value);
    const imageUrl = value.trim();
    if (!imageUrl) return;
    const selectedHero =
      blocks.find((block) => block.id === selectedBlockId && block.type === "hero") ??
      blocks.find((block) => block.type === "hero");
    if (selectedHero) {
      setBlocks((current) =>
        updateBuilderBlock(current, selectedHero.id, { imageUrl } as Partial<CampaignBlock>),
      );
    }
  };

  const applyDefaultBannerToCanvas = (value = bannerImageUrl) => {
    const imageUrl = value.trim();
    setBannerImageUrl(imageUrl);
    if (!imageUrl) return;
    const selectedHero =
      blocks.find((block) => block.id === selectedBlockId && block.type === "hero") ??
      blocks.find((block) => block.type === "hero");
    if (selectedHero) {
      setBlocks((current) =>
        updateBuilderBlock(current, selectedHero.id, { imageUrl } as Partial<CampaignBlock>),
      );
      setSelectedBlockId(selectedHero.id);
      scrollBlockIntoView(selectedHero.id);
      return;
    }
    const heroBlock = {
      ...newBlock(tWorkspace, "hero"),
      imageUrl,
      heading: tWorkspace("defaults.storeNews"),
    } as CampaignBlock;
    const headerIndex = blocks.findIndex((block) => block.type === "header");
    setBlocks((current) =>
      insertBuilderBlock(current, heroBlock, headerIndex >= 0 ? headerIndex + 1 : 0),
    );
    setSelectedBlockId(heroBlock.id);
    scrollBlockIntoView(heroBlock.id);
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    setBlocks((current) => moveBuilderBlock(current, id, direction));
    setSelectedBlockId(id);
    scrollBlockIntoView(id);
  };

  const duplicateBlock = (id: string) => {
    const result = duplicateBuilderBlock(blocks, id, (block) => `${block.type}-${uid()}`);
    setBlocks(result.blocks);
    if (result.duplicated) {
      setSelectedBlockId(result.duplicated.id);
      scrollBlockIntoView(result.duplicated.id);
    }
  };

  const deleteBlock = async (id: string) => {
    const block = blocks.find((item) => item.id === id);
    if (!block) return;
    if (
      blockNeedsDeleteConfirmation(block) &&
      !(await confirm({
        title: tWorkspace("confirm.deleteBlockTitle"),
        description: tWorkspace("confirm.deleteBlockDescription"),
        confirmLabel: tWorkspace("actions.delete"),
        confirmVariant: "danger",
      }))
    ) {
      return;
    }
    const index = blocks.findIndex((item) => item.id === id);
    const next = deleteBuilderBlock(blocks, id);
    const fallback = next[Math.min(index, next.length - 1)] ?? next[index - 1] ?? null;
    setBlocks(next);
    setSelectedBlockId(fallback?.id ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((current) => reorderBuilderBlocks(current, String(active.id), String(over.id)));
    setSelectedBlockId(String(active.id));
  };

  const openNewCampaign = () => {
    if (!builderDesktopReady) {
      showBuilderUnavailable();
      return;
    }
    const storeName = overviewQuery.data?.store?.name ?? selectedStore?.name ?? "";
    const initialBlocks = defaultBlocks(tWorkspace, storeName);
    setBuilderMode("campaign");
    setCampaignId(null);
    setAutomationId(null);
    setCampaignName(
      storeName
        ? tWorkspace("defaults.campaignName", { store: storeName })
        : tWorkspace("defaults.newCampaign"),
    );
    setSubject("");
    setPreheader("");
    setReplyToEmail("");
    setLogoStoreId("");
    setBannerImageUrl("");
    setBlocks(initialBlocks);
    setSelectedBlockId(initialBlocks[0]?.id ?? null);
    setAudienceMode("segment");
    setAudienceSegment("all");
    setSelectedCustomerIds([]);
    setSenderIdentityId(
      primarySenderId ?? senderOptions.find((sender) => sender.status === "VERIFIED")?.id ?? null,
    );
    setBuilderOpen(true);
  };

  const openCampaign = (campaign: CampaignDashboardItem) => {
    if (!builderDesktopReady) {
      showBuilderUnavailable();
      return;
    }
    const parsedBlocks = parseBlocks(tWorkspace, campaign.blocksJson, campaign.body);
    setBuilderMode("campaign");
    setCampaignId(campaign.id);
    setAutomationId(null);
    setCampaignName(campaign.name);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader ?? "");
    setSenderIdentityId(campaign.senderIdentityId ?? null);
    setReplyToEmail(campaign.replyToEmail ?? "");
    setBrandColor(
      campaign.brandColor && colorPattern.test(campaign.brandColor)
        ? campaign.brandColor
        : defaultBrandColor,
    );
    setButtonColor(
      campaign.buttonColor && colorPattern.test(campaign.buttonColor)
        ? campaign.buttonColor
        : defaultBrandColor,
    );
    setButtonTextColor(
      campaign.buttonTextColor && colorPattern.test(campaign.buttonTextColor)
        ? campaign.buttonTextColor
        : defaultButtonTextColor,
    );
    setBackgroundColor(
      campaign.backgroundColor && colorPattern.test(campaign.backgroundColor)
        ? campaign.backgroundColor
        : defaultEmailBackgroundColor,
    );
    setContentBackgroundColor(
      campaign.contentBackgroundColor && colorPattern.test(campaign.contentBackgroundColor)
        ? campaign.contentBackgroundColor
        : defaultEmailContentBackgroundColor,
    );
    setTextColor(
      campaign.textColor && colorPattern.test(campaign.textColor)
        ? campaign.textColor
        : defaultEmailTextColor,
    );
    setMutedTextColor(
      campaign.mutedTextColor && colorPattern.test(campaign.mutedTextColor)
        ? campaign.mutedTextColor
        : defaultEmailMutedTextColor,
    );
    setBorderColor(
      campaign.borderColor && colorPattern.test(campaign.borderColor)
        ? campaign.borderColor
        : defaultEmailBorderColor,
    );
    setFontFamily(campaign.fontFamily);
    setLogoStoreId("");
    setBannerImageUrl(
      campaign.bannerImageUrl ??
        (
          parsedBlocks.find((block) => block.type === "hero") as
            | Extract<CampaignBlock, { type: "hero" }>
            | undefined
        )?.imageUrl ??
        "",
    );
    setBlocks(parsedBlocks);
    setSelectedBlockId(parsedBlocks[0]?.id ?? null);
    setBuilderOpen(true);
  };

  const openAutomation = (automation: AutomationDashboardItem) => {
    if (!builderDesktopReady) {
      showBuilderUnavailable();
      return;
    }
    const parsedBlocks = parseBlocks(tWorkspace, automation.blocksJson, null);
    const initialBlocks = parsedBlocks.length
      ? parsedBlocks
      : defaultAutomationBlocks(tWorkspace, automation.trigger);
    setBuilderMode("automation");
    setAutomationId(automation.id);
    setCampaignId(null);
    setCampaignName(automation.name);
    setSubject(automation.subject);
    setPreheader(automation.preheader ?? "");
    setSenderIdentityId(automation.senderIdentityId ?? null);
    setReplyToEmail("");
    setBrandColor(
      automation.brandColor && colorPattern.test(automation.brandColor)
        ? automation.brandColor
        : overviewQuery.data?.store?.brandColor &&
            colorPattern.test(overviewQuery.data.store.brandColor)
          ? overviewQuery.data.store.brandColor
          : defaultBrandColor,
    );
    setButtonColor(
      automation.buttonColor && colorPattern.test(automation.buttonColor)
        ? automation.buttonColor
        : automation.brandColor && colorPattern.test(automation.brandColor)
          ? automation.brandColor
          : overviewQuery.data?.store?.brandColor &&
              colorPattern.test(overviewQuery.data.store.brandColor)
            ? overviewQuery.data.store.brandColor
            : defaultBrandColor,
    );
    setButtonTextColor(
      automation.buttonTextColor && colorPattern.test(automation.buttonTextColor)
        ? automation.buttonTextColor
        : defaultButtonTextColor,
    );
    setBackgroundColor(
      automation.backgroundColor && colorPattern.test(automation.backgroundColor)
        ? automation.backgroundColor
        : defaultEmailBackgroundColor,
    );
    setContentBackgroundColor(
      automation.contentBackgroundColor && colorPattern.test(automation.contentBackgroundColor)
        ? automation.contentBackgroundColor
        : defaultEmailContentBackgroundColor,
    );
    setTextColor(
      automation.textColor && colorPattern.test(automation.textColor)
        ? automation.textColor
        : defaultEmailTextColor,
    );
    setMutedTextColor(
      automation.mutedTextColor && colorPattern.test(automation.mutedTextColor)
        ? automation.mutedTextColor
        : defaultEmailMutedTextColor,
    );
    setBorderColor(
      automation.borderColor && colorPattern.test(automation.borderColor)
        ? automation.borderColor
        : defaultEmailBorderColor,
    );
    setFontFamily(automation.fontFamily ?? EmailCampaignFontFamily.INTER);
    setLogoStoreId(automation.logoStoreId ?? "");
    setBannerImageUrl("");
    setBlocks(initialBlocks);
    setSelectedBlockId(initialBlocks[0]?.id ?? null);
    setBuilderOpen(true);
  };

  const saveCurrent = async () => {
    if (builderMode === "automation" && automationId) {
      await updateAutomationMutation.mutateAsync({
        automationId,
        senderIdentityId: effectiveSenderIdentityId,
        subject,
        preheader,
        brandColor,
        buttonColor,
        buttonTextColor,
        backgroundColor,
        contentBackgroundColor,
        textColor,
        mutedTextColor,
        borderColor,
        fontFamily,
        logoStoreId: logoStoreId || storeId || null,
        blocks,
      });
      return null;
    }
    const saved = await saveDraftMutation.mutateAsync(campaignInput);
    setCampaignId(saved.id);
    return saved.id;
  };

  const sendCurrentCampaign = async () => {
    const id = campaignId ?? (await saveCurrent());
    if (!id) return;
    const operation =
      sendOperationRef.current?.campaignId === id
        ? sendOperationRef.current
        : { campaignId: id, idempotencyKey: crypto.randomUUID() };
    sendOperationRef.current = operation;
    sendCampaignMutation.mutate(operation);
  };

  const selectedCustomers = customersQuery.data?.items ?? [];
  const audienceSummary = previewMutation.data?.audienceSummary ??
    overviewQuery.data?.audienceSummary ?? {
      totalSelected: 0,
      validRecipients: 0,
      excludedNoEmail: 0,
      excludedUnsubscribed: 0,
      duplicatesRemoved: 0,
    };
  const validationLabels: Record<string, string> = {
    sender: tWorkspace("validation.senderReady"),
    subject: tWorkspace("validation.subjectReady"),
    audience: tWorkspace("validation.audienceReady"),
    content: tWorkspace("validation.contentReady"),
    products: tWorkspace("validation.productsReady"),
    links: tWorkspace("validation.linksReady"),
  };
  const validation = (
    previewMutation.data?.validationChecklist ?? [
      {
        key: "sender",
        label: tWorkspace("validation.senderReady"),
        ok: Boolean(currentSenderReady),
        critical: true,
      },
      {
        key: "subject",
        label: tWorkspace("validation.subjectReady"),
        ok: Boolean(subject.trim()),
        critical: true,
      },
      {
        key: "content",
        label: tWorkspace("validation.contentReady"),
        ok: blocks.some(blockHasContent),
        critical: true,
      },
    ]
  ).map((item) => ({
    ...item,
    label: validationLabels[item.key] ?? item.label,
  }));
  const canSend = validation.every((item) => !item.critical || item.ok);

  const handleLogoUpload = async (file: File | null) => {
    if (!file || !storeId) return;
    setUploadingLogo(true);
    try {
      const payload = new FormData();
      payload.set("file", file);
      payload.set("storeId", logoStoreId || storeId);
      const response = await fetch("/api/email-marketing/logo", { method: "POST", body: payload });
      if (!response.ok) throw new Error("logoUploadFailed");
      const result = (await response.json().catch(() => null)) as {
        logo?: { storeId?: string | null };
      } | null;
      const nextLogoStoreId = result?.logo?.storeId || logoStoreId || storeId;
      setLogoStoreId(nextLogoStoreId);
      await logoGalleryQuery.refetch();
      previewMutation.mutate({ ...campaignInput, logoStoreId: nextLogoStoreId });
      toast({ variant: "success", description: tWorkspace("toasts.logoUpdated") });
    } catch {
      toast({ variant: "error", description: tWorkspace("toasts.logoUploadFailed") });
    } finally {
      setUploadingLogo(false);
    }
  };

  if (builderOpen) {
    return (
      <div
        className="fixed inset-0 z-40 flex flex-col bg-background"
        data-email-marketing-workspace="builder"
      >
        <h1 className="sr-only">{tWorkspace("builder.heading")}</h1>
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setBuilderOpen(false)}>
            <BackIcon className="h-4 w-4" aria-hidden />
            {tWorkspace("actions.back")}
          </Button>
          <Input
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            className="h-9 max-w-[360px] border-transparent bg-transparent px-2 text-base font-semibold shadow-none focus-visible:border-border"
            aria-label={tWorkspace("builder.name")}
          />
          <Badge
            variant={
              saveDraftMutation.isLoading || updateAutomationMutation.isLoading
                ? "warning"
                : "muted"
            }
          >
            {saveDraftMutation.isLoading || updateAutomationMutation.isLoading
              ? tWorkspace("builder.saving")
              : campaignId || automationId
                ? tWorkspace("builder.saved")
                : tWorkspace("builder.newDraft")}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant={previewMode === "desktop" ? "primary" : "outline"}
              onClick={() => setPreviewMode("desktop")}
              aria-label={tWorkspace("preview.desktop")}
            >
              <DesktopPreviewIcon className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={previewMode === "mobile" ? "primary" : "outline"}
              onClick={() => setPreviewMode("mobile")}
              aria-label={tWorkspace("preview.mobile")}
            >
              <MobilePreviewIcon className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" variant="secondary" onClick={() => void saveCurrent()}>
              {tWorkspace("actions.save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                previewMutation.reset();
                previewMutation.mutate(campaignInput);
                setPreviewOpen(true);
              }}
            >
              {tWorkspace("actions.preview")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setTestOpen(true)}>
              {tWorkspace("actions.sendTest")}
            </Button>
            <Button
              type="button"
              disabled={builderMode !== "campaign" || !canSend || sendCampaignMutation.isLoading}
              onClick={() => setConfirmOpen(true)}
            >
              {tWorkspace("actions.send")}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tWorkspace("builder.blocks")}
            </p>
            <div className="mt-3 space-y-2">
              {(builderMode === "automation" ? automationBlockTypeOptions : blockTypeOptions).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    className="bazaar-admin-choice-card w-full"
                    onClick={() => addBlock(type)}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <AddIcon className="h-4 w-4" aria-hidden />
                      {blockLabel(tWorkspace, type)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {blockDescription(tWorkspace, type)}
                    </span>
                  </button>
                ),
              )}
            </div>
            <div className="bazaar-admin-notice mt-5 text-xs leading-5">
              {tWorkspace("builder.variables")}: {tWorkspace("builder.variableList")}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto bg-muted/30 p-6">
            <div className="mx-auto flex max-w-[860px] flex-col gap-4">
              <div className="bazaar-admin-info-tile p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Field label={tWorkspace("builder.subject")}>
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
                  </Field>
                  <Field label={tWorkspace("builder.sender")}>
                    <Select
                      value={effectiveSenderIdentityId ?? "__none__"}
                      onValueChange={(value) =>
                        setSenderIdentityId(value === "__none__" ? null : value)
                      }
                    >
                      <SelectTrigger aria-label={tWorkspace("builder.sender")}>
                        <SelectValue placeholder={tWorkspace("actions.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {defaultSender ? (
                          <SelectItem value="__none__">
                            {tWorkspace("senders.bazaarKg")}
                            {defaultSender.fromEmail ? ` · ${defaultSender.fromEmail}` : ""}
                          </SelectItem>
                        ) : null}
                        {senderOptions.map((sender) => (
                          <SelectItem
                            key={sender.id}
                            value={sender.id}
                            disabled={sender.status !== "VERIFIED"}
                          >
                            {sender.displayName} · {sender.fromEmail}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <div
                className={cn(
                  "mx-auto w-full rounded-md border border-border bg-white shadow-sm transition-all",
                  previewMode === "mobile" ? "max-w-[390px]" : "max-w-[680px]",
                )}
                style={{ backgroundColor: contentBackgroundColor, color: textColor }}
              >
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={blocks.map((block) => block.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1 p-3">
                      {blocks.map((block, index) => (
                        <div key={block.id}>
                          <div className="flex justify-center py-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-8 border-dashed text-xs text-muted-foreground shadow-none hover:text-foreground"
                              onClick={() => addBlock("text", index)}
                            >
                              <AddIcon className="h-3.5 w-3.5" aria-hidden />
                              {tWorkspace("builder.addText")}
                            </Button>
                          </div>
                          <SortableBlock
                            block={block}
                            selected={selectedBlockId === block.id}
                            index={index}
                            canMoveUp={index > 0}
                            canMoveDown={index < blocks.length - 1}
                            onSelect={() => setSelectedBlockId(block.id)}
                            onMoveUp={() => moveBlock(block.id, -1)}
                            onMoveDown={() => moveBlock(block.id, 1)}
                            onDuplicate={() => duplicateBlock(block.id)}
                            onDelete={() => void deleteBlock(block.id)}
                          >
                            <EmailBlockPreview
                              block={block}
                              selected={selectedBlockId === block.id}
                              brandColor={brandColor}
                              buttonColor={buttonColor}
                              buttonTextColor={buttonTextColor}
                              mutedTextColor={mutedTextColor}
                              borderColor={borderColor}
                              products={selectedProductMap}
                              storeName={selectedStore?.name}
                              logoUrl={selectedLogoUrl}
                              onLogoUploadClick={() => logoInputRef.current?.click()}
                              onUpdate={(patch) => updateBlock(block.id, patch)}
                            />
                          </SortableBlock>
                        </div>
                      ))}
                      {blocks.length ? (
                        <div className="flex justify-center py-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 border-dashed text-xs text-muted-foreground shadow-none hover:text-foreground"
                            onClick={() => addBlock("text")}
                          >
                            <AddIcon className="h-3.5 w-3.5" aria-hidden />
                            {tWorkspace("builder.addText")}
                          </Button>
                        </div>
                      ) : null}
                      {!blocks.length ? (
                        <div className="bazaar-admin-empty min-h-[10rem]">
                          {tWorkspace("builder.emptyBlocks")}
                        </div>
                      ) : null}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-border bg-card">
            <div className="space-y-5 p-4">
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">{tWorkspace("validation.title")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {tWorkspace("validation.description")}
                  </p>
                </div>
                <div className="space-y-2">
                  {validation.map((item) => (
                    <div
                      key={item.key}
                      className="bazaar-admin-info-tile flex items-start gap-2 p-2 text-sm"
                    >
                      {item.ok ? (
                        <StatusSuccessIcon className="mt-0.5 h-4 w-4 text-success" aria-hidden />
                      ) : item.critical ? (
                        <StatusDangerIcon className="mt-0.5 h-4 w-4 text-danger" aria-hidden />
                      ) : (
                        <StatusPendingIcon className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
                      )}
                      <span className="leading-5">{item.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              {builderMode === "campaign" ? (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">{tWorkspace("audience.title")}</h2>
                  <Field label={tWorkspace("audience.mode")}>
                    <Select
                      value={audienceMode}
                      onValueChange={(value) => setAudienceMode(value as AudienceMode)}
                    >
                      <SelectTrigger aria-label={tWorkspace("audience.mode")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="segment">{tWorkspace("audience.segment")}</SelectItem>
                        <SelectItem value="manual">{tWorkspace("audience.manual")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {audienceMode === "segment" ? (
                    <Field label={tWorkspace("audience.segment")}>
                      <Select
                        value={audienceSegment}
                        onValueChange={(value) => setAudienceSegment(value as AudienceSegment)}
                      >
                        <SelectTrigger aria-label={tWorkspace("audience.segment")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{tWorkspace("audience.allWithEmail")}</SelectItem>
                          <SelectItem value="new">{tWorkspace("audience.newCustomers")}</SelectItem>
                          <SelectItem value="withPurchases">
                            {tWorkspace("audience.withPurchases")}
                          </SelectItem>
                          <SelectItem value="withoutPurchases">
                            {tWorkspace("audience.withoutPurchases")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <ManualAudiencePicker
                      customers={selectedCustomers}
                      queryLoading={customersQuery.isLoading}
                      search={customerSearch}
                      setSearch={setCustomerSearch}
                      selectedIds={selectedCustomerIds}
                      setSelectedIds={setSelectedCustomerIds}
                      page={customerPage}
                      setPage={setCustomerPage}
                      total={customersQuery.data?.total ?? 0}
                    />
                  )}
                  <Field label={tWorkspace("audience.source")}>
                    <Select
                      value={source}
                      onValueChange={(value) => setSource(value as "ALL" | CustomerSource)}
                    >
                      <SelectTrigger aria-label={tWorkspace("audience.source")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{tWorkspace("audience.allSources")}</SelectItem>
                        {sourceValues.map((value) => (
                          <SelectItem key={value} value={value}>
                            {sourceLabel(tWorkspace, value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric
                      label={tWorkspace("audience.recipients")}
                      value={audienceSummary.validRecipients}
                    />
                    <Metric
                      label={tWorkspace("audience.withoutEmail")}
                      value={audienceSummary.excludedNoEmail}
                    />
                    <Metric
                      label={tWorkspace("audience.unsubscribed")}
                      value={audienceSummary.excludedUnsubscribed}
                    />
                    <Metric
                      label={tWorkspace("audience.duplicates")}
                      value={audienceSummary.duplicatesRemoved}
                    />
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <h2 className="text-sm font-semibold">
                  {selectedBlock
                    ? blockLabel(tWorkspace, selectedBlock.type)
                    : tWorkspace("builder.settings")}
                </h2>
                {selectedBlock ? (
                  <BlockSettings
                    block={selectedBlock}
                    products={productItems}
                    productSearch={productSearch}
                    setProductSearch={setProductSearch}
                    productsLoading={productsQuery.isLoading}
                    update={(patch) => updateBlock(selectedBlock.id, patch)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {tWorkspace("builder.selectBlock")}
                  </p>
                )}
                {selectedBlock ? (
                  <div className="grid grid-cols-4 gap-2 border-t border-border pt-3">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      disabled={selectedBlockIndex <= 0}
                      onClick={() => moveBlock(selectedBlock.id, -1)}
                      aria-label={tWorkspace("actions.moveUp")}
                    >
                      <ArrowUpIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      disabled={selectedBlockIndex >= blocks.length - 1}
                      onClick={() => moveBlock(selectedBlock.id, 1)}
                      aria-label={tWorkspace("actions.moveDown")}
                    >
                      <ArrowDownIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      onClick={() => duplicateBlock(selectedBlock.id)}
                      aria-label={tWorkspace("actions.duplicate")}
                    >
                      <CopyIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="danger"
                      onClick={() => void deleteBlock(selectedBlock.id)}
                      aria-label={tWorkspace("actions.delete")}
                    >
                      <DeleteIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="space-y-3 border-t border-border pt-4">
                <h2 className="text-sm font-semibold">{tWorkspace("design.title")}</h2>
                <div className="grid grid-cols-2 gap-2">
                  <ColorField
                    label={tWorkspace("design.brand")}
                    value={brandColor}
                    onChange={setBrandColor}
                  />
                  <ColorField
                    label={tWorkspace("design.button")}
                    value={buttonColor}
                    onChange={setButtonColor}
                  />
                </div>
                <Field label={tWorkspace("design.preheader")}>
                  <Input value={preheader} onChange={(event) => setPreheader(event.target.value)} />
                </Field>
                <Field label={tWorkspace("senders.replyTo")}>
                  <Input
                    value={replyToEmail}
                    onChange={(event) => setReplyToEmail(event.target.value)}
                  />
                </Field>
                <Field label={tWorkspace("design.logoStore")}>
                  <Select
                    value={logoStoreId || storeId || "__none__"}
                    onValueChange={(value) => setLogoStoreId(value === "__none__" ? "" : value)}
                  >
                    <SelectTrigger aria-label={tWorkspace("design.logoStore")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{tWorkspace("design.currentStore")}</SelectItem>
                      {(logoGalleryQuery.data ?? []).map((logo) => (
                        <SelectItem key={logo.storeId} value={logo.storeId}>
                          {logo.storeName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={tWorkspace("design.defaultBanner")}
                  hint={tWorkspace("design.defaultBannerHint")}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input
                      value={bannerImageUrl}
                      onChange={(event) => handleBannerImageUrlChange(event.target.value)}
                      onBlur={(event) => applyDefaultBannerToCanvas(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyDefaultBannerToCanvas(event.currentTarget.value);
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder={tWorkspace("design.bannerPlaceholder")}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => applyDefaultBannerToCanvas()}
                    >
                      {tWorkspace("actions.apply")}
                    </Button>
                  </div>
                  {!bannerUrlLooksDirect && bannerImageUrl.trim() ? (
                    <p className="text-xs leading-5 text-warning">
                      {tWorkspace("design.directImageWarning")}
                    </p>
                  ) : null}
                </Field>
                <Field label={tWorkspace("design.logo")} hint={tWorkspace("design.logoHint")}>
                  <div className="space-y-2">
                    <div className="bazaar-admin-info-tile flex items-center gap-3 p-2">
                      <PreviewImageFrame
                        src={selectedLogoUrl}
                        alt={selectedStore?.name ?? tWorkspace("design.logo")}
                        frameClassName="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                        imageClassName="max-h-full max-w-full object-contain"
                        fallback={
                          <span className="text-xs text-muted-foreground">
                            {tWorkspace("design.noLogo")}
                          </span>
                        }
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {selectedLogo?.storeName ??
                            selectedStore?.name ??
                            tWorkspace("design.currentStore")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {selectedLogoUrl
                            ? tWorkspace("design.logoSelected")
                            : tWorkspace("design.logoPrompt")}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <ImagePlusIcon className="h-4 w-4" aria-hidden />
                      {uploadingLogo
                        ? tWorkspace("actions.uploading")
                        : selectedLogoUrl
                          ? tWorkspace("actions.replaceLogo")
                          : tWorkspace("actions.uploadLogo")}
                    </Button>
                  </div>
                </Field>
              </section>
            </div>
          </aside>
        </div>

        <Modal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={tWorkspace("preview.title")}
          className="max-w-4xl"
        >
          <div
            ref={previewContentRef}
            className="bazaar-admin-preview-frame max-h-[70vh] overflow-auto bg-white p-0"
          >
            {previewHtml ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="p-8 text-sm text-muted-foreground">{tWorkspace("preview.empty")}</div>
            )}
          </div>
        </Modal>

        <Modal
          open={testOpen}
          onOpenChange={setTestOpen}
          title={tWorkspace("test.title")}
          className="max-w-lg"
        >
          <div className="space-y-4">
            <Field label={tWorkspace("test.email")}>
              <Input
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                placeholder={tWorkspace("test.emailPlaceholder")}
              />
            </Field>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setTestOpen(false)}>
                {tWorkspace("actions.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!testEmail || testMutation.isLoading || testAutomationMutation.isLoading}
                onClick={async () => {
                  if (builderMode === "automation" && automationId) {
                    await saveCurrent();
                    testAutomationMutation.mutate({ automationId, to: testEmail });
                    return;
                  }
                  testMutation.mutate({
                    campaign: campaignInput,
                    to: testEmail,
                    sampleCustomerId: selectedCustomerIds[0] ?? null,
                  });
                }}
              >
                {testMutation.isLoading || testAutomationMutation.isLoading
                  ? tCommon("loading")
                  : tWorkspace("actions.send")}
              </Button>
            </ModalFooter>
          </div>
        </Modal>

        <Modal
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open && !sendCampaignMutation.isLoading) {
              sendOperationRef.current = null;
            }
          }}
          title={tWorkspace("confirm.sendTitle")}
          className="max-w-xl"
        >
          <div className="space-y-4">
            <div className="bazaar-admin-info-tile text-sm leading-6">
              <p>
                <strong>{tWorkspace("confirm.campaign")}:</strong> {campaignName}
              </p>
              <p>
                <strong>{tWorkspace("confirm.subject")}:</strong> {subject}
              </p>
              <p>
                <strong>{tWorkspace("confirm.recipients")}:</strong>{" "}
                {audienceSummary.validRecipients}
              </p>
              <p>
                <strong>{tWorkspace("confirm.sender")}:</strong> {currentSenderLabel}
              </p>
            </div>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {tWorkspace("actions.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!canSend || sendCampaignMutation.isLoading}
                onClick={() => void sendCurrentCampaign()}
              >
                {sendCampaignMutation.isLoading ? tCommon("loading") : tWorkspace("confirm.send")}
              </Button>
            </ModalFooter>
          </div>
        </Modal>
        <LogoFileInput inputRef={logoInputRef} onFile={(file) => void handleLogoUpload(file)} />
        {uploadingLogo ? (
          <span className="sr-only">{tWorkspace("actions.uploadingLogo")}</span>
        ) : null}
        {confirmDialog}
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-[1400px] space-y-6 pb-12"
      data-email-marketing-workspace="overview"
    >
      <PageHeader title={tWorkspace("title")} subtitle={tWorkspace("subtitle")} />

      {!builderDesktopReady ? (
        <Card className="bazaar-admin-status-tile-warning">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <StatusPendingIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">{tWorkspace("builder.unavailableTitle")}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {builderUnavailableMessage}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="bazaar-admin-surface">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {selectedStore?.name ?? tWorkspace("overview.selectStore")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tWorkspace("overview.reachable", {
                    count: overviewQuery.data?.reachableCustomers ?? 0,
                  })}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[220px_auto_auto_auto]">
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger aria-label={tWorkspace("overview.store")}>
                    <SelectValue placeholder={tWorkspace("overview.store")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={openNewCampaign}
                  disabled={!builderDesktopReady}
                  title={!builderDesktopReady ? builderUnavailableMessage : undefined}
                >
                  <AddIcon className="h-4 w-4" aria-hidden />
                  {tWorkspace("actions.createCampaign")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setActiveTab("automations")}
                >
                  {tWorkspace("overview.automation")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setActiveTab("senders")}>
                  {tWorkspace("overview.sender")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bazaar-admin-surface">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {sendersQuery.data?.senders.some((sender) => sender.status === "VERIFIED") ? (
                <StatusSuccessIcon className="mt-0.5 h-5 w-5 text-success" aria-hidden />
              ) : (
                <StatusPendingIcon className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
              )}
              <div>
                <p className="font-semibold">{tWorkspace("overview.senders")}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {sendersQuery.data?.senders.some((sender) => sender.status === "VERIFIED")
                    ? tWorkspace("overview.verifiedDomain")
                    : tWorkspace("overview.addDomain")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Tabs>
        <TabsList className="flex max-w-full overflow-x-auto">
          {(["campaigns", "automations", "senders", "templates"] as const).map((key) => (
            <TabsTrigger
              key={key}
              active={activeTab === key}
              onClick={() => setActiveTab(key as TabKey)}
            >
              {tWorkspace(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {activeTab === "campaigns" ? (
          <TabsPanel>
            <CampaignsDashboard
              campaigns={historyQuery.data ?? []}
              loading={historyQuery.isLoading}
              locale={locale}
              builderAvailable={builderDesktopReady}
              onCreate={openNewCampaign}
              onEdit={openCampaign}
              onDuplicate={(campaignId) => duplicateMutation.mutate({ campaignId })}
              onArchive={(campaignId) => archiveMutation.mutate({ campaignId })}
              onDelete={(campaignId) => deleteDraftMutation.mutate({ campaignId })}
              onResume={(campaignId) => resumeCampaignMutation.mutate({ campaignId })}
              onDetails={(campaignId) => {
                setRecipientStatusFilter("ALL");
                setRecipientDetailPage(1);
                setCampaignDetailId(campaignId);
              }}
              onReconcile={(campaignId) =>
                reconcileCampaignMutation.mutate({ campaignId, limit: 250 })
              }
              onRetryTransient={(campaignId) => retryTransientMutation.mutate({ campaignId })}
              onCancelQueued={(campaignId) => cancelQueuedMutation.mutate({ campaignId })}
              onExportFailed={(campaignId) => exportFailedMutation.mutate({ campaignId })}
              resumingCampaignId={resumeCampaignMutation.variables?.campaignId ?? null}
              actionCampaignId={
                reconcileCampaignMutation.variables?.campaignId ??
                retryTransientMutation.variables?.campaignId ??
                cancelQueuedMutation.variables?.campaignId ??
                exportFailedMutation.variables?.campaignId ??
                null
              }
            />
          </TabsPanel>
        ) : null}

        {activeTab === "senders" ? (
          <TabsPanel>
            <SendersPanel
              data={sendersQuery.data}
              loading={sendersQuery.isLoading}
              form={senderForm}
              setForm={setSenderForm}
              onCreate={() => createSenderMutation.mutate({ storeId, ...senderForm })}
              creating={createSenderMutation.isLoading}
              onCheck={(domainId, triggerVerification) =>
                checkDomainMutation.mutate({ domainId, triggerVerification })
              }
              checking={checkDomainMutation.isLoading}
              onArchive={(senderId) => archiveSenderMutation.mutate({ senderId })}
            />
          </TabsPanel>
        ) : null}

        {activeTab === "automations" ? (
          <TabsPanel>
            <AutomationsPanel
              automations={automationsQuery.data ?? []}
              loading={automationsQuery.isLoading}
              senders={sendersQuery.data?.senders ?? []}
              primarySenderId={sendersQuery.data?.primarySenderId ?? null}
              builderAvailable={builderDesktopReady}
              onEdit={openAutomation}
              onToggle={(automation) =>
                updateAutomationMutation.mutate({
                  automationId: automation.id,
                  status:
                    automation.status === EmailAutomationStatus.ACTIVE
                      ? EmailAutomationStatus.PAUSED
                      : EmailAutomationStatus.ACTIVE,
                })
              }
              onSender={(automationId, value) =>
                updateAutomationMutation.mutate({
                  automationId,
                  senderIdentityId: value === "__none__" ? null : value,
                })
              }
              testEmail={testEmail}
              setTestEmail={setTestEmail}
              onTest={(automationId) =>
                testAutomationMutation.mutate({ automationId, to: testEmail })
              }
            />
          </TabsPanel>
        ) : null}

        {activeTab === "templates" ? (
          <TabsPanel>
            <Card className="bazaar-admin-surface">
              <CardContent className="p-8 text-sm text-muted-foreground">
                {tWorkspace("templates.description")}
              </CardContent>
            </Card>
          </TabsPanel>
        ) : null}
      </Tabs>

      <Modal
        open={Boolean(campaignDetailId)}
        onOpenChange={(open) => {
          if (!open) {
            setCampaignDetailId(null);
            setRecipientDetailPage(1);
            setRecipientStatusFilter("ALL");
          }
        }}
        title={tWorkspace("recipients.title")}
        className="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field
              label={tWorkspace("recipients.filter")}
              hint={tWorkspace("recipients.filterHint")}
            >
              <Select
                value={recipientStatusFilter}
                onValueChange={(value) => {
                  setRecipientStatusFilter(value as "ALL" | EmailCampaignRecipientStatus);
                  setRecipientDetailPage(1);
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-64"
                  aria-label={tWorkspace("recipients.filter")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tWorkspace("recipients.allStatuses")}</SelectItem>
                  {recipientLifecycleStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {recipientStatusLabel(tWorkspace, status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {campaignDetailId ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => exportFailedMutation.mutate({ campaignId: campaignDetailId })}
                disabled={exportFailedMutation.isLoading}
              >
                {tWorkspace("actions.exportErrors")}
              </Button>
            ) : null}
          </div>
          {campaignDetailQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tWorkspace("recipients.recipient")}</TableHead>
                    <TableHead>{tWorkspace("recipients.status")}</TableHead>
                    <TableHead>{tWorkspace("recipients.reason")}</TableHead>
                    <TableHead>{tWorkspace("recipients.attempts")}</TableHead>
                    <TableHead>{tWorkspace("recipients.lastEvent")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(campaignDetailQuery.data?.campaign.recipients ?? []).map((recipient) => (
                    <TableRow key={recipient.id}>
                      <TableCell>
                        <p className="font-medium">{recipient.customer.name}</p>
                        <p className="text-xs text-muted-foreground">{recipient.email}</p>
                      </TableCell>
                      <TableCell>{recipientStatusLabel(tWorkspace, recipient.status)}</TableCell>
                      <TableCell className="max-w-md">
                        <p className="break-words text-sm">
                          {recipient.providerReason ?? recipient.errorMessage ?? "—"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {recipient.normalizedErrorCategory}
                          {recipient.providerStatus ? ` · ${recipient.providerStatus}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>{recipient.attemptCount}</TableCell>
                      <TableCell>
                        {recipient.lastProviderEventAt
                          ? formatDateTime(recipient.lastProviderEventAt, locale)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!campaignDetailQuery.data?.campaign.recipients.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {tWorkspace("recipients.empty")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {tWorkspace("recipients.shown", {
                shown: (campaignDetailQuery.data?.campaign.recipients ?? []).length,
                total: campaignDetailQuery.data?.recipientPage.total ?? 0,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={recipientDetailPage <= 1}
                onClick={() => setRecipientDetailPage((page) => Math.max(1, page - 1))}
              >
                {tWorkspace("actions.back")}
              </Button>
              <span>
                {campaignDetailQuery.data?.recipientPage.page ?? recipientDetailPage} /{" "}
                {campaignDetailQuery.data?.recipientPage.pageCount ?? 1}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  recipientDetailPage >= (campaignDetailQuery.data?.recipientPage.pageCount ?? 1)
                }
                onClick={() => setRecipientDetailPage((page) => page + 1)}
              >
                {tWorkspace("actions.next")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {tWorkspace("recipients.safeProviderResponse")}
          </p>
        </div>
      </Modal>

      <LogoFileInput inputRef={logoInputRef} onFile={(file) => void handleLogoUpload(file)} />
      {uploadingLogo ? (
        <span className="sr-only">{tWorkspace("actions.uploadingLogo")}</span>
      ) : null}
      {confirmDialog}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="bazaar-admin-info-tile p-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);

const ColorField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  return (
    <Label className="block space-y-1.5">
      <span className="block">{label}</span>
      <div className="grid grid-cols-[38px_minmax(0,1fr)] gap-2">
        <Input
          aria-label={tWorkspace("design.colorPicker", { label })}
          type="color"
          value={colorPattern.test(value) ? value : defaultBrandColor}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 p-1"
        />
        <Input
          aria-label={tWorkspace("design.colorHex", { label })}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9"
        />
      </div>
    </Label>
  );
};

const PreviewImageFrame = ({
  src,
  alt,
  fallback,
  frameClassName,
  imageClassName,
}: {
  src?: string | null;
  alt: string;
  fallback: ReactNode;
  frameClassName: string;
  imageClassName: string;
}) => {
  const [failed, setFailed] = useState(false);
  const safeSrc = useMemo(() => resolveBuilderPreviewImageSrc(src), [src]);
  const canPreview = useMemo(() => {
    if (!safeSrc) return false;
    if (typeof window === "undefined") return true;
    try {
      const imageUrl = new URL(safeSrc, window.location.href);
      const isLocalHost = imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
      return !(isLocalHost && imageUrl.origin !== window.location.origin);
    } catch {
      return false;
    }
  }, [safeSrc]);
  useEffect(() => setFailed(false), [safeSrc]);

  return (
    <div className={frameClassName}>
      {canPreview && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeSrc ?? undefined}
          alt={alt}
          className={imageClassName}
          onError={() => setFailed(true)}
        />
      ) : (
        fallback
      )}
    </div>
  );
};

const EmailBlockPreview = ({
  block,
  selected,
  brandColor,
  buttonColor,
  buttonTextColor,
  mutedTextColor,
  borderColor,
  products,
  storeName,
  logoUrl,
  onLogoUploadClick,
  onUpdate,
}: {
  block: CampaignBlock;
  selected: boolean;
  brandColor: string;
  buttonColor: string;
  buttonTextColor: string;
  mutedTextColor: string;
  borderColor: string;
  products: Map<
    string,
    {
      name: string;
      description?: string | null;
      imageUrl?: string | null;
      priceText?: string | null;
    }
  >;
  storeName?: string | null;
  logoUrl?: string | null;
  onLogoUploadClick?: () => void;
  onUpdate: (patch: Partial<CampaignBlock>) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const alignment = getBlockAlignment(block);
  const alignedClassName = alignmentClassName(alignment);
  if (block.type === "header") {
    return (
      <div className={cn("px-8 py-6", alignedClassName)}>
        {block.showLogo === false ? null : (
          <button
            type="button"
            className={cn(
              "mb-3 block rounded-md outline-none transition hover:ring-2 hover:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary",
              logoAlignmentClassName(alignment),
            )}
            onClick={(event) => {
              event.stopPropagation();
              onLogoUploadClick?.();
            }}
            aria-label={
              logoUrl ? tWorkspace("actions.replaceLogo") : tWorkspace("actions.uploadLogo")
            }
          >
            <PreviewImageFrame
              src={logoUrl}
              alt={storeName ?? tWorkspace("design.logo")}
              frameClassName="flex h-20 w-36 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted text-xs text-muted-foreground"
              imageClassName="max-h-full max-w-full object-contain"
              fallback={
                <span className="inline-flex items-center gap-2 px-3">
                  <ImagePlusIcon className="h-4 w-4" aria-hidden />
                  {tWorkspace("actions.uploadLogo")}
                </span>
              }
            />
          </button>
        )}
        {block.showStoreName === false ? null : (
          <EditableText
            value={block.storeName ?? storeName}
            placeholder={tWorkspace("blockPreview.storeName")}
            selected={selected}
            className="text-lg font-bold"
            onChange={(storeName) => onUpdate({ storeName })}
          />
        )}
        <EditableText
          value={block.heading}
          placeholder={tWorkspace("blockPreview.headerText")}
          selected={selected}
          className="mt-2 text-sm"
          onChange={(heading) => onUpdate({ heading })}
        />
      </div>
    );
  }
  if (block.type === "hero") {
    return (
      <div className={cn("px-8 py-6", alignedClassName)}>
        <PreviewImageFrame
          src={block.imageUrl}
          alt=""
          frameClassName="mb-5 flex h-44 items-center justify-center overflow-hidden rounded-md bg-muted text-sm text-muted-foreground"
          imageClassName="h-full w-full object-cover"
          fallback={
            <>
              <ImagePlusIcon className="mr-2 h-4 w-4" aria-hidden />
              {tWorkspace("blockPreview.image")}
            </>
          }
        />
        <EditableText
          value={block.heading}
          placeholder={tWorkspace("blockPreview.heroHeading")}
          selected={selected}
          className="text-3xl font-semibold leading-tight"
          onChange={(heading) => onUpdate({ heading })}
        />
        <EditableText
          value={block.subtitle}
          placeholder={tWorkspace("blockPreview.shortDescription")}
          selected={selected}
          multiline
          className="mt-3 text-sm leading-6"
          onChange={(subtitle) => onUpdate({ subtitle })}
        />
        <EditableText
          value={block.buttonText}
          placeholder={tWorkspace("blockPreview.buttonText")}
          selected={selected}
          className="mt-5 inline-flex min-w-24 rounded-md px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
          onChange={(buttonText) => onUpdate({ buttonText })}
        />
      </div>
    );
  }
  if (block.type === "text") {
    return (
      <div className={cn("px-8 py-5", alignedClassName)}>
        <EditableText
          value={block.heading}
          placeholder={tWorkspace("blockPreview.heading")}
          selected={selected}
          className="text-xl font-semibold"
          onChange={(heading) => onUpdate({ heading })}
        />
        <EditableText
          value={block.body}
          placeholder={tWorkspace("blockPreview.emailText")}
          selected={selected}
          multiline
          className={cn(
            "mt-2 whitespace-pre-wrap leading-6",
            textFontSizeClassName(block.bodyFontSize),
            block.bodyBold && "font-semibold",
          )}
          onChange={(body) => onUpdate({ body })}
        />
      </div>
    );
  }
  if (block.type === "button") {
    return (
      <div className={cn("px-8 py-5", alignedClassName)}>
        <EditableText
          value={block.text}
          placeholder={tWorkspace("blockPreview.buttonText")}
          className="inline-flex rounded-md px-4 py-2 text-sm font-semibold"
          selected={selected}
          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
          onChange={(text) => onUpdate({ text })}
        />
      </div>
    );
  }
  if (block.type === "products") {
    const ids = block.productIds ?? [];
    return (
      <div
        className={cn(
          "grid gap-3 px-6 py-5",
          block.layout === "one" ? "grid-cols-1" : "sm:grid-cols-2",
        )}
      >
        {ids.length ? (
          ids.map((id) => {
            const product = products.get(id);
            const buttonHref = productButtonUrlForPreview(block, id);
            return (
              <div
                key={id}
                className={cn("rounded-md border p-3", alignedClassName)}
                style={{ borderColor }}
              >
                {block.showImage === false ? null : (
                  <PreviewImageFrame
                    src={product?.imageUrl}
                    alt={product?.name ?? ""}
                    frameClassName="flex h-32 items-center justify-center overflow-hidden rounded-md bg-muted"
                    imageClassName="h-full w-full object-cover"
                    fallback={
                      <span className="text-xs text-muted-foreground">
                        {tWorkspace("blockPreview.productPhoto")}
                      </span>
                    }
                  />
                )}
                <p className="mt-3 truncate font-semibold">{product?.name ?? id}</p>
                {block.showDescription === false || !product?.description ? null : (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {product.description}
                  </p>
                )}
                {block.showPrice === false ? null : (
                  <p className="text-sm text-muted-foreground">
                    {product?.priceText ?? tWorkspace("blockPreview.noPrice")}
                  </p>
                )}
                {block.showButton === false ? null : buttonHref ? (
                  <a
                    href={buttonHref}
                    onClick={(event) => event.preventDefault()}
                    className="mt-3 inline-flex rounded-md px-3 py-1.5 text-xs font-semibold no-underline hover:no-underline"
                    style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                    data-email-product-button-url={buttonHref}
                  >
                    {block.buttonText || tWorkspace("defaults.learnMore")}
                  </a>
                ) : (
                  <span
                    className="mt-3 inline-flex rounded-md px-3 py-1.5 text-xs font-semibold"
                    style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                  >
                    {block.buttonText || tWorkspace("defaults.learnMore")}
                  </span>
                )}
              </div>
            );
          })
        ) : (
          <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {tWorkspace("blockPreview.selectProducts")}
          </div>
        )}
      </div>
    );
  }
  if (block.type === "orderSummary") {
    const summaryText = block.summaryText ?? tWorkspace("defaults.orderSummaryLine");
    const itemsLabel = block.itemsLabel ?? tWorkspace("defaults.items");
    const totalLabel = block.totalLabel ?? tWorkspace("defaults.total");
    const quantitySeparator = block.quantitySeparator ?? "×";
    const sampleItemName = block.sampleItemName ?? tWorkspace("defaults.product");
    return (
      <div className="px-8 py-5">
        <div className={cn("rounded-md border p-4", alignedClassName)} style={{ borderColor }}>
          <EditableText
            value={block.title}
            placeholder={tWorkspace("defaults.orderSummaryTitle")}
            selected={selected}
            className="font-semibold"
            onChange={(title) => onUpdate({ title })}
          />
          {block.showSummary === false ? null : (
            <EditableText
              value={summaryText}
              placeholder={tWorkspace("defaults.orderSummaryLine")}
              selected={selected}
              className="mt-2 text-sm text-muted-foreground"
              onChange={(nextSummaryText) => onUpdate({ summaryText: nextSummaryText })}
            />
          )}
          {block.showItems === false ? null : (
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <EditableText
                value={itemsLabel}
                placeholder={tWorkspace("defaults.items")}
                selected={selected}
                className="text-xs font-semibold uppercase tracking-wide"
                onChange={(nextItemsLabel) => onUpdate({ itemsLabel: nextItemsLabel })}
              />
              <div className="flex justify-between gap-4">
                <span className="min-w-0">
                  <EditableText
                    value={sampleItemName}
                    placeholder={tWorkspace("defaults.product")}
                    selected={selected}
                    className="inline"
                    onChange={(nextSampleItemName) =>
                      onUpdate({ sampleItemName: nextSampleItemName })
                    }
                  />{" "}
                  <span>{quantitySeparator} 1</span>
                </span>
                <span>{"{{orderTotal}}"}</span>
              </div>
            </div>
          )}
          {block.showTotals === false ? null : (
            <div className="mt-3 flex justify-end gap-2 text-sm font-semibold">
              <EditableText
                value={totalLabel}
                placeholder={tWorkspace("defaults.total")}
                selected={selected}
                className="inline"
                onChange={(nextTotalLabel) => onUpdate({ totalLabel: nextTotalLabel })}
              />
              <span>{"{{orderTotal}}"}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (block.type === "promo") {
    return (
      <div className="px-8 py-5">
        <div
          className={cn("rounded-md border p-5", alignedClassName)}
          style={{ borderColor: brandColor, backgroundColor: "#f9fafb" }}
        >
          <EditableText
            value={block.title}
            placeholder={tWorkspace("blockPreview.promotionName")}
            selected={selected}
            className="text-xl font-semibold"
            onChange={(title) => onUpdate({ title })}
          />
          <EditableText
            value={block.discountCode}
            placeholder={tWorkspace("blockPreview.promoCode")}
            selected={selected}
            className="mt-3 inline-flex border border-dashed px-3 py-2 font-bold"
            onChange={(discountCode) => onUpdate({ discountCode })}
          />
          <EditableText
            value={block.description}
            placeholder={tWorkspace("blockPreview.promotionDescription")}
            selected={selected}
            multiline
            className="mt-3 text-sm leading-6"
            onChange={(description) => onUpdate({ description })}
          />
          <EditableText
            value={block.expiryText}
            placeholder={tWorkspace("blockPreview.expiry")}
            selected={selected}
            className="mt-2 text-xs text-muted-foreground"
            onChange={(expiryText) => onUpdate({ expiryText })}
          />
          <EditableText
            value={block.buttonText}
            placeholder={tWorkspace("blockPreview.buttonText")}
            selected={selected}
            className="mt-4 inline-flex rounded-md px-4 py-2 text-sm font-semibold"
            style={{ backgroundColor: buttonColor, color: buttonTextColor }}
            onChange={(buttonText) => onUpdate({ buttonText })}
          />
        </div>
      </div>
    );
  }
  if (block.type === "divider") {
    return (
      <div className="px-8 py-4">
        <div className="border-t" style={{ borderColor }} />
      </div>
    );
  }
  return (
    <div
      className={cn("border-t px-8 py-5 text-xs leading-5", alignedClassName)}
      style={{ borderColor, color: mutedTextColor }}
    >
      <EditableText
        value={block.storeName}
        placeholder={tWorkspace("blockPreview.storeName")}
        selected={selected}
        className="mb-2 font-semibold"
        onChange={(storeName) => onUpdate({ storeName })}
      />
      <EditableText
        value={block.text}
        placeholder={tWorkspace("blockPreview.footerText")}
        selected={selected}
        multiline
        onChange={(text) => onUpdate({ text })}
      />
      {block.showUnsubscribe === false ? null : (
        <EditableText
          value={block.unsubscribeText}
          placeholder={tWorkspace("blockPreview.unsubscribeText")}
          selected={selected}
          className="mt-2 underline"
          onChange={(unsubscribeText) => onUpdate({ unsubscribeText })}
        />
      )}
    </div>
  );
};

const AlignmentControl = ({
  value,
  onChange,
}: {
  value?: BlockAlignment | null;
  onChange: (value: BlockAlignment) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const current = normalizeBlockAlignment(value);
  return (
    <Field label={tWorkspace("blockSettings.alignment")}>
      <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/20 p-1">
        {blockAlignmentValues.map((alignment) => {
          const Icon = blockAlignmentIcons[alignment];
          const label = tWorkspace(`alignment.${alignment}`);
          const active = current === alignment;
          return (
            <Button
              key={alignment}
              type="button"
              size="sm"
              variant={active ? "secondary" : "ghost"}
              className={cn("h-9 justify-center px-2", active && "bg-background shadow-sm")}
              aria-pressed={active}
              title={label}
              onClick={() => onChange(alignment)}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="sr-only">{label}</span>
            </Button>
          );
        })}
      </div>
    </Field>
  );
};

const BlockSettings = ({
  block,
  products,
  productSearch,
  setProductSearch,
  productsLoading,
  update,
}: {
  block: CampaignBlock;
  products: Array<{
    id: string;
    name: string;
    sku?: string | null;
    barcode?: string | null;
    imageUrl?: string | null;
    priceText?: string | null;
    hasImage?: boolean;
  }>;
  productSearch: string;
  setProductSearch: (value: string) => void;
  productsLoading: boolean;
  update: (patch: Partial<CampaignBlock>) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const textBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const applyBodyBold = () => {
    if (block.type !== "text") return;
    const textarea = textBodyRef.current;
    const body = block.body ?? "";
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const selectedText = body.slice(selectionStart, selectionEnd);
      const nextBody = `${body.slice(0, selectionStart)}**${selectedText}**${body.slice(selectionEnd)}`;
      update({ body: nextBody });
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(selectionStart + 2, selectionEnd + 2);
      });
      return;
    }
    update({ bodyBold: !(block.bodyBold ?? false) });
  };

  if (block.type === "header") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.storeName")}>
          <Input
            value={block.storeName ?? ""}
            onChange={(event) => update({ storeName: event.target.value })}
            placeholder={tWorkspace("blockSettings.storeNameExample")}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.headerText")}>
          <Input
            value={block.heading ?? ""}
            onChange={(event) => update({ heading: event.target.value })}
            placeholder={tWorkspace("blockSettings.shortGreeting")}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showStoreName ?? true}
            onChange={(event) => update({ showStoreName: event.target.checked })}
          />
          {tWorkspace("blockSettings.showStore")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showLogo ?? true}
            onChange={(event) => update({ showLogo: event.target.checked })}
          />
          {tWorkspace("blockSettings.showLogo")}
        </label>
      </div>
    );
  }
  if (block.type === "hero") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.heading")}>
          <Input
            value={block.heading ?? ""}
            onChange={(event) => update({ heading: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.description")}>
          <Textarea
            value={block.subtitle ?? ""}
            onChange={(event) => update({ subtitle: event.target.value })}
            rows={4}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.imageUrl")}>
          <Input
            value={block.imageUrl ?? ""}
            onChange={(event) => update({ imageUrl: event.target.value })}
            placeholder={tWorkspace("blockSettings.urlPlaceholder")}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.buttonText")}>
          <Input
            value={block.buttonText ?? ""}
            onChange={(event) => update({ buttonText: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.buttonLink")}>
          <Input
            value={block.buttonUrl ?? ""}
            onChange={(event) => update({ buttonUrl: event.target.value })}
          />
        </Field>
      </div>
    );
  }
  if (block.type === "text") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.heading")}>
          <Input
            value={block.heading ?? ""}
            onChange={(event) => update({ heading: event.target.value })}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          <Button
            type="button"
            size="sm"
            variant={block.bodyBold ? "primary" : "outline"}
            aria-pressed={block.bodyBold ?? false}
            onClick={applyBodyBold}
          >
            <span className="font-bold" aria-hidden>
              B
            </span>
            {tWorkspace("blockSettings.bold")}
          </Button>
          <Field label={tWorkspace("blockSettings.textSize")}>
            <Select
              value={block.bodyFontSize ?? "normal"}
              onValueChange={(value) => update({ bodyFontSize: value as TextFontSize })}
            >
              <SelectTrigger aria-label={tWorkspace("blockSettings.textSize")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(textFontSizeClasses) as TextFontSize[]).map((fontSize) => (
                  <SelectItem key={fontSize} value={fontSize}>
                    {tWorkspace(`fontSize.${fontSize}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={tWorkspace("blockSettings.text")}>
          <Textarea
            ref={textBodyRef}
            value={block.body ?? ""}
            onChange={(event) => update({ body: event.target.value })}
            rows={6}
          />
        </Field>
      </div>
    );
  }
  if (block.type === "button") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.buttonText")}>
          <Input
            value={block.text ?? ""}
            onChange={(event) => update({ text: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.link")}>
          <Input
            value={block.url ?? ""}
            onChange={(event) => update({ url: event.target.value })}
            placeholder={tWorkspace("blockSettings.urlPlaceholder")}
          />
        </Field>
      </div>
    );
  }
  if (block.type === "products") {
    const selected = new Set(block.productIds ?? []);
    const productById = new Map(products.map((product) => [product.id, product]));
    const selectedProducts = (block.productIds ?? []).flatMap((id) => {
      const product = productById.get(id);
      return product ? [product] : [];
    });
    const updateProductButtonUrl = (productId: string, value: string) => {
      const next = { ...(block.productButtonUrls ?? {}) };
      if (value.trim()) {
        next[productId] = value;
      } else {
        delete next[productId];
      }
      update({ productButtonUrls: Object.keys(next).length ? next : {} });
    };
    const removeSelectedProduct = (productId: string) => {
      const nextUrls = { ...(block.productButtonUrls ?? {}) };
      delete nextUrls[productId];
      update({
        productIds: (block.productIds ?? []).filter((id) => id !== productId),
        productButtonUrls: Object.keys(nextUrls).length ? nextUrls : {},
      });
    };
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        {selectedProducts.length ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {tWorkspace("blockSettings.selectedProducts")}
            </p>
            {selectedProducts.map((product) => (
              <div key={product.id} className="rounded bg-background px-2 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{product.name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-danger hover:text-danger"
                    onClick={() => removeSelectedProduct(product.id)}
                    aria-label={tWorkspace("blockSettings.removeProduct", { name: product.name })}
                  >
                    <DeleteIcon className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <label className="mt-2 block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {tWorkspace("blockSettings.productButtonLink")}
                  </span>
                  <Input
                    value={block.productButtonUrls?.[product.id] ?? ""}
                    onChange={(event) => updateProductButtonUrl(product.id, event.target.value)}
                    placeholder={block.buttonUrl?.trim() || "https://example.com/product"}
                  />
                </label>
              </div>
            ))}
          </div>
        ) : null}
        <Field label={tWorkspace("blockSettings.productSearch")}>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              className="pl-9 pr-9"
              placeholder={tWorkspace("blockSettings.productSearchPlaceholder")}
            />
            {productsLoading ? (
              <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            ) : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {productSearch.trim()
              ? tWorkspace("blockSettings.productSearchHint")
              : tWorkspace("blockSettings.latestProductsHint")}
          </p>
        </Field>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              className={cn(
                "flex w-full gap-3 rounded-md border p-2 text-left text-sm",
                selected.has(product.id) ? "border-primary bg-primary/5" : "border-border",
              )}
              onClick={() => {
                const ids = block.productIds ?? [];
                const nextUrls = { ...(block.productButtonUrls ?? {}) };
                update({
                  productIds: ids.includes(product.id)
                    ? ids.filter((id) => id !== product.id)
                    : [...ids, product.id].slice(0, 12),
                  productButtonUrls: ids.includes(product.id)
                    ? (() => {
                        delete nextUrls[product.id];
                        return Object.keys(nextUrls).length ? nextUrls : {};
                      })()
                    : nextUrls,
                });
              }}
            >
              <PreviewImageFrame
                src={product.imageUrl}
                alt={product.name}
                frameClassName="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
                imageClassName="h-full w-full object-cover"
                fallback={
                  <span className="text-[10px] text-muted-foreground">
                    {tWorkspace("blockSettings.photo")}
                  </span>
                }
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{product.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[product.sku, product.barcode].filter(Boolean).join(" · ") ||
                    tWorkspace("blockSettings.noSkuBarcode")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {product.priceText ?? tWorkspace("blockSettings.noPrice")}
                </span>
              </span>
            </button>
          ))}
          {!products.length ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              {productSearch.trim()
                ? tWorkspace("blockSettings.searchEmpty")
                : tWorkspace("blockSettings.storeProductsEmpty")}
            </div>
          ) : null}
        </div>
        <Field label={tWorkspace("blockSettings.layout")}>
          <Select
            value={block.layout ?? "two"}
            onValueChange={(value) => update({ layout: value as "one" | "two" })}
          >
            <SelectTrigger aria-label={tWorkspace("blockSettings.layout")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one">{tWorkspace("blockSettings.layoutOne")}</SelectItem>
              <SelectItem value="two">{tWorkspace("blockSettings.layoutTwo")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showImage ?? true}
            onChange={(event) => update({ showImage: event.target.checked })}
          />
          {tWorkspace("blockSettings.showImage")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showPrice ?? true}
            onChange={(event) => update({ showPrice: event.target.checked })}
          />
          {tWorkspace("blockSettings.showPrice")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showDescription ?? true}
            onChange={(event) => update({ showDescription: event.target.checked })}
          />
          {tWorkspace("blockSettings.showDescription")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showButton ?? true}
            onChange={(event) => update({ showButton: event.target.checked })}
          />
          {tWorkspace("blockSettings.showButton")}
        </label>
        <Field label={tWorkspace("blockSettings.buttonText")}>
          <Input
            value={block.buttonText ?? ""}
            onChange={(event) => update({ buttonText: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.commonLink")}>
          <Input
            value={block.buttonUrl ?? ""}
            onChange={(event) => update({ buttonUrl: event.target.value })}
          />
        </Field>
      </div>
    );
  }
  if (block.type === "orderSummary") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.heading")}>
          <Input
            value={block.title ?? ""}
            onChange={(event) => update({ title: event.target.value })}
          />
        </Field>
        <Field
          label={tWorkspace("blockSettings.orderLine")}
          hint={tWorkspace("blockSettings.orderVariablesHint")}
        >
          <Textarea
            value={block.summaryText ?? ""}
            onChange={(event) => update({ summaryText: event.target.value })}
            placeholder={tWorkspace("defaults.orderSummaryLine")}
            rows={3}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.itemsLabel")}>
          <Input
            value={block.itemsLabel ?? ""}
            onChange={(event) => update({ itemsLabel: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.previewProductName")}>
          <Input
            value={block.sampleItemName ?? ""}
            onChange={(event) => update({ sampleItemName: event.target.value })}
            placeholder={tWorkspace("defaults.product")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={tWorkspace("blockSettings.quantitySeparator")}>
            <Input
              value={block.quantitySeparator ?? ""}
              onChange={(event) => update({ quantitySeparator: event.target.value })}
              placeholder={tWorkspace("blockSettings.quantitySeparatorPlaceholder")}
            />
          </Field>
          <Field label={tWorkspace("blockSettings.totalLabel")}>
            <Input
              value={block.totalLabel ?? ""}
              onChange={(event) => update({ totalLabel: event.target.value })}
            />
          </Field>
        </div>
        <Field label={tWorkspace("blockSettings.orderEmptyText")}>
          <Textarea
            value={block.emptyOrderText ?? ""}
            onChange={(event) => update({ emptyOrderText: event.target.value })}
            rows={3}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showSummary ?? true}
            onChange={(event) => update({ showSummary: event.target.checked })}
          />
          {tWorkspace("blockSettings.showOrderLine")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showItems ?? true}
            onChange={(event) => update({ showItems: event.target.checked })}
          />
          {tWorkspace("blockSettings.showItems")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showTotals ?? true}
            onChange={(event) => update({ showTotals: event.target.checked })}
          />
          {tWorkspace("blockSettings.showTotal")}
        </label>
      </div>
    );
  }
  if (block.type === "promo") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.promotionName")}>
          <Input
            value={block.title ?? ""}
            onChange={(event) => update({ title: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.promoCode")}>
          <Input
            value={block.discountCode ?? ""}
            onChange={(event) => update({ discountCode: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.description")}>
          <Textarea
            value={block.description ?? ""}
            onChange={(event) => update({ description: event.target.value })}
            rows={4}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.expiry")}>
          <Input
            value={block.expiryText ?? ""}
            onChange={(event) => update({ expiryText: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.buttonText")}>
          <Input
            value={block.buttonText ?? ""}
            onChange={(event) => update({ buttonText: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.buttonLink")}>
          <Input
            value={block.buttonUrl ?? ""}
            onChange={(event) => update({ buttonUrl: event.target.value })}
          />
        </Field>
      </div>
    );
  }
  if (block.type === "footer") {
    return (
      <div className="space-y-3">
        <AlignmentControl value={block.alignment} onChange={(alignment) => update({ alignment })} />
        <Field label={tWorkspace("blockSettings.storeName")}>
          <Input
            value={block.storeName ?? ""}
            onChange={(event) => update({ storeName: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.footerText")}>
          <Textarea
            value={block.text ?? ""}
            onChange={(event) => update({ text: event.target.value })}
            rows={4}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.phone")}>
          <Input
            value={block.phone ?? ""}
            onChange={(event) => update({ phone: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.address")}>
          <Input
            value={block.address ?? ""}
            onChange={(event) => update({ address: event.target.value })}
          />
        </Field>
        <Field label={tWorkspace("blockSettings.unsubscribeText")}>
          <Input
            value={block.unsubscribeText ?? ""}
            onChange={(event) => update({ unsubscribeText: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={block.showUnsubscribe ?? true}
            onChange={(event) => update({ showUnsubscribe: event.target.checked })}
          />
          {tWorkspace("blockSettings.showUnsubscribe")}
        </label>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{tWorkspace("blockSettings.noSettings")}</p>;
};

const ManualAudiencePicker = ({
  customers,
  queryLoading,
  search,
  setSearch,
  selectedIds,
  setSelectedIds,
  page,
  setPage,
  total,
}: {
  customers: Array<{
    id: string;
    name: string;
    email: string | null;
    hasValidEmail: boolean;
    isUnsubscribed: boolean;
  }>;
  queryLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  selectedIds: string[];
  setSelectedIds: (value: string[]) => void;
  page: number;
  setPage: (value: number) => void;
  total: number;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tWorkspace("manualAudience.search")}
        />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {customers.map((customer) => {
          const disabled = !customer.hasValidEmail || customer.isUnsubscribed;
          return (
            <label
              key={customer.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 border-b border-border p-2 text-sm last:border-b-0",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                className={checkboxClass}
                type="checkbox"
                disabled={disabled}
                checked={selected.has(customer.id)}
                onChange={() =>
                  setSelectedIds(
                    selected.has(customer.id)
                      ? selectedIds.filter((id) => id !== customer.id)
                      : [...selectedIds, customer.id],
                  )
                }
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{customer.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {customer.email ?? tWorkspace("manualAudience.noEmail")}
                </span>
              </span>
            </label>
          );
        })}
        {queryLoading ? (
          <p className="p-3 text-sm text-muted-foreground" role="status">
            {tWorkspace("actions.loading")}
          </p>
        ) : null}
        {!queryLoading && !customers.length ? (
          <p className="p-3 text-sm text-muted-foreground">{tWorkspace("manualAudience.empty")}</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{tWorkspace("manualAudience.selected", { count: selectedIds.length })}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={tWorkspace("actions.previousPage")}
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            <ChevronLeftIcon className="h-4 w-4" aria-hidden />
          </Button>
          <span>{page}</span>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={tWorkspace("actions.nextPage")}
            disabled={page * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRightIcon className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
};

const CampaignsDashboard = ({
  campaigns,
  loading,
  locale,
  builderAvailable,
  onCreate,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onResume,
  onDetails,
  onReconcile,
  onRetryTransient,
  onCancelQueued,
  onExportFailed,
  resumingCampaignId,
  actionCampaignId,
}: {
  campaigns: CampaignDashboardItem[];
  loading: boolean;
  locale: string;
  builderAvailable: boolean;
  onCreate: () => void;
  onEdit: (campaign: CampaignDashboardItem) => void;
  onDuplicate: (campaignId: string) => void;
  onArchive: (campaignId: string) => void;
  onDelete: (campaignId: string) => void;
  onResume: (campaignId: string) => void;
  onDetails: (campaignId: string) => void;
  onReconcile: (campaignId: string) => void;
  onRetryTransient: (campaignId: string) => void;
  onCancelQueued: (campaignId: string) => void;
  onExportFailed: (campaignId: string) => void;
  resumingCampaignId?: string | null;
  actionCampaignId?: string | null;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const builderUnavailableMessage = tWorkspace("builder.unavailableMessage");
  return (
    <Card className="bazaar-admin-surface">
      <CardHeader className="bazaar-admin-section-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{tWorkspace("campaigns.title")}</CardTitle>
          {!builderAvailable ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {tWorkspace("campaigns.desktopOnly")}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          onClick={onCreate}
          disabled={!builderAvailable}
          title={!builderAvailable ? builderUnavailableMessage : undefined}
          className="w-full sm:w-auto"
        >
          <AddIcon className="h-4 w-4" aria-hidden />
          {tWorkspace("actions.createCampaign")}
        </Button>
      </CardHeader>
      <CardContent>
        {campaigns.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="bazaar-admin-mobile-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{campaign.name}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {campaign.subject}
                    </p>
                  </div>
                  <Badge variant={campaignStatusVariant(campaign.status)}>
                    {campaignStatusLabel(tWorkspace, campaign.status)}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-5">
                  <Metric
                    label={tWorkspace("campaigns.metrics.audience")}
                    value={campaign.recipientCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.queued")}
                    value={campaign.queuedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.sending")}
                    value={campaign.sendingCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.accepted")}
                    value={campaign.acceptedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.deferred")}
                    value={campaign.deferredCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.delivered")}
                    value={campaign.deliveredCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.bounced")}
                    value={campaign.bouncedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.dropped")}
                    value={campaign.droppedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.suppressed")}
                    value={campaign.suppressedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.complained")}
                    value={campaign.complainedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.failed")}
                    value={campaign.failedCount}
                  />
                  <Metric
                    label={tWorkspace("campaigns.metrics.unresolved")}
                    value={campaign.unresolvedCount}
                  />
                </div>
                {campaign.status !== EmailCampaignStatus.DRAFT ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {tWorkspace("campaigns.deliverySummary", {
                      delivered: campaign.deliveredCount,
                      total: campaign.recipientCount,
                      percent:
                        campaign.recipientCount > 0
                          ? Math.round((campaign.deliveredCount / campaign.recipientCount) * 100)
                          : 0,
                      unresolved: campaign.unresolvedCount,
                      permanent:
                        campaign.bouncedCount +
                        campaign.droppedCount +
                        campaign.suppressedCount +
                        campaign.complainedCount +
                        campaign.failedCount,
                    })}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p className="truncate">
                      {campaign.senderIdentity?.fromEmail ?? tWorkspace("senders.bazaarKg")}
                    </p>
                    <p>{formatDateTime(campaign.updatedAt ?? campaign.createdAt, locale)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {campaign.status === EmailCampaignStatus.QUEUED ||
                    campaign.status === EmailCampaignStatus.SENDING ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onResume(campaign.id)}
                        disabled={resumingCampaignId === campaign.id}
                      >
                        <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                        {resumingCampaignId === campaign.id
                          ? tWorkspace("actions.sending")
                          : tWorkspace("actions.continue")}
                      </Button>
                    ) : null}
                    {campaign.status !== EmailCampaignStatus.DRAFT ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onDetails(campaign.id)}
                      >
                        {tWorkspace("actions.details")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onEdit(campaign)}
                      disabled={!builderAvailable || campaign.status !== EmailCampaignStatus.DRAFT}
                      title={
                        campaign.status !== EmailCampaignStatus.DRAFT
                          ? tWorkspace("campaigns.sentCannotEdit")
                          : !builderAvailable
                            ? builderUnavailableMessage
                            : undefined
                      }
                    >
                      <EditIcon className="h-4 w-4" aria-hidden />
                      {tWorkspace("actions.edit")}
                    </Button>
                    <ActionMenu>
                      {campaign.unresolvedCount > 0 ? (
                        <ActionMenuItem onSelect={() => onReconcile(campaign.id)}>
                          {tWorkspace("actions.reconcile")}
                        </ActionMenuItem>
                      ) : null}
                      {campaign.retryableFailedCount > 0 ? (
                        <ActionMenuItem onSelect={() => onRetryTransient(campaign.id)}>
                          {tWorkspace("actions.retryFailures", {
                            count: campaign.retryableFailedCount,
                          })}
                        </ActionMenuItem>
                      ) : null}
                      {campaign.queuedCount > 0 ? (
                        <ActionMenuItem onSelect={() => onCancelQueued(campaign.id)}>
                          {tWorkspace("actions.cancelQueue", { count: campaign.queuedCount })}
                        </ActionMenuItem>
                      ) : null}
                      {campaign.bouncedCount +
                        campaign.droppedCount +
                        campaign.suppressedCount +
                        campaign.complainedCount +
                        campaign.failedCount >
                      0 ? (
                        <ActionMenuItem onSelect={() => onExportFailed(campaign.id)}>
                          {tWorkspace("actions.exportErrors")}
                        </ActionMenuItem>
                      ) : null}
                      <ActionMenuItem onSelect={() => onDuplicate(campaign.id)}>
                        {tWorkspace("actions.duplicate")}
                      </ActionMenuItem>
                      <ActionMenuItem onSelect={() => onArchive(campaign.id)}>
                        {tWorkspace("actions.archive")}
                      </ActionMenuItem>
                      {campaign.status === EmailCampaignStatus.DRAFT ? (
                        <ActionMenuItem
                          onSelect={() => onDelete(campaign.id)}
                          className="text-danger"
                        >
                          {tWorkspace("actions.delete")}
                        </ActionMenuItem>
                      ) : null}
                    </ActionMenu>
                    {actionCampaignId === campaign.id ? <Spinner className="h-4 w-4" /> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bazaar-admin-empty min-h-[14rem]">
            <SparklesIcon className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-semibold" role={loading ? "status" : undefined}>
              {loading ? tWorkspace("actions.loading") : tWorkspace("campaigns.empty")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tWorkspace("campaigns.emptyDescription")}
            </p>
            <Button
              type="button"
              className="mt-4"
              onClick={onCreate}
              disabled={!builderAvailable}
              title={!builderAvailable ? builderUnavailableMessage : undefined}
            >
              {tWorkspace("actions.createCampaign")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const copyTextToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const CopyDnsValue = ({ value, label }: { value: string; label: string }) => {
  const tWorkspace = useWorkspaceTranslations();
  const [copied, setCopied] = useState(false);
  const disabled = !value.trim();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("h-7 w-7 shrink-0", copied && "text-success")}
      disabled={disabled}
      aria-label={copied ? tWorkspace("actions.copied") : label}
      title={copied ? tWorkspace("actions.copied") : label}
      onClick={async () => {
        if (disabled) return;
        await copyTextToClipboard(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? (
        <StatusSuccessIcon className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
};

const SendersPanel = ({
  data,
  loading,
  form,
  setForm,
  onCreate,
  creating,
  onCheck,
  checking,
  onArchive,
}: {
  data?: {
    defaultSender: { fromEmail: string; status: string; demoOnly: boolean } | null;
    primarySenderId?: string | null;
    senderHealth: {
      activeFromEmail: string;
      customDomainRequired: boolean;
      customDomainVerified: boolean;
      fallbackPermitted: boolean;
      dkim: { visible: boolean; verified: boolean };
      spfOrMailFrom: { visible: boolean; verified: boolean };
      dmarc: { visible: boolean; verified: boolean };
      activeSuppressions: number;
      acceptedTotal: number;
      bounceCount: number;
      complaintCount: number;
      bounceRate: number;
      complaintRate: number;
    };
    domains: Array<{
      id: string;
      domain: string;
      status: string;
      recordsJson: unknown;
      lastCheckedAt: Date | null;
      errorMessage: string | null;
    }>;
    senders: Array<{
      id: string;
      displayName: string;
      fromEmail: string;
      replyToEmail: string | null;
      status: string;
      domainId: string | null;
    }>;
  };
  loading: boolean;
  form: { displayName: string; fromEmail: string; replyToEmail: string };
  setForm: (form: { displayName: string; fromEmail: string; replyToEmail: string }) => void;
  onCreate: () => void;
  creating: boolean;
  onCheck: (domainId: string, triggerVerification: boolean) => void;
  checking: boolean;
  onArchive: (senderId: string) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const locale = useLocale();
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <Card className="bazaar-admin-surface">
        <CardHeader className="bazaar-admin-section-header">
          <CardTitle>{tWorkspace("senders.configure")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={tWorkspace("senders.displayName")}>
            <Input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder={tWorkspace("senders.displayNamePlaceholder")}
            />
          </Field>
          <Field label={tWorkspace("senders.fromEmail")} hint={tWorkspace("senders.fromEmailHint")}>
            <Input
              value={form.fromEmail}
              onChange={(event) => setForm({ ...form, fromEmail: event.target.value })}
              placeholder={tWorkspace("senders.fromEmailPlaceholder")}
            />
          </Field>
          <Field label={tWorkspace("senders.replyTo")}>
            <Input
              value={form.replyToEmail}
              onChange={(event) => setForm({ ...form, replyToEmail: event.target.value })}
              placeholder={tWorkspace("senders.replyToPlaceholder")}
            />
          </Field>
          <Button
            type="button"
            className="w-full"
            disabled={creating || !form.displayName || !form.fromEmail}
            onClick={onCreate}
          >
            {creating ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <AddIcon className="h-4 w-4" aria-hidden />
            )}
            {tWorkspace("senders.add")}
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-4">
        {data?.senderHealth ? (
          <Card className="bazaar-admin-surface">
            <CardHeader className="bazaar-admin-section-header">
              <CardTitle>{tWorkspace("senders.health")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <Metric
                  label={tWorkspace("senders.activeFrom")}
                  value={data.senderHealth.customDomainVerified ? 1 : 0}
                />
                <Metric
                  label={tWorkspace("senders.suppressions")}
                  value={data.senderHealth.activeSuppressions}
                />
                <Metric
                  label={tWorkspace("senders.providerAccepted")}
                  value={data.senderHealth.acceptedTotal}
                />
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {tWorkspace("senders.activeSender", { email: data.senderHealth.activeFromEmail })}{" "}
                {data.senderHealth.fallbackPermitted
                  ? tWorkspace("senders.fallbackAllowed")
                  : tWorkspace("senders.fallbackBlocked")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    data.senderHealth.customDomainVerified
                      ? "success"
                      : data.senderHealth.customDomainRequired
                        ? "danger"
                        : "muted"
                  }
                >
                  {tWorkspace(
                    data.senderHealth.customDomainVerified
                      ? "senders.domainVerified"
                      : "senders.domainNotVerified",
                  )}
                </Badge>
                <Badge variant={data.senderHealth.dkim.verified ? "success" : "warning"}>
                  DKIM{" "}
                  {data.senderHealth.dkim.verified
                    ? "OK"
                    : data.senderHealth.dkim.visible
                      ? tWorkspace("senders.pending")
                      : tWorkspace("senders.noData")}
                </Badge>
                <Badge variant={data.senderHealth.spfOrMailFrom.verified ? "success" : "warning"}>
                  SPF / MAIL FROM{" "}
                  {data.senderHealth.spfOrMailFrom.verified
                    ? "OK"
                    : data.senderHealth.spfOrMailFrom.visible
                      ? tWorkspace("senders.pending")
                      : tWorkspace("senders.noData")}
                </Badge>
                <Badge variant={data.senderHealth.dmarc.visible ? "success" : "warning"}>
                  DMARC{" "}
                  {data.senderHealth.dmarc.visible
                    ? tWorkspace("senders.visible")
                    : tWorkspace("senders.noData")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {tWorkspace("senders.rates", {
                  bounceRate: (data.senderHealth.bounceRate * 100).toFixed(2),
                  bounceCount: data.senderHealth.bounceCount,
                  complaintRate: (data.senderHealth.complaintRate * 100).toFixed(2),
                  complaintCount: data.senderHealth.complaintCount,
                })}
              </p>
            </CardContent>
          </Card>
        ) : null}
        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header">
            <CardTitle>{tWorkspace("senders.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.defaultSender ? (
              <div className="bazaar-admin-info-tile">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{tWorkspace("senders.bazaarKg")}</p>
                    <p className="text-sm text-muted-foreground">{data.defaultSender.fromEmail}</p>
                  </div>
                  <Badge
                    variant={
                      data.defaultSender.status === "VERIFIED"
                        ? "success"
                        : data.defaultSender.status === "FAILED"
                          ? "danger"
                          : data.defaultSender.status === "NOT_CONFIGURED"
                            ? "warning"
                            : "muted"
                    }
                  >
                    {senderStatusLabel(tWorkspace, data.defaultSender.status)}
                  </Badge>
                </div>
              </div>
            ) : null}
            {(data?.senders ?? []).map((sender) => (
              <div key={sender.id} className="bazaar-admin-mobile-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{sender.displayName}</p>
                    <p className="truncate text-sm text-muted-foreground">{sender.fromEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {data?.primarySenderId === sender.id ? (
                      <Badge variant="success">{tWorkspace("senders.primary")}</Badge>
                    ) : null}
                    <Badge
                      variant={
                        sender.status === "VERIFIED"
                          ? "success"
                          : sender.status === "FAILED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {senderStatusLabel(tWorkspace, sender.status)}
                    </Badge>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => onArchive(sender.id)}
                      aria-label={tWorkspace("actions.archive")}
                    >
                      <ArchiveIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!loading && !(data?.senders ?? []).length ? (
              <p className="text-sm text-muted-foreground">{tWorkspace("senders.empty")}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header">
            <CardTitle>{tWorkspace("senders.domains")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.domains ?? []).map((domain) => {
              const records = Array.isArray(domain.recordsJson)
                ? (domain.recordsJson as Array<Record<string, unknown>>)
                : [];
              const dmarcName = "_dmarc";
              const dmarcValue = `v=DMARC1; p=none; rua=mailto:postmaster@${domain.domain}`;
              return (
                <div key={domain.id} className="bazaar-admin-info-tile p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{domain.domain}</p>
                      <p className="text-xs text-muted-foreground">
                        {domain.lastCheckedAt
                          ? tWorkspace("senders.checkedAt", {
                              date: formatDateTime(domain.lastCheckedAt, locale),
                            })
                          : tWorkspace("senders.neverChecked")}
                      </p>
                    </div>
                    <Badge
                      variant={
                        domain.status === "VERIFIED"
                          ? "success"
                          : domain.status === "FAILED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {senderStatusLabel(tWorkspace, domain.status)}
                    </Badge>
                  </div>
                  <div className="bazaar-admin-table-shell mt-3 overflow-auto">
                    <Table className="min-w-[820px] text-xs">
                      <TableHeader className="bg-muted/40 text-muted-foreground">
                        <TableRow>
                          <TableHead className="h-9 w-[90px] p-2">
                            {tWorkspace("senders.type")}
                          </TableHead>
                          <TableHead className="h-9 w-[260px] p-2">
                            {tWorkspace("senders.name")}
                          </TableHead>
                          <TableHead className="h-9 p-2">{tWorkspace("senders.value")}</TableHead>
                          <TableHead className="h-9 w-[140px] p-2">
                            {tWorkspace("senders.status")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((record, index) => {
                          const name = String(record.name ?? "");
                          const value = String(record.value ?? "");
                          return (
                            <TableRow key={index} className="border-t border-border">
                              <TableCell className="p-2">{String(record.type ?? "")}</TableCell>
                              <TableCell className="p-2">
                                <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
                                  <code className="truncate font-mono" title={name}>
                                    {name}
                                  </code>
                                  <CopyDnsValue
                                    value={name}
                                    label={tWorkspace("senders.copyRecordName")}
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="p-2">
                                <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
                                  <code className="truncate font-mono" title={value}>
                                    {value}
                                  </code>
                                  <CopyDnsValue
                                    value={value}
                                    label={tWorkspace("senders.copyRecordValue")}
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="p-2">{String(record.status ?? "")}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="bazaar-admin-notice mt-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {tWorkspace("senders.dmarcRecommended")}
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
                      <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-md bg-background px-2 py-1.5">
                        <code className="truncate text-xs" title={dmarcName}>
                          {dmarcName}
                        </code>
                        <CopyDnsValue
                          value={dmarcName}
                          label={tWorkspace("senders.copyDmarcName")}
                        />
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-md bg-background px-2 py-1.5">
                        <code className="truncate text-xs" title={dmarcValue}>
                          {dmarcValue}
                        </code>
                        <CopyDnsValue
                          value={dmarcValue}
                          label={tWorkspace("senders.copyDmarcValue")}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={checking}
                      onClick={() => onCheck(domain.id, false)}
                    >
                      {tWorkspace("senders.checkDns")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={checking}
                      onClick={() => onCheck(domain.id, true)}
                    >
                      {tWorkspace("senders.startVerification")}
                    </Button>
                  </div>
                </div>
              );
            })}
            {!loading && !(data?.domains ?? []).length ? (
              <p className="text-sm text-muted-foreground">{tWorkspace("senders.domainsEmpty")}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const AutomationsPanel = ({
  automations,
  loading,
  senders,
  primarySenderId,
  builderAvailable,
  onEdit,
  onToggle,
  onSender,
  testEmail,
  setTestEmail,
  onTest,
}: {
  automations: AutomationDashboardItem[];
  loading: boolean;
  senders: Array<{ id: string; displayName: string; fromEmail: string; status: string }>;
  primarySenderId?: string | null;
  builderAvailable: boolean;
  onEdit: (automation: AutomationDashboardItem) => void;
  onToggle: (automation: AutomationDashboardItem) => void;
  onSender: (automationId: string, value: string) => void;
  testEmail: string;
  setTestEmail: (value: string) => void;
  onTest: (automationId: string) => void;
}) => {
  const tWorkspace = useWorkspaceTranslations();
  const locale = useLocale();
  const builderUnavailableMessage = tWorkspace("builder.unavailableMessage");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {automations.map((automation) => (
        <Card key={automation.id} className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{triggerLabel(tWorkspace, automation.trigger)}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{automation.subject}</p>
              </div>
              <Badge
                variant={automation.status === EmailAutomationStatus.ACTIVE ? "success" : "muted"}
              >
                {automationStatusLabel(tWorkspace, automation.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Metric label={tWorkspace("automations.sent")} value={automation.sentCount} />
              <Metric label={tWorkspace("automations.errors")} value={automation.failedCount} />
              <div className="bazaar-admin-info-tile p-2">
                <p className="text-xs text-muted-foreground">{tWorkspace("automations.lastRun")}</p>
                <p className="mt-1 truncate text-xs font-semibold">
                  {automation.lastTriggeredAt
                    ? formatDateTime(automation.lastTriggeredAt, locale)
                    : tWorkspace("automations.none")}
                </p>
              </div>
            </div>
            <Field label={tWorkspace("builder.sender")}>
              <Select
                value={automation.senderIdentityId ?? primarySenderId ?? "__none__"}
                onValueChange={(value) => onSender(automation.id, value)}
              >
                <SelectTrigger aria-label={tWorkspace("builder.sender")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {primarySenderId ? null : (
                    <SelectItem value="__none__">
                      {tWorkspace("automations.automaticSender")}
                    </SelectItem>
                  )}
                  {senders.map((sender) => (
                    <SelectItem
                      key={sender.id}
                      value={sender.id}
                      disabled={sender.status !== "VERIFIED"}
                    >
                      {sender.displayName} · {sender.fromEmail}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                placeholder={tWorkspace("test.emailPlaceholder")}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!testEmail}
                onClick={() => onTest(automation.id)}
              >
                {tWorkspace("actions.test")}
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onEdit(automation)}
                disabled={!builderAvailable}
                title={!builderAvailable ? builderUnavailableMessage : undefined}
              >
                {tWorkspace("automations.editEmail")}
              </Button>
              <Button type="button" onClick={() => onToggle(automation)}>
                {automation.status === EmailAutomationStatus.ACTIVE
                  ? tWorkspace("actions.pause")
                  : tWorkspace("actions.activate")}
              </Button>
            </div>
            {!builderAvailable ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {tWorkspace("automations.desktopOnly")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {!loading && !automations.length ? (
        <Card className="bazaar-admin-surface xl:col-span-2">
          <CardContent className="bazaar-admin-empty m-4 min-h-[10rem]">
            {tWorkspace("automations.empty")}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
