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
  EmailCampaignStatus,
  EmailCampaignTemplate,
  EmailCampaignType,
} from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";

import {
  AddIcon,
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
  updateBuilderBlock,
} from "./builder-utils";

type AudienceMode = "manual" | "segment";
type AudienceSegment = "all" | "new" | "source" | "withPurchases" | "withoutPurchases";
type TabKey = "campaigns" | "automations" | "senders" | "templates";
type PreviewMode = "desktop" | "mobile";
type BuilderMode = "campaign" | "automation";

const builderDesktopMediaQuery = "(min-width: 1280px) and (pointer: fine)";
const builderUnavailableMessage =
  "Визуальный редактор писем доступен только на компьютере. На телефоне или планшете можно настроить отправителей, домены и базовые параметры, но редактировать письмо лучше с рабочего экрана.";

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
  failedCount: number;
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
    }
  | {
      id: string;
      type: "hero";
      imageUrl?: string | null;
      heading?: string | null;
      subtitle?: string | null;
      buttonText?: string | null;
      buttonUrl?: string | null;
    }
  | {
      id: string;
      type: "text";
      heading?: string | null;
      body?: string | null;
    }
  | {
      id: string;
      type: "button";
      text?: string | null;
      url?: string | null;
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
      layout?: "one" | "two";
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

const sourceValues = [
  CustomerSource.IMPORT,
  CustomerSource.ORDER,
  CustomerSource.MANUAL,
  CustomerSource.INTEGRATION,
];

const sourceLabels: Record<CustomerSource, string> = {
  IMPORT: "Импорт",
  ORDER: "Заказы",
  MANUAL: "Вручную",
  INTEGRATION: "Интеграция",
};

const blockLabels: Record<CampaignBlock["type"], string> = {
  header: "Шапка",
  hero: "Hero",
  text: "Текст",
  button: "Кнопка",
  products: "Товары",
  orderSummary: "Заказ",
  promo: "Промо",
  divider: "Разделитель",
  footer: "Подвал",
};

const blockDescriptions: Record<CampaignBlock["type"], string> = {
  header: "Логотип, название магазина и вводный текст.",
  hero: "Большое изображение, заголовок и CTA.",
  text: "Абзац или короткое объявление.",
  button: "Отдельная кнопка со ссылкой.",
  products: "Товары текущего магазина.",
  orderSummary: "Состав заказа для автоматизаций.",
  promo: "Промокод или специальное предложение.",
  divider: "Тонкая линия между секциями.",
  footer: "Контакты, подпись и отписка.",
};

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

const defaultBlocks = (storeName?: string | null): CampaignBlock[] => [
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
    heading: "Здравствуйте, {{customerName}}!",
    body: "Расскажите клиентам о новинках, акции или важной новости магазина.",
  },
  {
    id: `products-${uid()}`,
    type: "products",
    productIds: [],
    showImage: true,
    showPrice: true,
    showDescription: true,
    showButton: true,
    buttonText: "Подробнее",
    layout: "two",
  },
  {
    id: `footer-${uid()}`,
    type: "footer",
    text: "Вы получили это письмо, потому что ваш email есть в базе клиентов магазина.",
    unsubscribeText: "Отписаться от рассылки",
    showUnsubscribe: true,
  },
	];

const defaultOrderSummaryBlock = (
  id = `order-${uid()}`,
): Extract<CampaignBlock, { type: "orderSummary" }> => ({
  id,
  type: "orderSummary",
  title: "Состав заказа",
  summaryText: "Заказ {{orderNumber}} · {{orderStatus}}",
  itemsLabel: "Товары",
  totalLabel: "Итого",
  emptyOrderText: "Данные заказа появятся при отправке автоматизации.",
  quantitySeparator: "×",
  sampleItemName: "Товар",
  showSummary: true,
  showItems: true,
  showTotals: true,
});

const defaultAutomationBlocks = (trigger?: EmailAutomationTrigger): CampaignBlock[] => [
  {
    id: `header-${uid()}`,
    type: "header",
    showStoreName: true,
    showLogo: true,
    storeName: "",
    heading:
      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
        ? "Статус заказа изменился"
        : "Спасибо за заказ, {{customerName}}",
  },
  {
    id: `text-${uid()}`,
    type: "text",
    heading:
      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
        ? "Заказ {{orderNumber}} теперь: {{orderStatus}}"
        : "Заказ {{orderNumber}} принят",
    body: "Ниже краткая информация по заказу.",
  },
	  {
	    ...defaultOrderSummaryBlock(),
	    summaryText:
	      trigger === EmailAutomationTrigger.ORDER_STATUS_CHANGED
	        ? "Заказ {{orderNumber}} · было: {{orderPreviousStatus}} · сейчас: {{orderStatus}}"
	        : "Заказ {{orderNumber}} · {{orderStatus}}",
	  },
  {
    id: `footer-${uid()}`,
    type: "footer",
    text: "Это сервисное письмо по вашему заказу.",
    showUnsubscribe: false,
  },
];

const newBlock = (type: CampaignBlock["type"]): CampaignBlock => {
  const id = `${type}-${uid()}`;
  if (type === "header") return { id, type, showLogo: true, showStoreName: true, storeName: "" };
  if (type === "hero") return { id, type, heading: "Новость магазина", subtitle: "", imageUrl: "" };
  if (type === "text") return { id, type, heading: "", body: "" };
  if (type === "button") return { id, type, text: "Подробнее", url: "" };
  if (type === "products") {
    return {
      id,
      type,
      productIds: [],
      showImage: true,
      showPrice: true,
      showDescription: true,
      showButton: true,
      buttonText: "Подробнее",
      layout: "two",
    };
  }
	  if (type === "orderSummary") return defaultOrderSummaryBlock(id);
  if (type === "promo") return { id, type, title: "Скидка", discountCode: "", description: "" };
  if (type === "divider") return { id, type };
  return {
    id,
    type,
    text: "Вы получили это письмо, потому что ваш email есть в базе клиентов магазина.",
    unsubscribeText: "Отписаться от рассылки",
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
  if (block.type === "hero") return Boolean(block.heading?.trim() || block.subtitle?.trim() || block.imageUrl?.trim());
  if (block.type === "button") return Boolean(block.text?.trim() && block.url?.trim());
  return true;
};

const blockNeedsDeleteConfirmation = (block: CampaignBlock) =>
  builderBlockHasMeaningfulContent(block);

const editableTextValue = (element: HTMLElement, multiline?: boolean) => {
  const value = (multiline ? element.innerText : element.textContent ?? "").replace(/\u00a0/g, " ");
  return multiline ? value.replace(/\n{3,}/g, "\n\n") : value.replace(/\s+/g, " ").trim();
};

const parseBlocks = (value: unknown, fallbackBody?: string | null): CampaignBlock[] => {
  if (Array.isArray(value)) {
    const parsed = value.filter((item): item is CampaignBlock => {
      return Boolean(item) && typeof item === "object" && "type" in item && "id" in item;
    });
    return parsed.length ? parsed : defaultBlocks();
  }
  return [
    { id: `text-${uid()}`, type: "text", body: fallbackBody ?? "" },
    { id: `footer-${uid()}`, type: "footer", showUnsubscribe: true },
  ];
};

const campaignStatusLabel = (status: EmailCampaignStatus) => {
  if (status === EmailCampaignStatus.DRAFT) return "Черновик";
  if (status === EmailCampaignStatus.SENDING) return "Отправляется";
  if (status === EmailCampaignStatus.SENT) return "Отправлена";
  if (status === EmailCampaignStatus.PARTIAL) return "Частично";
  return "Ошибка";
};

const campaignStatusVariant = (status: EmailCampaignStatus) => {
  if (status === EmailCampaignStatus.SENT) return "success" as const;
  if (status === EmailCampaignStatus.SENDING) return "warning" as const;
  if (status === EmailCampaignStatus.FAILED) return "danger" as const;
  return "muted" as const;
};

const senderStatusLabel = (status?: string | null) => {
  if (status === "VERIFIED") return "Подтвержден";
  if (status === "FAILED") return "Ошибка";
  if (status === "AVAILABLE") return "Демо";
  return "Ожидает DNS";
};

const triggerLabel = (trigger: EmailAutomationTrigger) =>
  trigger === EmailAutomationTrigger.ORDER_CREATED ? "Заказ создан" : "Статус заказа изменен";

const automationStatusLabel = (status: EmailAutomationStatus) =>
  status === EmailAutomationStatus.ACTIVE ? "Активна" : "На паузе";

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
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== (value ?? "")) {
      ref.current.textContent = value ?? "";
    }
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
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
        selected ? "border-primary ring-2 ring-primary/15" : "border-transparent hover:border-border",
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
        aria-label={`Перетащить блок ${index + 1}`}
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
        <Button type="button" size="icon" variant="ghost" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Выше" className="h-8 w-8">
          <ArrowUpIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" size="icon" variant="ghost" disabled={!canMoveDown} onClick={onMoveDown} aria-label="Ниже" className="h-8 w-8">
          <ArrowDownIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onDuplicate} aria-label="Дублировать" className="h-8 w-8">
          <CopyIcon className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onDelete} aria-label="Удалить" className="h-8 w-8 text-danger hover:text-danger">
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
  <div className="space-y-1.5">
    <Label>{label}</Label>
    {children}
    {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
  </div>
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
  const locale = useLocale();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const builderDesktopReady = useMediaQuery(builderDesktopMediaQuery);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();

  const [storeId, setStoreId] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("campaigns");
  const [builderMode, setBuilderMode] = useState<BuilderMode>("campaign");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [automationId, setAutomationId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [senderIdentityId, setSenderIdentityId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState("");
  const [blocks, setBlocks] = useState<CampaignBlock[]>(defaultBlocks());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("segment");
  const [audienceSegment, setAudienceSegment] = useState<AudienceSegment>("all");
  const [source, setSource] = useState<"ALL" | CustomerSource>("ALL");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [brandColor, setBrandColor] = useState(defaultBrandColor);
  const [buttonColor, setButtonColor] = useState(defaultBrandColor);
  const [buttonTextColor, setButtonTextColor] = useState(defaultButtonTextColor);
  const [backgroundColor, setBackgroundColor] = useState(defaultEmailBackgroundColor);
  const [contentBackgroundColor, setContentBackgroundColor] = useState(defaultEmailContentBackgroundColor);
  const [textColor, setTextColor] = useState(defaultEmailTextColor);
  const [mutedTextColor, setMutedTextColor] = useState(defaultEmailMutedTextColor);
  const [borderColor, setBorderColor] = useState(defaultEmailBorderColor);
  const [fontFamily, setFontFamily] = useState<EmailCampaignFontFamily>(EmailCampaignFontFamily.INTER);
  const [logoStoreId, setLogoStoreId] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [senderForm, setSenderForm] = useState({ displayName: "", fromEmail: "", replyToEmail: "" });

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;

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
  const sendersQuery = trpc.emailMarketing.senders.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );
  const automationsQuery = trpc.emailMarketing.automations.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );
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
    { enabled: Boolean(storeId && builderOpen && builderMode === "campaign"), keepPreviousData: true },
  );
  const productsQuery = trpc.emailMarketing.products.useQuery(
    {
      storeId,
      search: "",
      category: null,
      limit: 40,
    },
    { enabled: Boolean(storeId && builderOpen) },
  );

  const selectedSender = useMemo(
    () => sendersQuery.data?.senders.find((sender) => sender.id === senderIdentityId) ?? null,
    [senderIdentityId, sendersQuery.data?.senders],
  );

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) ?? blocks[0] ?? null;
  const selectedBlockIndex = selectedBlock ? blocks.findIndex((block) => block.id === selectedBlock.id) : -1;
  const productItems = useMemo(() => productsQuery.data?.items ?? [], [productsQuery.data?.items]);
  const selectedProductMap = useMemo(
    () => new Map(productItems.map((product) => [product.id, product])),
    [productItems],
  );
  const selectedLogo = useMemo(
    () =>
      (logoGalleryQuery.data ?? []).find(
        (logo) => logo.storeId === (logoStoreId || storeId),
      ) ?? null,
    [logoGalleryQuery.data, logoStoreId, storeId],
  );
  const selectedLogoUrl = selectedLogo?.logoUrl ?? null;
  const bannerUrlLooksDirect = looksLikeDirectImageUrl(bannerImageUrl);

  const campaignInput = useMemo(
    () => ({
      id: campaignId,
      storeId,
      campaignType:
        builderMode === "automation" ? EmailCampaignType.TRANSACTIONAL : EmailCampaignType.MARKETING,
      senderIdentityId,
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
      senderIdentityId,
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
    const fallbackHtml =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:96px;width:100%;box-sizing:border-box;background:#f3f4f6;color:#64748b;font-size:13px;line-height:1.4;text-align:center;padding:16px;border:1px dashed #cbd5e1;">Изображение недоступно в локальном предпросмотре</div>';
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
      const match = tag.match(/\ssrc=(["'])(.*?)\1/i);
      const src = match?.[2];
      if (!src) return tag;
      try {
        const imageUrl = new URL(src, window.location.href);
        const isLocalHost =
          imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
        return isLocalHost && imageUrl.origin !== window.location.origin ? fallbackHtml : tag;
      } catch {
        return tag;
      }
    });
  }, [previewMutation.data?.rendered.html]);
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
      fallback.textContent = "Изображение недоступно в локальном предпросмотре";
      fallback.style.cssText =
        "display:flex;align-items:center;justify-content:center;min-height:96px;width:100%;box-sizing:border-box;background:#f3f4f6;color:#64748b;font-size:13px;line-height:1.4;text-align:center;padding:16px;border:1px dashed #cbd5e1;";
      image.replaceWith(fallback);
    };
    const shouldSkipImageLoad = (image: HTMLImageElement) => {
      try {
        const imageUrl = new URL(image.currentSrc || image.src, window.location.href);
        const isLocalHost =
          imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
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
  }, [previewOpen, previewHtml]);

  useEffect(() => {
    if (!builderOpen || builderDesktopReady) return;
    setBuilderOpen(false);
    toast({ variant: "info", description: builderUnavailableMessage });
  }, [builderDesktopReady, builderOpen, toast]);

  const createSenderMutation = trpc.emailMarketing.createSender.useMutation({
    onSuccess: async () => {
      setSenderForm({ displayName: "", fromEmail: "", replyToEmail: "" });
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: "Отправитель добавлен. Проверьте DNS записи." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const checkDomainMutation = trpc.emailMarketing.checkSenderDomain.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: "Статус DNS обновлен." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const archiveSenderMutation = trpc.emailMarketing.archiveSender.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.senders.invalidate();
      toast({ variant: "success", description: "Отправитель архивирован." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const saveDraftMutation = trpc.emailMarketing.saveDraft.useMutation({
    onSuccess: async (campaign) => {
      setCampaignId(campaign.id);
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: "Черновик сохранен." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const sendCampaignMutation = trpc.emailMarketing.sendCampaign.useMutation({
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setBuilderOpen(false);
      await Promise.all([utils.emailMarketing.history.invalidate(), utils.emailMarketing.overview.invalidate()]);
      toast({ variant: "success", description: `Кампания поставлена в очередь. Получателей: ${result.recipientCount}.` });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const testMutation = trpc.emailMarketing.sendTest.useMutation({
    onSuccess: () => {
      setTestOpen(false);
      toast({ variant: "success", description: "Тестовое письмо отправлено." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const duplicateMutation = trpc.emailMarketing.duplicateCampaign.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: "Кампания продублирована." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const archiveMutation = trpc.emailMarketing.archiveCampaign.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: "Кампания архивирована." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const deleteDraftMutation = trpc.emailMarketing.deleteCampaignDraft.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: "Черновик удален." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const updateAutomationMutation = trpc.emailMarketing.updateAutomation.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.automations.invalidate();
      toast({ variant: "success", description: "Автоматизация обновлена." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });
  const testAutomationMutation = trpc.emailMarketing.testAutomation.useMutation({
    onSuccess: () => toast({ variant: "success", description: "Тест автоматизации отправлен." }),
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    const block = newBlock(type);
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
      ...newBlock("hero"),
      imageUrl,
      heading: "Новость магазина",
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
    const result = duplicateBuilderBlock(
      blocks,
      id,
      (block) => `${block.type}-${uid()}`,
    );
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
        title: "Удалить блок?",
        description: "Блок содержит контент. После сохранения он будет удален из письма.",
        confirmLabel: "Удалить",
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
    setBlocks((current) =>
      reorderBuilderBlocks(current, String(active.id), String(over.id)),
    );
    setSelectedBlockId(String(active.id));
  };

  const openNewCampaign = () => {
    if (!builderDesktopReady) {
      showBuilderUnavailable();
      return;
    }
    const storeName = overviewQuery.data?.store?.name ?? selectedStore?.name ?? "";
    const initialBlocks = defaultBlocks(storeName);
    setBuilderMode("campaign");
    setCampaignId(null);
    setAutomationId(null);
    setCampaignName(storeName ? `Кампания ${storeName}` : "Новая кампания");
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
    setSenderIdentityId(sendersQuery.data?.senders.find((sender) => sender.status === "VERIFIED")?.id ?? null);
    setBuilderOpen(true);
  };

  const openCampaign = (campaign: CampaignDashboardItem) => {
    if (!builderDesktopReady) {
      showBuilderUnavailable();
      return;
    }
    const parsedBlocks = parseBlocks(campaign.blocksJson, campaign.body);
    setBuilderMode("campaign");
    setCampaignId(campaign.id);
    setAutomationId(null);
    setCampaignName(campaign.name);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader ?? "");
    setSenderIdentityId(campaign.senderIdentityId ?? null);
    setReplyToEmail(campaign.replyToEmail ?? "");
    setBrandColor(campaign.brandColor && colorPattern.test(campaign.brandColor) ? campaign.brandColor : defaultBrandColor);
    setButtonColor(campaign.buttonColor && colorPattern.test(campaign.buttonColor) ? campaign.buttonColor : defaultBrandColor);
    setButtonTextColor(campaign.buttonTextColor && colorPattern.test(campaign.buttonTextColor) ? campaign.buttonTextColor : defaultButtonTextColor);
    setBackgroundColor(campaign.backgroundColor && colorPattern.test(campaign.backgroundColor) ? campaign.backgroundColor : defaultEmailBackgroundColor);
    setContentBackgroundColor(campaign.contentBackgroundColor && colorPattern.test(campaign.contentBackgroundColor) ? campaign.contentBackgroundColor : defaultEmailContentBackgroundColor);
    setTextColor(campaign.textColor && colorPattern.test(campaign.textColor) ? campaign.textColor : defaultEmailTextColor);
    setMutedTextColor(campaign.mutedTextColor && colorPattern.test(campaign.mutedTextColor) ? campaign.mutedTextColor : defaultEmailMutedTextColor);
    setBorderColor(campaign.borderColor && colorPattern.test(campaign.borderColor) ? campaign.borderColor : defaultEmailBorderColor);
    setFontFamily(campaign.fontFamily);
    setLogoStoreId("");
    setBannerImageUrl(
      campaign.bannerImageUrl ??
        (parsedBlocks.find((block) => block.type === "hero") as Extract<CampaignBlock, { type: "hero" }> | undefined)
          ?.imageUrl ??
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
    const parsedBlocks = parseBlocks(automation.blocksJson, null);
    const initialBlocks = parsedBlocks.length ? parsedBlocks : defaultAutomationBlocks(automation.trigger);
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
        : overviewQuery.data?.store?.brandColor && colorPattern.test(overviewQuery.data.store.brandColor)
          ? overviewQuery.data.store.brandColor
        : defaultBrandColor,
    );
    setButtonColor(
      automation.buttonColor && colorPattern.test(automation.buttonColor)
        ? automation.buttonColor
        : automation.brandColor && colorPattern.test(automation.brandColor)
          ? automation.brandColor
          : overviewQuery.data?.store?.brandColor && colorPattern.test(overviewQuery.data.store.brandColor)
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
	      senderIdentityId,
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
    sendCampaignMutation.mutate({ campaignId: id });
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
  const validation = previewMutation.data?.validationChecklist ?? [
    { key: "sender", label: "Отправитель подтвержден", ok: Boolean(selectedSender?.status === "VERIFIED"), critical: true },
    { key: "subject", label: "Тема письма указана", ok: Boolean(subject.trim()), critical: true },
    { key: "content", label: "Письмо содержит контент", ok: blocks.some(blockHasContent), critical: true },
  ];
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
      const result = (await response.json().catch(() => null)) as
        | { logo?: { storeId?: string | null } }
        | null;
      const nextLogoStoreId = result?.logo?.storeId || logoStoreId || storeId;
      setLogoStoreId(nextLogoStoreId);
      await logoGalleryQuery.refetch();
      previewMutation.mutate({ ...campaignInput, logoStoreId: nextLogoStoreId });
      toast({ variant: "success", description: "Логотип обновлен." });
    } catch {
      toast({ variant: "error", description: "Не удалось загрузить логотип." });
    } finally {
      setUploadingLogo(false);
    }
  };

  if (builderOpen) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setBuilderOpen(false)}>
            <BackIcon className="h-4 w-4" aria-hidden />
            Назад
          </Button>
          <Input
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            className="h-9 max-w-[360px] border-transparent bg-transparent px-2 text-base font-semibold shadow-none focus-visible:border-border"
            aria-label="Название"
          />
          <Badge variant={saveDraftMutation.isLoading || updateAutomationMutation.isLoading ? "warning" : "muted"}>
            {saveDraftMutation.isLoading || updateAutomationMutation.isLoading ? "Сохранение" : campaignId || automationId ? "Сохранено" : "Новый черновик"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant={previewMode === "desktop" ? "primary" : "outline"}
              onClick={() => setPreviewMode("desktop")}
              aria-label="Desktop"
            >
              <DesktopPreviewIcon className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={previewMode === "mobile" ? "primary" : "outline"}
              onClick={() => setPreviewMode("mobile")}
              aria-label="Mobile"
            >
              <MobilePreviewIcon className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" variant="secondary" onClick={() => void saveCurrent()}>
              Сохранить
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
              Предпросмотр
            </Button>
            <Button type="button" variant="secondary" onClick={() => setTestOpen(true)}>
              Отправить тест
            </Button>
            <Button
              type="button"
              disabled={builderMode !== "campaign" || !canSend || sendCampaignMutation.isLoading}
              onClick={() => setConfirmOpen(true)}
            >
              Отправить
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Блоки
            </p>
            <div className="mt-3 space-y-2">
              {(builderMode === "automation" ? automationBlockTypeOptions : blockTypeOptions).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="w-full rounded-md border border-border bg-background p-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
                  onClick={() => addBlock(type)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <AddIcon className="h-4 w-4" aria-hidden />
                    {blockLabels[type]}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {blockDescriptions[type]}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-md border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
              Переменные: {"{{customerName}}, {{storeName}}, {{orderNumber}}, {{orderStatus}}, {{orderPreviousStatus}}, {{orderTotal}}, {{unsubscribeLink}}"}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto bg-muted/30 p-6">
            <div className="mx-auto flex max-w-[860px] flex-col gap-4">
              <div className="rounded-md border border-border bg-card p-3 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Field label="Тема письма">
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
                  </Field>
                  <Field label="Отправитель">
                    <Select
                      value={senderIdentityId ?? "__none__"}
                      onValueChange={(value) => setSenderIdentityId(value === "__none__" ? null : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Bazaar demo</SelectItem>
                        {(sendersQuery.data?.senders ?? []).map((sender) => (
                          <SelectItem key={sender.id} value={sender.id}>
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
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
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
                              Добавить текст
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
                            Добавить текст
                          </Button>
                        </div>
                      ) : null}
                      {!blocks.length ? (
                        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                          Добавьте первый блок из библиотеки слева.
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
                  <h2 className="text-sm font-semibold">Проверка</h2>
                  <p className="text-xs text-muted-foreground">Критичные пункты блокируют отправку.</p>
                </div>
                <div className="space-y-2">
                  {validation.map((item) => (
                    <div key={item.key} className="flex items-start gap-2 rounded-md border border-border bg-background p-2 text-sm">
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
                  <h2 className="text-sm font-semibold">Аудитория</h2>
                  <Field label="Режим">
                    <Select value={audienceMode} onValueChange={(value) => setAudienceMode(value as AudienceMode)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="segment">Сегмент</SelectItem>
                        <SelectItem value="manual">Вручную</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {audienceMode === "segment" ? (
                    <Field label="Сегмент">
                      <Select value={audienceSegment} onValueChange={(value) => setAudienceSegment(value as AudienceSegment)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Все клиенты с email</SelectItem>
                          <SelectItem value="new">Новые клиенты</SelectItem>
                          <SelectItem value="withPurchases">С покупками</SelectItem>
                          <SelectItem value="withoutPurchases">Без покупок</SelectItem>
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
                  <Field label="Источник">
                    <Select value={source} onValueChange={(value) => setSource(value as "ALL" | CustomerSource)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Все источники</SelectItem>
                        {sourceValues.map((value) => (
                          <SelectItem key={value} value={value}>{sourceLabels[value]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Получатели" value={audienceSummary.validRecipients} />
                    <Metric label="Без email" value={audienceSummary.excludedNoEmail} />
                    <Metric label="Отписались" value={audienceSummary.excludedUnsubscribed} />
                    <Metric label="Дубли" value={audienceSummary.duplicatesRemoved} />
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <h2 className="text-sm font-semibold">
                  {selectedBlock ? blockLabels[selectedBlock.type] : "Настройки"}
                </h2>
                {selectedBlock ? (
                  <BlockSettings
                    block={selectedBlock}
                    products={productItems}
                    update={(patch) => updateBlock(selectedBlock.id, patch)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Выберите блок в письме.</p>
                )}
                {selectedBlock ? (
                  <div className="grid grid-cols-4 gap-2 border-t border-border pt-3">
                    <Button type="button" size="icon" variant="secondary" disabled={selectedBlockIndex <= 0} onClick={() => moveBlock(selectedBlock.id, -1)} aria-label="Выше">
                      <ArrowUpIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" size="icon" variant="secondary" disabled={selectedBlockIndex >= blocks.length - 1} onClick={() => moveBlock(selectedBlock.id, 1)} aria-label="Ниже">
                      <ArrowDownIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" size="icon" variant="secondary" onClick={() => duplicateBlock(selectedBlock.id)} aria-label="Дублировать">
                      <CopyIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" size="icon" variant="danger" onClick={() => void deleteBlock(selectedBlock.id)} aria-label="Удалить">
                      <DeleteIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="space-y-3 border-t border-border pt-4">
                <h2 className="text-sm font-semibold">Дизайн</h2>
                <div className="grid grid-cols-2 gap-2">
                  <ColorField label="Бренд" value={brandColor} onChange={setBrandColor} />
                  <ColorField label="Кнопка" value={buttonColor} onChange={setButtonColor} />
                </div>
                <Field label="Прехедер">
                  <Input value={preheader} onChange={(event) => setPreheader(event.target.value)} />
                </Field>
                <Field label="Reply-to">
                  <Input value={replyToEmail} onChange={(event) => setReplyToEmail(event.target.value)} />
                </Field>
                <Field label="Магазин логотипа">
                  <Select value={logoStoreId || storeId || "__none__"} onValueChange={(value) => setLogoStoreId(value === "__none__" ? "" : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Текущий магазин</SelectItem>
                      {(logoGalleryQuery.data ?? []).map((logo) => (
                        <SelectItem key={logo.storeId} value={logo.storeId}>
                          {logo.storeName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Баннер по умолчанию"
                  hint="Применяет URL к выбранному или первому hero-блоку. Нужна прямая ссылка на файл изображения, а не страница сайта."
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
                      placeholder="https://cdn.example.com/banner.jpg"
                    />
                    <Button type="button" variant="secondary" onClick={() => applyDefaultBannerToCanvas()}>
                      Применить
                    </Button>
                  </div>
                  {!bannerUrlLooksDirect && bannerImageUrl.trim() ? (
                    <p className="text-xs leading-5 text-warning">
                      Ссылка похожа на страницу, а не на файл изображения. Для email лучше использовать URL, который заканчивается на .jpg, .png или .webp.
                    </p>
                  ) : null}
                </Field>
                <Field label="Логотип" hint="Показывается в блоках шапки, где включен логотип.">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 rounded-md border border-border bg-background p-2">
                      <PreviewImageFrame
                        src={selectedLogoUrl}
                        alt={selectedStore?.name ?? "Логотип"}
                        frameClassName="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                        imageClassName="max-h-full max-w-full object-contain"
                        fallback={<span className="text-xs text-muted-foreground">Нет логотипа</span>}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {selectedLogo?.storeName ?? selectedStore?.name ?? "Текущий магазин"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {selectedLogoUrl ? "Логотип выбран" : "Загрузите логотип для шапки письма"}
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
                      {uploadingLogo ? "Загрузка..." : selectedLogoUrl ? "Заменить логотип" : "Загрузить логотип"}
                    </Button>
                  </div>
                </Field>
              </section>
            </div>
          </aside>
        </div>

        <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="Предпросмотр" className="max-w-4xl">
          <div ref={previewContentRef} className="max-h-[70vh] overflow-auto rounded-md border border-border bg-white">
            {previewHtml ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="p-8 text-sm text-muted-foreground">Предпросмотр появится после сохранения полей.</div>
            )}
          </div>
        </Modal>

        <Modal open={testOpen} onOpenChange={setTestOpen} title="Отправить тест" className="max-w-lg">
          <div className="space-y-4">
            <Field label="Email">
              <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@example.com" />
            </Field>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setTestOpen(false)}>Отмена</Button>
              <Button
                type="button"
                disabled={!testEmail || testMutation.isLoading || testAutomationMutation.isLoading}
                onClick={async () => {
                  if (builderMode === "automation" && automationId) {
                    await saveCurrent();
                    testAutomationMutation.mutate({ automationId, to: testEmail });
                    return;
                  }
                  testMutation.mutate({ campaign: campaignInput, to: testEmail, sampleCustomerId: selectedCustomerIds[0] ?? null });
                }}
              >
                {testMutation.isLoading || testAutomationMutation.isLoading ? tCommon("loading") : "Отправить"}
              </Button>
            </ModalFooter>
          </div>
        </Modal>

        <Modal open={confirmOpen} onOpenChange={setConfirmOpen} title="Отправить кампанию?" className="max-w-xl">
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-6">
              <p><strong>Кампания:</strong> {campaignName}</p>
              <p><strong>Тема:</strong> {subject}</p>
              <p><strong>Получателей:</strong> {audienceSummary.validRecipients}</p>
              <p><strong>Отправитель:</strong> {selectedSender?.fromEmail ?? "Bazaar demo"}</p>
            </div>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>Отмена</Button>
              <Button type="button" disabled={!canSend || sendCampaignMutation.isLoading} onClick={() => void sendCurrentCampaign()}>
                {sendCampaignMutation.isLoading ? tCommon("loading") : "Подтвердить отправку"}
              </Button>
            </ModalFooter>
          </div>
	        </Modal>
	        <LogoFileInput
	          inputRef={logoInputRef}
	          onFile={(file) => void handleLogoUpload(file)}
	        />
	        {uploadingLogo ? <span className="sr-only">Загрузка логотипа</span> : null}
	        {confirmDialog}
	      </div>
	    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-12">
      <PageHeader
        title="Email-маркетинг"
        subtitle="Кампании, отправители и автоматические письма для клиентов выбранного магазина."
      />

      {!builderDesktopReady ? (
        <Card className="rounded-md border-warning/30 bg-warning/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <StatusPendingIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">Редактор писем доступен только на компьютере</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {builderUnavailableMessage}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {selectedStore?.name ?? "Выберите магазин"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {overviewQuery.data?.reachableCustomers ?? 0} клиентов доступны для рассылки.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[220px_auto_auto_auto]">
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger><SelectValue placeholder="Магазин" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
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
                  Создать кампанию
                </Button>
                <Button type="button" variant="secondary" onClick={() => setActiveTab("automations")}>
                  Автоматизация
                </Button>
                <Button type="button" variant="secondary" onClick={() => setActiveTab("senders")}>
                  Отправитель
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {sendersQuery.data?.senders.some((sender) => sender.status === "VERIFIED") ? (
                <StatusSuccessIcon className="mt-0.5 h-5 w-5 text-success" aria-hidden />
              ) : (
                <StatusPendingIcon className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
              )}
              <div>
                <p className="font-semibold">Отправители</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {sendersQuery.data?.senders.some((sender) => sender.status === "VERIFIED")
                    ? "Есть подтвержденный домен для брендированной отправки."
                    : "Добавьте домен и подтвердите DNS перед реальной отправкой."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Tabs>
        <TabsList className="flex max-w-full overflow-x-auto">
          {[
            ["campaigns", "Кампании"],
            ["automations", "Автоматизации"],
            ["senders", "Отправители"],
            ["templates", "Шаблоны"],
          ].map(([key, label]) => (
            <TabsTrigger key={key} active={activeTab === key} onClick={() => setActiveTab(key as TabKey)}>
              {label}
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
              onCheck={(domainId, triggerVerification) => checkDomainMutation.mutate({ domainId, triggerVerification })}
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
              onTest={(automationId) => testAutomationMutation.mutate({ automationId, to: testEmail })}
            />
          </TabsPanel>
        ) : null}

        {activeTab === "templates" ? (
          <TabsPanel>
            <Card className="rounded-md">
              <CardContent className="p-8 text-sm text-muted-foreground">
                Базовые шаблоны доступны при создании блоков. Отдельная библиотека шаблонов готова к расширению, но без фиктивных шаблонов.
              </CardContent>
            </Card>
          </TabsPanel>
        ) : null}
      </Tabs>

	      <LogoFileInput
	        inputRef={logoInputRef}
	        onFile={(file) => void handleLogoUpload(file)}
	      />
      {uploadingLogo ? <span className="sr-only">Загрузка логотипа</span> : null}
      {confirmDialog}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-md border border-border bg-background p-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);

const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <div className="grid grid-cols-[38px_minmax(0,1fr)] gap-2">
      <Input type="color" value={colorPattern.test(value) ? value : defaultBrandColor} onChange={(event) => onChange(event.target.value)} className="h-9 p-1" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-9" />
    </div>
  </div>
);

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
  const canPreview = useMemo(() => {
    if (!src) return false;
    if (typeof window === "undefined") return true;
    try {
      const imageUrl = new URL(src, window.location.href);
      const isLocalHost =
        imageUrl.hostname === "localhost" || imageUrl.hostname === "127.0.0.1";
      return !(isLocalHost && imageUrl.origin !== window.location.origin);
    } catch {
      return false;
    }
  }, [src]);
  useEffect(() => setFailed(false), [src]);

  return (
    <div className={frameClassName}>
      {canPreview && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
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
  products: Map<string, { name: string; description?: string | null; imageUrl?: string | null; priceText?: string | null }>;
  storeName?: string | null;
  logoUrl?: string | null;
  onLogoUploadClick?: () => void;
  onUpdate: (patch: Partial<CampaignBlock>) => void;
}) => {
  if (block.type === "header") {
    return (
      <div className="px-8 py-6">
        {block.showLogo === false ? null : (
          <button
            type="button"
            className="mb-3 block rounded-md outline-none transition hover:ring-2 hover:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={(event) => {
              event.stopPropagation();
              onLogoUploadClick?.();
            }}
            aria-label={logoUrl ? "Заменить логотип" : "Загрузить логотип"}
          >
            <PreviewImageFrame
              src={logoUrl}
              alt={storeName ?? "Логотип"}
              frameClassName="flex h-20 w-36 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted text-xs text-muted-foreground"
              imageClassName="max-h-full max-w-full object-contain"
              fallback={
                <span className="inline-flex items-center gap-2 px-3">
                  <ImagePlusIcon className="h-4 w-4" aria-hidden />
                  Загрузить логотип
                </span>
              }
            />
          </button>
        )}
        {block.showStoreName === false ? null : (
          <EditableText
            value={block.storeName ?? storeName}
            placeholder="Название магазина"
            selected={selected}
            className="text-lg font-bold"
            onChange={(storeName) => onUpdate({ storeName })}
          />
        )}
        <EditableText
          value={block.heading}
          placeholder="Дополнительный текст шапки"
          selected={selected}
          className="mt-2 text-sm"
          onChange={(heading) => onUpdate({ heading })}
        />
      </div>
    );
  }
  if (block.type === "hero") {
    return (
      <div className="px-8 py-6">
        <PreviewImageFrame
          src={block.imageUrl}
          alt=""
          frameClassName="mb-5 flex h-44 items-center justify-center overflow-hidden rounded-md bg-muted text-sm text-muted-foreground"
          imageClassName="h-full w-full object-cover"
          fallback={
            <>
              <ImagePlusIcon className="mr-2 h-4 w-4" aria-hidden />
              Изображение
            </>
          }
        />
        <EditableText
          value={block.heading}
          placeholder="Заголовок hero"
          selected={selected}
          className="text-3xl font-semibold leading-tight"
          onChange={(heading) => onUpdate({ heading })}
        />
        <EditableText
          value={block.subtitle}
          placeholder="Короткое описание"
          selected={selected}
          multiline
          className="mt-3 text-sm leading-6"
          onChange={(subtitle) => onUpdate({ subtitle })}
        />
        <EditableText
          value={block.buttonText}
          placeholder="Текст кнопки"
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
      <div className="px-8 py-5">
        <EditableText value={block.heading} placeholder="Заголовок" selected={selected} className="text-xl font-semibold" onChange={(heading) => onUpdate({ heading })} />
        <EditableText value={block.body} placeholder="Текст письма" selected={selected} multiline className="mt-2 whitespace-pre-wrap text-sm leading-6" onChange={(body) => onUpdate({ body })} />
      </div>
    );
  }
  if (block.type === "button") {
    return (
      <div className="px-8 py-5">
        <EditableText
          value={block.text}
          placeholder="Текст кнопки"
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
      <div className={cn("grid gap-3 px-6 py-5", block.layout === "one" ? "grid-cols-1" : "sm:grid-cols-2")}>
        {ids.length ? ids.map((id) => {
          const product = products.get(id);
          return (
            <div key={id} className="rounded-md border p-3" style={{ borderColor }}>
              {block.showImage === false ? null : (
                <PreviewImageFrame
                  src={product?.imageUrl}
                  alt={product?.name ?? ""}
                  frameClassName="flex h-32 items-center justify-center overflow-hidden rounded-md bg-muted"
                  imageClassName="h-full w-full object-cover"
                  fallback={<span className="text-xs text-muted-foreground">Фото товара</span>}
                />
              )}
              <p className="mt-3 truncate font-semibold">{product?.name ?? id}</p>
              {block.showDescription === false || !product?.description ? null : (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {product.description}
                </p>
              )}
              {block.showPrice === false ? null : (
                <p className="text-sm text-muted-foreground">{product?.priceText ?? "Цена не указана"}</p>
              )}
              {block.showButton === false ? null : (
                <span className="mt-3 inline-flex rounded-md px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: buttonColor, color: buttonTextColor }}>
                  {block.buttonText || "Подробнее"}
                </span>
              )}
            </div>
          );
        }) : (
          <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Выберите товары в настройках блока.
          </div>
        )}
      </div>
    );
  }
  if (block.type === "orderSummary") {
    const summaryText = block.summaryText ?? "Заказ {{orderNumber}} · {{orderStatus}}";
    const itemsLabel = block.itemsLabel ?? "Товары";
    const totalLabel = block.totalLabel ?? "Итого";
    const quantitySeparator = block.quantitySeparator ?? "×";
    const sampleItemName = block.sampleItemName ?? "Товар";
    return (
      <div className="px-8 py-5">
        <div className="rounded-md border p-4" style={{ borderColor }}>
          <EditableText value={block.title} placeholder="Состав заказа" selected={selected} className="font-semibold" onChange={(title) => onUpdate({ title })} />
          {block.showSummary === false ? null : (
            <EditableText
              value={summaryText}
              placeholder="Заказ {{orderNumber}} · {{orderStatus}}"
              selected={selected}
              className="mt-2 text-sm text-muted-foreground"
              onChange={(nextSummaryText) => onUpdate({ summaryText: nextSummaryText })}
            />
          )}
          {block.showItems === false ? null : (
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <EditableText
                value={itemsLabel}
                placeholder="Товары"
                selected={selected}
                className="text-xs font-semibold uppercase tracking-wide"
                onChange={(nextItemsLabel) => onUpdate({ itemsLabel: nextItemsLabel })}
              />
              <div className="flex justify-between gap-4">
                <span className="min-w-0">
                  <EditableText
                    value={sampleItemName}
                    placeholder="Товар"
                    selected={selected}
                    className="inline"
                    onChange={(nextSampleItemName) => onUpdate({ sampleItemName: nextSampleItemName })}
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
                placeholder="Итого"
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
        <div className="rounded-md border p-5" style={{ borderColor: brandColor, backgroundColor: "#f9fafb" }}>
          <EditableText value={block.title} placeholder="Название акции" selected={selected} className="text-xl font-semibold" onChange={(title) => onUpdate({ title })} />
          <EditableText value={block.discountCode} placeholder="Промокод" selected={selected} className="mt-3 inline-flex border border-dashed px-3 py-2 font-bold" onChange={(discountCode) => onUpdate({ discountCode })} />
          <EditableText value={block.description} placeholder="Описание акции" selected={selected} multiline className="mt-3 text-sm leading-6" onChange={(description) => onUpdate({ description })} />
          <EditableText value={block.expiryText} placeholder="Срок действия" selected={selected} className="mt-2 text-xs text-muted-foreground" onChange={(expiryText) => onUpdate({ expiryText })} />
          <EditableText
            value={block.buttonText}
            placeholder="Текст кнопки"
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
    return <div className="px-8 py-4"><div className="border-t" style={{ borderColor }} /></div>;
  }
  return (
    <div className="border-t px-8 py-5 text-xs leading-5" style={{ borderColor, color: mutedTextColor }}>
      <EditableText value={block.storeName} placeholder="Название магазина" selected={selected} className="mb-2 font-semibold" onChange={(storeName) => onUpdate({ storeName })} />
      <EditableText value={block.text} placeholder="Текст подвала" selected={selected} multiline onChange={(text) => onUpdate({ text })} />
      {block.showUnsubscribe === false ? null : (
        <EditableText value={block.unsubscribeText} placeholder="Текст ссылки отписки" selected={selected} className="mt-2 underline" onChange={(unsubscribeText) => onUpdate({ unsubscribeText })} />
      )}
    </div>
  );
};

const BlockSettings = ({
  block,
  products,
  update,
}: {
  block: CampaignBlock;
  products: Array<{ id: string; name: string; imageUrl?: string | null; priceText?: string | null; hasImage?: boolean }>;
  update: (patch: Partial<CampaignBlock>) => void;
}) => {
  if (block.type === "header") {
    return (
      <div className="space-y-3">
        <Field label="Название магазина">
          <Input
            value={block.storeName ?? ""}
            onChange={(event) => update({ storeName: event.target.value })}
            placeholder="Например, Avantehnik"
          />
        </Field>
        <Field label="Текст шапки">
          <Input
            value={block.heading ?? ""}
            onChange={(event) => update({ heading: event.target.value })}
            placeholder="Короткое приветствие"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showStoreName ?? true} onChange={(event) => update({ showStoreName: event.target.checked })} />Показывать магазин</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showLogo ?? true} onChange={(event) => update({ showLogo: event.target.checked })} />Показывать логотип</label>
      </div>
    );
  }
  if (block.type === "hero") {
    return (
      <div className="space-y-3">
        <Field label="Заголовок">
          <Input value={block.heading ?? ""} onChange={(event) => update({ heading: event.target.value })} />
        </Field>
        <Field label="Описание">
          <Textarea value={block.subtitle ?? ""} onChange={(event) => update({ subtitle: event.target.value })} rows={4} />
        </Field>
        <Field label="URL изображения"><Input value={block.imageUrl ?? ""} onChange={(event) => update({ imageUrl: event.target.value })} placeholder="https://..." /></Field>
        <Field label="Текст кнопки"><Input value={block.buttonText ?? ""} onChange={(event) => update({ buttonText: event.target.value })} /></Field>
        <Field label="Ссылка кнопки"><Input value={block.buttonUrl ?? ""} onChange={(event) => update({ buttonUrl: event.target.value })} /></Field>
      </div>
    );
  }
  if (block.type === "text") {
    return (
      <div className="space-y-3">
        <Field label="Заголовок">
          <Input value={block.heading ?? ""} onChange={(event) => update({ heading: event.target.value })} />
        </Field>
        <Field label="Текст">
          <Textarea value={block.body ?? ""} onChange={(event) => update({ body: event.target.value })} rows={6} />
        </Field>
      </div>
    );
  }
  if (block.type === "button") {
    return (
      <div className="space-y-3">
        <Field label="Текст кнопки">
          <Input value={block.text ?? ""} onChange={(event) => update({ text: event.target.value })} />
        </Field>
        <Field label="Ссылка">
          <Input value={block.url ?? ""} onChange={(event) => update({ url: event.target.value })} placeholder="https://..." />
        </Field>
      </div>
    );
  }
  if (block.type === "products") {
    const selected = new Set(block.productIds ?? []);
    const selectedProducts = products.filter((product) => selected.has(product.id));
    return (
      <div className="space-y-3">
        {selectedProducts.length ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
            <p className="text-xs font-semibold text-muted-foreground">Выбранные товары</p>
            {selectedProducts.map((product) => (
              <div key={product.id} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1.5 text-sm">
                <span className="min-w-0 truncate">{product.name}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-danger hover:text-danger"
                  onClick={() => update({ productIds: (block.productIds ?? []).filter((id) => id !== product.id) })}
                  aria-label={`Убрать ${product.name}`}
                >
                  <DeleteIcon className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              className={cn("flex w-full gap-3 rounded-md border p-2 text-left text-sm", selected.has(product.id) ? "border-primary bg-primary/5" : "border-border")}
              onClick={() => {
                const ids = block.productIds ?? [];
                update({
                  productIds: ids.includes(product.id)
                    ? ids.filter((id) => id !== product.id)
                    : [...ids, product.id].slice(0, 12),
                });
              }}
            >
              <PreviewImageFrame
                src={product.imageUrl}
                alt={product.name}
                frameClassName="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
                imageClassName="h-full w-full object-cover"
                fallback={<span className="text-[10px] text-muted-foreground">Фото</span>}
              />
              <span className="min-w-0"><span className="block truncate font-semibold">{product.name}</span><span className="text-xs text-muted-foreground">{product.priceText ?? "Нет цены"}</span></span>
            </button>
          ))}
          {!products.length ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Товары магазина не найдены.
            </div>
          ) : null}
        </div>
        <Field label="Макет">
          <Select value={block.layout ?? "two"} onValueChange={(value) => update({ layout: value as "one" | "two" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="one">Один товар в ряд</SelectItem>
              <SelectItem value="two">Два товара в ряд</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showImage ?? true} onChange={(event) => update({ showImage: event.target.checked })} />Показывать фото</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showPrice ?? true} onChange={(event) => update({ showPrice: event.target.checked })} />Показывать цену</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showDescription ?? true} onChange={(event) => update({ showDescription: event.target.checked })} />Показывать описание</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showButton ?? true} onChange={(event) => update({ showButton: event.target.checked })} />Показывать кнопку</label>
        <Field label="Текст кнопки"><Input value={block.buttonText ?? ""} onChange={(event) => update({ buttonText: event.target.value })} /></Field>
        <Field label="Общая ссылка"><Input value={block.buttonUrl ?? ""} onChange={(event) => update({ buttonUrl: event.target.value })} /></Field>
      </div>
    );
  }
  if (block.type === "orderSummary") {
    return (
      <div className="space-y-3">
        <Field label="Заголовок">
          <Input value={block.title ?? ""} onChange={(event) => update({ title: event.target.value })} />
        </Field>
        <Field
          label="Строка заказа"
          hint="Можно использовать {{orderNumber}}, {{orderStatus}}, {{orderPreviousStatus}}, {{orderTotal}}."
        >
          <Textarea
            value={block.summaryText ?? ""}
            onChange={(event) => update({ summaryText: event.target.value })}
            placeholder="Заказ {{orderNumber}} · {{orderStatus}}"
            rows={3}
          />
        </Field>
        <Field label="Подпись товаров">
          <Input value={block.itemsLabel ?? ""} onChange={(event) => update({ itemsLabel: event.target.value })} />
        </Field>
        <Field label="Название товара в предпросмотре">
          <Input
            value={block.sampleItemName ?? ""}
            onChange={(event) => update({ sampleItemName: event.target.value })}
            placeholder="Товар"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Разделитель количества">
            <Input
              value={block.quantitySeparator ?? ""}
              onChange={(event) => update({ quantitySeparator: event.target.value })}
              placeholder="×"
            />
          </Field>
          <Field label="Подпись итога">
            <Input value={block.totalLabel ?? ""} onChange={(event) => update({ totalLabel: event.target.value })} />
          </Field>
        </div>
        <Field label="Текст без данных заказа">
          <Textarea
            value={block.emptyOrderText ?? ""}
            onChange={(event) => update({ emptyOrderText: event.target.value })}
            rows={3}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showSummary ?? true} onChange={(event) => update({ showSummary: event.target.checked })} />Показывать строку заказа</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showItems ?? true} onChange={(event) => update({ showItems: event.target.checked })} />Показывать товары</label>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showTotals ?? true} onChange={(event) => update({ showTotals: event.target.checked })} />Показывать итог</label>
      </div>
    );
  }
  if (block.type === "promo") {
    return (
      <div className="space-y-3">
        <Field label="Название акции"><Input value={block.title ?? ""} onChange={(event) => update({ title: event.target.value })} /></Field>
        <Field label="Промокод"><Input value={block.discountCode ?? ""} onChange={(event) => update({ discountCode: event.target.value })} /></Field>
        <Field label="Описание"><Textarea value={block.description ?? ""} onChange={(event) => update({ description: event.target.value })} rows={4} /></Field>
        <Field label="Срок действия"><Input value={block.expiryText ?? ""} onChange={(event) => update({ expiryText: event.target.value })} /></Field>
        <Field label="Текст кнопки"><Input value={block.buttonText ?? ""} onChange={(event) => update({ buttonText: event.target.value })} /></Field>
        <Field label="Ссылка кнопки"><Input value={block.buttonUrl ?? ""} onChange={(event) => update({ buttonUrl: event.target.value })} /></Field>
      </div>
    );
  }
  if (block.type === "footer") {
    return (
      <div className="space-y-3">
        <Field label="Название магазина"><Input value={block.storeName ?? ""} onChange={(event) => update({ storeName: event.target.value })} /></Field>
        <Field label="Текст подвала"><Textarea value={block.text ?? ""} onChange={(event) => update({ text: event.target.value })} rows={4} /></Field>
        <Field label="Телефон"><Input value={block.phone ?? ""} onChange={(event) => update({ phone: event.target.value })} /></Field>
        <Field label="Адрес"><Input value={block.address ?? ""} onChange={(event) => update({ address: event.target.value })} /></Field>
        <Field label="Текст отписки"><Input value={block.unsubscribeText ?? ""} onChange={(event) => update({ unsubscribeText: event.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input className={checkboxClass} type="checkbox" checked={block.showUnsubscribe ?? true} onChange={(event) => update({ showUnsubscribe: event.target.checked })} />Показывать отписку</label>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">У блока нет дополнительных настроек.</p>;
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
  customers: Array<{ id: string; name: string; email: string | null; hasValidEmail: boolean; isUnsubscribed: boolean }>;
  queryLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  selectedIds: string[];
  setSelectedIds: (value: string[]) => void;
  page: number;
  setPage: (value: number) => void;
  total: number;
}) => {
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск клиента" />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {customers.map((customer) => {
          const disabled = !customer.hasValidEmail || customer.isUnsubscribed;
          return (
            <label key={customer.id} className={cn("flex cursor-pointer items-center gap-3 border-b border-border p-2 text-sm last:border-b-0", disabled && "cursor-not-allowed opacity-60")}>
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
              <span className="min-w-0"><span className="block truncate font-semibold">{customer.name}</span><span className="block truncate text-xs text-muted-foreground">{customer.email ?? "Нет email"}</span></span>
            </label>
          );
        })}
        {queryLoading ? <p className="p-3 text-sm text-muted-foreground">Загрузка...</p> : null}
        {!queryLoading && !customers.length ? <p className="p-3 text-sm text-muted-foreground">Клиенты не найдены.</p> : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Выбрано: {selectedIds.length}</span>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="secondary" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeftIcon className="h-4 w-4" /></Button>
          <span>{page}</span>
          <Button type="button" size="icon" variant="secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}><ChevronRightIcon className="h-4 w-4" /></Button>
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
}) => (
  <Card className="rounded-md">
    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <CardTitle>Кампании</CardTitle>
        {!builderAvailable ? (
          <p className="mt-1 text-sm text-muted-foreground">Создание и редактирование доступны с компьютера.</p>
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
        Создать кампанию
      </Button>
    </CardHeader>
    <CardContent>
      {campaigns.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="rounded-md border border-border bg-background p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{campaign.name}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{campaign.subject}</p>
                </div>
                <Badge variant={campaignStatusVariant(campaign.status)}>{campaignStatusLabel(campaign.status)}</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <Metric label="Аудитория" value={campaign.recipientCount} />
                <Metric label="Отправлено" value={campaign.sentCount} />
                <Metric label="Ошибки" value={campaign.failedCount} />
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs text-muted-foreground">
                  <p className="truncate">{campaign.senderIdentity?.fromEmail ?? "Bazaar demo"}</p>
                  <p>{formatDateTime(campaign.updatedAt ?? campaign.createdAt, locale)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onEdit(campaign)}
                    disabled={!builderAvailable}
                    title={!builderAvailable ? builderUnavailableMessage : undefined}
                  >
                    <EditIcon className="h-4 w-4" aria-hidden />
                    Редактировать
                  </Button>
                  <ActionMenu>
                    <ActionMenuItem onSelect={() => onDuplicate(campaign.id)}>Дублировать</ActionMenuItem>
                    <ActionMenuItem onSelect={() => onArchive(campaign.id)}>Архивировать</ActionMenuItem>
                    {campaign.status === EmailCampaignStatus.DRAFT ? (
                      <ActionMenuItem onSelect={() => onDelete(campaign.id)} className="text-danger">Удалить</ActionMenuItem>
                    ) : null}
                  </ActionMenu>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <SparklesIcon className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-semibold">{loading ? "Загрузка..." : "Кампаний пока нет"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Создайте первую рассылку из блоков и товаров магазина.</p>
          <Button
            type="button"
            className="mt-4"
            onClick={onCreate}
            disabled={!builderAvailable}
            title={!builderAvailable ? builderUnavailableMessage : undefined}
          >
            Создать кампанию
          </Button>
        </div>
      )}
    </CardContent>
  </Card>
);

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

const CopyDnsValue = ({
  value,
  label,
}: {
  value: string;
  label: string;
}) => {
  const [copied, setCopied] = useState(false);
  const disabled = !value.trim();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("h-7 w-7 shrink-0", copied && "text-success")}
      disabled={disabled}
      aria-label={copied ? "Скопировано" : label}
      title={copied ? "Скопировано" : label}
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
    defaultSender: { fromEmail: string; status: string; demoOnly: boolean };
    domains: Array<{ id: string; domain: string; status: string; recordsJson: unknown; lastCheckedAt: Date | null; errorMessage: string | null }>;
    senders: Array<{ id: string; displayName: string; fromEmail: string; replyToEmail: string | null; status: string; domainId: string | null }>;
  };
  loading: boolean;
  form: { displayName: string; fromEmail: string; replyToEmail: string };
  setForm: (form: { displayName: string; fromEmail: string; replyToEmail: string }) => void;
  onCreate: () => void;
  creating: boolean;
  onCheck: (domainId: string, triggerVerification: boolean) => void;
  checking: boolean;
  onArchive: (senderId: string) => void;
}) => (
  <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
    <Card className="rounded-md">
      <CardHeader><CardTitle>Настроить отправителя</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Field label="Имя отправителя"><Input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Avantehnik" /></Field>
        <Field label="From email" hint="Адрес должен принадлежать домену, который вы подтвердите через DNS.">
          <Input value={form.fromEmail} onChange={(event) => setForm({ ...form, fromEmail: event.target.value })} placeholder="news@example.kg" />
        </Field>
        <Field label="Reply-to"><Input value={form.replyToEmail} onChange={(event) => setForm({ ...form, replyToEmail: event.target.value })} placeholder="support@example.kg" /></Field>
        <Button type="button" className="w-full" disabled={creating || !form.displayName || !form.fromEmail} onClick={onCreate}>
          {creating ? <Spinner className="h-4 w-4" /> : <AddIcon className="h-4 w-4" aria-hidden />}
          Добавить отправителя
        </Button>
      </CardContent>
    </Card>
    <div className="space-y-4">
      <Card className="rounded-md">
        <CardHeader><CardTitle>Отправители</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data?.defaultSender ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Bazaar demo</p>
                  <p className="text-sm text-muted-foreground">{data.defaultSender.fromEmail}</p>
                </div>
                <Badge variant="muted">Демо</Badge>
              </div>
            </div>
          ) : null}
          {(data?.senders ?? []).map((sender) => (
            <div key={sender.id} className="rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{sender.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">{sender.fromEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={sender.status === "VERIFIED" ? "success" : sender.status === "FAILED" ? "danger" : "warning"}>{senderStatusLabel(sender.status)}</Badge>
                  <Button type="button" size="icon" variant="ghost" onClick={() => onArchive(sender.id)} aria-label="Архивировать"><ArchiveIcon className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ))}
          {!loading && !(data?.senders ?? []).length ? <p className="text-sm text-muted-foreground">Брендированных отправителей пока нет.</p> : null}
        </CardContent>
      </Card>
      <Card className="rounded-md">
        <CardHeader><CardTitle>Домены и DNS</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(data?.domains ?? []).map((domain) => {
            const records = Array.isArray(domain.recordsJson) ? domain.recordsJson as Array<Record<string, unknown>> : [];
            const dmarcName = "_dmarc";
            const dmarcValue = `v=DMARC1; p=none; rua=mailto:postmaster@${domain.domain}`;
            return (
              <div key={domain.id} className="rounded-md border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{domain.domain}</p>
                    <p className="text-xs text-muted-foreground">{domain.lastCheckedAt ? `Проверен: ${formatDateTime(domain.lastCheckedAt, "ru")}` : "Еще не проверялся"}</p>
                  </div>
                  <Badge variant={domain.status === "VERIFIED" ? "success" : domain.status === "FAILED" ? "danger" : "warning"}>{senderStatusLabel(domain.status)}</Badge>
                </div>
                <div className="mt-3 overflow-auto rounded-md border border-border">
                  <table className="min-w-[820px] text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground"><tr><th className="w-[90px] p-2">Тип</th><th className="w-[260px] p-2">Имя</th><th className="p-2">Значение</th><th className="w-[140px] p-2">Статус</th></tr></thead>
                    <tbody>
                      {records.map((record, index) => {
                        const name = String(record.name ?? "");
                        const value = String(record.value ?? "");
                        return (
                          <tr key={index} className="border-t border-border">
                            <td className="p-2">{String(record.type ?? "")}</td>
                            <td className="p-2">
                              <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
                                <code className="truncate font-mono" title={name}>{name}</code>
                                <CopyDnsValue value={name} label="Скопировать имя записи" />
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
                                <code className="truncate font-mono" title={value}>{value}</code>
                                <CopyDnsValue value={value} label="Скопировать значение записи" />
                              </div>
                            </td>
                            <td className="p-2">{String(record.status ?? "")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Рекомендуется добавить DMARC TXT</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-md bg-background px-2 py-1.5">
                      <code className="truncate text-xs" title={dmarcName}>{dmarcName}</code>
                      <CopyDnsValue value={dmarcName} label="Скопировать имя DMARC" />
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-md bg-background px-2 py-1.5">
                      <code className="truncate text-xs" title={dmarcValue}>{dmarcValue}</code>
                      <CopyDnsValue value={dmarcValue} label="Скопировать значение DMARC" />
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={checking} onClick={() => onCheck(domain.id, false)}>Проверить DNS</Button>
                  <Button type="button" size="sm" disabled={checking} onClick={() => onCheck(domain.id, true)}>Запустить проверку</Button>
                </div>
              </div>
            );
          })}
          {!loading && !(data?.domains ?? []).length ? <p className="text-sm text-muted-foreground">Добавьте отправителя, чтобы получить DNS записи Resend.</p> : null}
        </CardContent>
      </Card>
    </div>
  </div>
);

const AutomationsPanel = ({
  automations,
  loading,
  senders,
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
  builderAvailable: boolean;
  onEdit: (automation: AutomationDashboardItem) => void;
  onToggle: (automation: AutomationDashboardItem) => void;
  onSender: (automationId: string, value: string) => void;
  testEmail: string;
  setTestEmail: (value: string) => void;
  onTest: (automationId: string) => void;
}) => (
  <div className="grid gap-4 xl:grid-cols-2">
    {automations.map((automation) => (
      <Card key={automation.id} className="rounded-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{triggerLabel(automation.trigger)}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{automation.subject}</p>
            </div>
            <Badge variant={automation.status === EmailAutomationStatus.ACTIVE ? "success" : "muted"}>{automationStatusLabel(automation.status)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric label="Отправлено" value={automation.sentCount} />
            <Metric label="Ошибки" value={automation.failedCount} />
            <div className="rounded-md border border-border bg-background p-2">
              <p className="text-xs text-muted-foreground">Последний запуск</p>
              <p className="mt-1 truncate text-xs font-semibold">{automation.lastTriggeredAt ? formatDateTime(automation.lastTriggeredAt, "ru") : "Нет"}</p>
            </div>
          </div>
          <Field label="Отправитель">
            <Select value={automation.senderIdentityId ?? "__none__"} onValueChange={(value) => onSender(automation.id, value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Не выбран</SelectItem>
                {senders.map((sender) => (
                  <SelectItem key={sender.id} value={sender.id} disabled={sender.status !== "VERIFIED"}>{sender.displayName} · {sender.fromEmail}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@example.com" />
            <Button type="button" variant="secondary" disabled={!testEmail} onClick={() => onTest(automation.id)}>Тест</Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onEdit(automation)}
              disabled={!builderAvailable}
              title={!builderAvailable ? builderUnavailableMessage : undefined}
            >
              Редактировать письмо
            </Button>
            <Button type="button" onClick={() => onToggle(automation)}>{automation.status === EmailAutomationStatus.ACTIVE ? "Пауза" : "Активировать"}</Button>
          </div>
          {!builderAvailable ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Редактирование письма доступно только с компьютера.
            </p>
          ) : null}
        </CardContent>
      </Card>
    ))}
    {!loading && !automations.length ? (
      <Card className="rounded-md xl:col-span-2"><CardContent className="p-8 text-sm text-muted-foreground">Автоматизации будут созданы после выбора магазина.</CardContent></Card>
    ) : null}
  </div>
);
