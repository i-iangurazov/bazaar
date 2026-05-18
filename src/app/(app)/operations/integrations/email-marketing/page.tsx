"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CustomerSource,
  EmailCampaignFontFamily,
  EmailCampaignStatus,
  EmailCampaignTemplate,
} from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";

import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DeleteIcon,
  DesktopPreviewIcon,
  MobilePreviewIcon,
  SearchIcon,
  SelectAllIcon,
  SparklesIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
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
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

type AudienceMode = "manual" | "segment";
type AudienceSegment = "all" | "new" | "source" | "withPurchases" | "withoutPurchases";
type TemplateKey =
  | "blank"
  | "new_products"
  | "discount"
  | "back_in_stock"
  | "thank_you"
  | "announcement";

type CampaignBlock =
  | {
      id: string;
      type: "header";
      showStoreName?: boolean;
      showLogo?: boolean;
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
      showButton?: boolean;
      buttonText?: string | null;
      buttonUrl?: string | null;
      layout?: "one" | "two";
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

const templateLabels: Record<TemplateKey, string> = {
  blank: "Пустое письмо",
  new_products: "Новинки",
  discount: "Скидка",
  back_in_stock: "Снова в наличии",
  thank_you: "Спасибо за покупку",
  announcement: "Объявление магазина",
};

const blockLabels: Record<CampaignBlock["type"], string> = {
  header: "Шапка",
  hero: "Баннер",
  text: "Текст",
  button: "Кнопка",
  products: "Товары",
  promo: "Промо",
  divider: "Разделитель",
  footer: "Подвал",
};

const uid = () => Math.random().toString(36).slice(2, 10);

const defaultBlocks = (storeName?: string | null): CampaignBlock[] => [
  {
    id: "default-header",
    type: "header",
    showStoreName: true,
    showLogo: true,
    heading: storeName ?? "",
  },
  {
    id: "default-text",
    type: "text",
    heading: "Здравствуйте, {{customerName}}!",
    body: "Напишите короткое сообщение для клиентов.",
  },
  {
    id: "default-footer",
    type: "footer",
    text: "Вы получили это письмо, потому что ваш email есть в базе клиентов магазина.",
    unsubscribeText: "Для отписки свяжитесь с магазином.",
    showUnsubscribe: true,
  },
];

const templateBlocks = (
  key: TemplateKey,
  storeName?: string | null,
): { subject: string; preheader: string; blocks: CampaignBlock[] } => {
  if (key === "discount") {
    return {
      subject: "Скидка на товары в магазине",
      preheader: "Специальное предложение для клиентов.",
      blocks: [
        {
          id: `header-${uid()}`,
          type: "header",
          showStoreName: true,
          showLogo: true,
          heading: storeName ?? "",
        },
        {
          id: `hero-${uid()}`,
          type: "hero",
          heading: "Скидка на избранные товары",
          subtitle: "Выберите товары по специальной цене.",
          buttonText: "Смотреть товары",
          buttonUrl: "",
        },
        {
          id: `promo-${uid()}`,
          type: "promo",
          title: "Скидка 15%",
          discountCode: "SALE15",
          description: "Покажите этот код при покупке.",
          expiryText: "Предложение действует ограниченное время.",
        },
        {
          id: `products-${uid()}`,
          type: "products",
          productIds: [],
          showImage: true,
          showPrice: true,
          showButton: true,
          buttonText: "Подробнее",
          layout: "two",
        },
        {
          id: `footer-${uid()}`,
          type: "footer",
          text: "Убедитесь, что у вас есть согласие клиентов на рассылку.",
          unsubscribeText: "Для отписки свяжитесь с магазином.",
          showUnsubscribe: true,
        },
      ],
    };
  }
  if (key === "new_products") {
    return {
      subject: "Новинки уже в продаже",
      preheader: "Посмотрите новые товары в магазине.",
      blocks: [
        {
          id: `header-${uid()}`,
          type: "header",
          showStoreName: true,
          showLogo: true,
          heading: storeName ?? "",
        },
        {
          id: `text-${uid()}`,
          type: "text",
          heading: "Новые поступления",
          body: "Мы добавили новые товары, которые могут вам понравиться.",
        },
        {
          id: `products-${uid()}`,
          type: "products",
          productIds: [],
          showImage: true,
          showPrice: true,
          showButton: true,
          buttonText: "Подробнее",
          layout: "two",
        },
        {
          id: `footer-${uid()}`,
          type: "footer",
          unsubscribeText: "Для отписки свяжитесь с магазином.",
          showUnsubscribe: true,
        },
      ],
    };
  }
  if (key === "back_in_stock") {
    return {
      subject: "Товары снова в наличии",
      preheader: "Популярные товары вернулись.",
      blocks: [
        { id: `header-${uid()}`, type: "header", showStoreName: true, showLogo: true },
        {
          id: `text-${uid()}`,
          type: "text",
          heading: "Снова в наличии",
          body: "Популярные позиции снова доступны в магазине.",
        },
        {
          id: `products-${uid()}`,
          type: "products",
          productIds: [],
          showImage: true,
          showPrice: true,
          showButton: true,
          buttonText: "Купить",
          layout: "two",
        },
        {
          id: `footer-${uid()}`,
          type: "footer",
          unsubscribeText: "Для отписки свяжитесь с магазином.",
          showUnsubscribe: true,
        },
      ],
    };
  }
  if (key === "thank_you") {
    return {
      subject: "Спасибо за покупку",
      preheader: "Благодарим вас за выбор нашего магазина.",
      blocks: [
        { id: `header-${uid()}`, type: "header", showStoreName: true, showLogo: true },
        {
          id: `text-${uid()}`,
          type: "text",
          heading: "Спасибо, {{customerName}}!",
          body: "Спасибо за покупку. Мы будем рады видеть вас снова.",
        },
        { id: `button-${uid()}`, type: "button", text: "Связаться с магазином", url: "" },
        {
          id: `footer-${uid()}`,
          type: "footer",
          unsubscribeText: "Для отписки свяжитесь с магазином.",
          showUnsubscribe: true,
        },
      ],
    };
  }
  if (key === "announcement") {
    return {
      subject: "Объявление магазина",
      preheader: "Важное обновление от магазина.",
      blocks: [
        { id: `header-${uid()}`, type: "header", showStoreName: true, showLogo: true },
        {
          id: `hero-${uid()}`,
          type: "hero",
          heading: "Важное объявление",
          subtitle: "Расскажите клиентам о новости, графике или изменении.",
          buttonText: "Подробнее",
          buttonUrl: "",
        },
        {
          id: `footer-${uid()}`,
          type: "footer",
          unsubscribeText: "Для отписки свяжитесь с магазином.",
          showUnsubscribe: true,
        },
      ],
    };
  }
  return {
    subject: "",
    preheader: "",
    blocks: defaultBlocks(storeName),
  };
};

const blockHasContent = (block: CampaignBlock) => {
  if (block.type === "text") {
    return Boolean(block.heading?.trim() || block.body?.trim());
  }
  if (block.type === "products") {
    return Boolean(block.productIds?.length);
  }
  if (block.type === "hero") {
    return Boolean(block.heading?.trim() || block.subtitle?.trim() || block.imageUrl?.trim());
  }
  if (block.type === "button") {
    return Boolean(block.text?.trim() && block.url?.trim());
  }
  return true;
};

const campaignStatusLabel = (status: EmailCampaignStatus) => {
  switch (status) {
    case EmailCampaignStatus.DRAFT:
      return "Черновик";
    case EmailCampaignStatus.SENDING:
      return "Отправляется";
    case EmailCampaignStatus.SENT:
      return "Отправлено";
    case EmailCampaignStatus.PARTIAL:
      return "Частично";
    case EmailCampaignStatus.FAILED:
      return "Ошибка";
    default:
      return status;
  }
};

const parseBlocks = (value: unknown, fallbackBody?: string | null): CampaignBlock[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is CampaignBlock => {
      return Boolean(item) && typeof item === "object" && "type" in item && "id" in item;
    });
  }
  return [
    {
      id: `text-${uid()}`,
      type: "text",
      body: fallbackBody ?? "",
    },
    {
      id: `footer-${uid()}`,
      type: "footer",
      unsubscribeText: "Для отписки свяжитесь с магазином.",
      showUnsubscribe: true,
    },
  ];
};

const blockTypeOptions = [
  "header",
  "hero",
  "text",
  "button",
  "products",
  "promo",
  "divider",
  "footer",
] as const;

const sectionCardClass =
  "scroll-mt-24 overflow-hidden rounded-md border-border/80 bg-card shadow-sm";
const sectionHeaderClass = "bg-muted/20 px-4 py-3 sm:px-5 sm:py-3";
const sectionContentClass = "space-y-4 px-4 py-4 sm:px-5";
const statCardClass = "rounded-md border border-border bg-background p-3 shadow-sm";
const audienceMetricClass = "rounded-md border border-border bg-muted/20 px-3 py-2";
const stepTitleClass = "flex items-center gap-2 text-base";
const stepNumberClass =
  "inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground";
const defaultEmailBrandColor = "#1d4ed8";
const defaultButtonTextColor = "#ffffff";
const defaultEmailBackgroundColor = "#f3f4f6";
const defaultEmailContentBackgroundColor = "#ffffff";
const defaultEmailTextColor = "#111827";
const defaultEmailMutedTextColor = "#4b5563";
const defaultEmailBorderColor = "#e5e7eb";
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const checkboxClass =
  "h-5 w-5 shrink-0 rounded-md border border-border text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const fontFamilyLabels: Record<EmailCampaignFontFamily, string> = {
  INTER: "Inter",
  JOST: "Jost",
  SYSTEM: "Системный",
  NOTO_SANS: "Noto Sans",
  ROBOTO: "Roboto",
  OPEN_SANS: "Open Sans",
  MONTSERRAT: "Montserrat",
  LATO: "Lato",
  PT_SANS: "PT Sans",
  SOURCE_SANS_3: "Source Sans 3",
  MANROPE: "Manrope",
};

const fontFamilyValues = Object.keys(fontFamilyLabels) as EmailCampaignFontFamily[];

const checkboxLabelClass = "flex min-w-0 items-center gap-3 text-sm font-medium text-foreground";

const applyBannerImageToBlocks = (blocks: CampaignBlock[], imageUrl: string) => {
  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) {
    return blocks;
  }
  const heroIndex = blocks.findIndex((block) => block.type === "hero");
  if (heroIndex >= 0) {
    return blocks.map((block, index) =>
      index === heroIndex && block.type === "hero"
        ? { ...block, imageUrl: trimmedImageUrl }
        : block,
    );
  }
  const insertIndex = blocks[0]?.type === "header" ? 1 : 0;
  const next = [...blocks];
  next.splice(insertIndex, 0, {
    id: `hero-${uid()}`,
    type: "hero",
    imageUrl: trimmedImageUrl,
    heading: "Новость магазина",
    subtitle: "Расскажите клиентам о предложении или обновлении.",
    buttonText: "",
    buttonUrl: "",
  });
  return next;
};

const CheckboxField = ({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) => (
  <label className={cn(checkboxLabelClass, disabled && "opacity-60")}>
    <input
      type="checkbox"
      className={checkboxClass}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="min-w-0">{label}</span>
  </label>
);

const ThemeColorField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <Input
        type="color"
        value={colorPattern.test(value) ? value : defaultEmailBrandColor}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 p-1"
        aria-label={label}
      />
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  </div>
);

const EmailMarketingPage = () => {
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [storeId, setStoreId] = useState("");
  const [logoStoreId, setLogoStoreId] = useState("");
  const [brandColor, setBrandColor] = useState(defaultEmailBrandColor);
  const [buttonColor, setButtonColor] = useState(defaultEmailBrandColor);
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
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [senderDisplayName, setSenderDisplayName] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [templateKey, setTemplateKey] = useState<TemplateKey>("blank");
  const [blocks, setBlocks] = useState<CampaignBlock[]>(defaultBlocks());
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("manual");
  const [audienceSegment, setAudienceSegment] = useState<AudienceSegment>("all");
  const [source, setSource] = useState<"ALL" | CustomerSource>("ALL");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(25);
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("ALL");
  const [testEmail, setTestEmail] = useState("");
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);

  const storesQuery = trpc.stores.list.useQuery();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const logoGalleryQuery = trpc.emailMarketing.logoGallery.useQuery();
  const logoGallery = useMemo(() => logoGalleryQuery.data ?? [], [logoGalleryQuery.data]);
  const selectedBrandStore = logoGallery.find((store) => store.storeId === logoStoreId) ?? null;

  useEffect(() => {
    if (!storeId && stores.length) {
      setStoreId(stores[0]?.id ?? "");
    }
  }, [storeId, stores]);

  useEffect(() => {
    if (!storeId) {
      return;
    }
    setLogoStoreId(storeId);
    const storeBrand = logoGallery.find((store) => store.storeId === storeId);
    const nextColor =
      storeBrand?.brandColor && colorPattern.test(storeBrand.brandColor)
        ? storeBrand.brandColor
        : defaultEmailBrandColor;
    setBrandColor(nextColor);
    setButtonColor(nextColor);
    setButtonTextColor(defaultButtonTextColor);
    if (storeBrand?.fontFamily) {
      setFontFamily(storeBrand.fontFamily);
    }
  }, [logoGallery, storeId]);

  useEffect(() => {
    setCustomerPage(1);
  }, [customerSearch, source, storeId]);

  const overviewQuery = trpc.emailMarketing.overview.useQuery(
    { storeId, source },
    { enabled: Boolean(storeId) },
  );
  const customersQuery = trpc.emailMarketing.customers.useQuery(
    {
      storeId,
      search: customerSearch,
      source,
      page: customerPage,
      pageSize: customerPageSize,
      includeSelectableIds: audienceMode === "manual",
    },
    { enabled: Boolean(storeId), keepPreviousData: true },
  );
  const productsQuery = trpc.emailMarketing.products.useQuery(
    {
      storeId,
      search: productSearch,
      category: productCategory === "ALL" ? null : productCategory,
      limit: 30,
    },
    { enabled: Boolean(storeId) },
  );
  const historyQuery = trpc.emailMarketing.history.useQuery(
    { storeId, limit: 30 },
    { enabled: Boolean(storeId) },
  );
  const detailQuery = trpc.emailMarketing.detail.useQuery(
    { campaignId: detailCampaignId ?? "" },
    { enabled: Boolean(detailCampaignId) },
  );

  useEffect(() => {
    const storeName = overviewQuery.data?.store?.name ?? selectedStore?.name ?? "";
    if (!senderDisplayName && storeName) {
      setSenderDisplayName(storeName);
    }
    if (!campaignName && storeName) {
      setCampaignName(`Кампания ${storeName}`);
    }
  }, [campaignName, overviewQuery.data?.store?.name, selectedStore?.name, senderDisplayName]);

  const effectiveBlocks = useMemo(
    () => applyBannerImageToBlocks(blocks, bannerImageUrl),
    [bannerImageUrl, blocks],
  );

  const campaignInput = useMemo(
    () => ({
      storeId,
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
      templateKey,
      subject,
      preheader: preheader || null,
      senderDisplayName: senderDisplayName || null,
      replyToEmail: replyToEmail || null,
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
      blocks: effectiveBlocks,
    }),
    [
      audienceMode,
      audienceSegment,
      effectiveBlocks,
      campaignName,
      backgroundColor,
      bannerImageUrl,
      borderColor,
      brandColor,
      buttonColor,
      buttonTextColor,
      contentBackgroundColor,
      fontFamily,
      mutedTextColor,
      preheader,
      replyToEmail,
      logoStoreId,
      selectedCustomerIds,
      senderDisplayName,
      source,
      storeId,
      subject,
      templateKey,
      textColor,
    ],
  );

  const previewMutation = trpc.emailMarketing.preview.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!storeId) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      previewMutation.mutate(campaignInput);
    }, 250);
    return () => window.clearTimeout(timeoutId);
    // previewMutation is intentionally omitted; mutate is stable for the page lifetime and including
    // the whole mutation object would retrigger preview on every mutation state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignInput, storeId]);

  const sendMutation = trpc.emailMarketing.send.useMutation({
    onSuccess: async (result) => {
      setConfirmOpen(false);
      await Promise.all([
        utils.emailMarketing.history.invalidate(),
        utils.emailMarketing.overview.invalidate(),
      ]);
      toast({
        variant: "success",
        description: `Кампания поставлена в очередь. Получателей: ${result.recipientCount}.`,
      });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const testMutation = trpc.emailMarketing.sendTest.useMutation({
    onSuccess: () => toast({ variant: "success", description: "Тестовое письмо отправлено." }),
    onError: (error) =>
      toast({
        variant: "error",
        description: translateError(tErrors, error) || "Не удалось отправить тестовое письмо.",
      }),
  });

  const saveDraftMutation = trpc.emailMarketing.saveDraft.useMutation({
    onSuccess: async () => {
      await utils.emailMarketing.history.invalidate();
      toast({ variant: "success", description: "Кампания сохранена." });
    },
    onError: (error) => toast({ variant: "error", description: translateError(tErrors, error) }),
  });

  const selectedCustomers = customersQuery.data?.items.filter((customer) =>
    selectedCustomerIds.includes(customer.id),
  );
  const customerTotal = customersQuery.data?.total ?? 0;
  const customerTotalPages = Math.max(1, Math.ceil(customerTotal / customerPageSize));
  const customerPageStart = customerTotal ? (customerPage - 1) * customerPageSize + 1 : 0;
  const customerPageEnd = Math.min(customerPage * customerPageSize, customerTotal);
  const visibleSelectableCustomerIds = useMemo(
    () =>
      (customersQuery.data?.items ?? [])
        .filter((customer) => customer.hasValidEmail && !customer.isUnsubscribed)
        .map((customer) => customer.id),
    [customersQuery.data?.items],
  );
  const filteredSelectableCustomerIds = customersQuery.data?.selectableIds ?? [];
  const selectedCustomerIdSet = useMemo(() => new Set(selectedCustomerIds), [selectedCustomerIds]);
  const selectedInCurrentFilterCount = filteredSelectableCustomerIds.filter((id) =>
    selectedCustomerIdSet.has(id),
  ).length;
  const allVisibleCustomersSelected =
    visibleSelectableCustomerIds.length > 0 &&
    visibleSelectableCustomerIds.every((id) => selectedCustomerIdSet.has(id));
  const allFilteredCustomersSelected =
    filteredSelectableCustomerIds.length > 0 &&
    filteredSelectableCustomerIds.every((id) => selectedCustomerIdSet.has(id));
  const audienceSummary = previewMutation.data?.audienceSummary ??
    overviewQuery.data?.audienceSummary ?? {
      totalSelected: 0,
      validRecipients: 0,
      excludedNoEmail: 0,
      excludedUnsubscribed: 0,
      duplicatesRemoved: 0,
    };
  const meaningfulBlocks = blocks.filter(blockHasContent);
  const canSend =
    Boolean(storeId && campaignName.trim() && subject.trim()) &&
    meaningfulBlocks.length > 0 &&
    audienceSummary.validRecipients > 0 &&
    Boolean(overviewQuery.data?.config.ready);
  const warnings = previewMutation.data?.warnings ?? [];
  const productItems = useMemo(() => productsQuery.data?.items ?? [], [productsQuery.data?.items]);
  const productCategories = useMemo(
    () =>
      (productsQuery.data?.categories ?? []).filter((category): category is string =>
        Boolean(category),
      ),
    [productsQuery.data?.categories],
  );
  const previewProducts = useMemo(
    () => previewMutation.data?.products ?? [],
    [previewMutation.data?.products],
  );

  const productById = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; imageUrl?: string | null; priceText?: string | null }
    >();
    for (const product of productItems) {
      map.set(product.id, product);
    }
    for (const product of previewProducts) {
      map.set(product.id, product);
    }
    return map;
  }, [previewProducts, productItems]);

  const applyTemplate = (key: TemplateKey) => {
    const preset = templateBlocks(key, overviewQuery.data?.store?.name ?? selectedStore?.name);
    setTemplateKey(key);
    setSubject(preset.subject);
    setPreheader(preset.preheader);
    setBlocks(preset.blocks);
    if (!campaignName.trim()) {
      setCampaignName(templateLabels[key]);
    }
  };

  const applyBrandFromStore = (brandStoreId: string) => {
    const brand = logoGallery.find((item) => item.storeId === brandStoreId);
    setLogoStoreId(brandStoreId);
    if (brand?.brandColor && colorPattern.test(brand.brandColor)) {
      setBrandColor(brand.brandColor);
      setButtonColor(brand.brandColor);
    }
    if (brand?.fontFamily) {
      setFontFamily(brand.fontFamily);
    }
    if (brand?.storeName) {
      setSenderDisplayName((current) => current || brand.storeName);
    }
  };

  const applyBannerToHero = () => {
    const imageUrl = bannerImageUrl.trim();
    if (!imageUrl) {
      toast({ variant: "error", description: "Добавьте URL баннера." });
      return;
    }
    setBlocks((current) => applyBannerImageToBlocks(current, imageUrl));
  };

  const handleLogoUpload = async (file: File | null) => {
    const targetStoreId = logoStoreId || storeId;
    if (!file || !targetStoreId) {
      return;
    }
    setUploadingLogo(true);
    try {
      const payload = new FormData();
      payload.set("file", file);
      payload.set("storeId", targetStoreId);
      const response = await fetch("/api/email-marketing/logo", {
        method: "POST",
        body: payload,
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        logo?: { storeId: string; logoUrl: string | null };
      };
      if (!response.ok || !body.logo) {
        const message =
          body.message && tErrors.has?.(body.message)
            ? tErrors(body.message)
            : "Не удалось загрузить логотип.";
        throw new Error(message);
      }
      setLogoStoreId(body.logo.storeId);
      await logoGalleryQuery.refetch();
      toast({ variant: "success", description: "Логотип магазина обновлён." });
    } catch (error) {
      toast({
        variant: "error",
        description: error instanceof Error ? error.message : "Не удалось загрузить логотип.",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const updateBlock = <T extends CampaignBlock>(id: string, patch: Partial<T>) => {
    setBlocks((current) =>
      current.map((block) => (block.id === id ? ({ ...block, ...patch } as CampaignBlock) : block)),
    );
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const addBlock = (type: CampaignBlock["type"]) => {
    const id = `${type}-${uid()}`;
    const block: CampaignBlock =
      type === "header"
        ? { id, type, showStoreName: true, showLogo: true }
        : type === "hero"
          ? { id, type, heading: "", subtitle: "", imageUrl: "", buttonText: "", buttonUrl: "" }
          : type === "text"
            ? { id, type, heading: "", body: "" }
            : type === "button"
              ? { id, type, text: "Подробнее", url: "" }
              : type === "products"
                ? {
                    id,
                    type,
                    productIds: [],
                    showImage: true,
                    showPrice: true,
                    showButton: true,
                    buttonText: "Подробнее",
                    layout: "two",
                  }
                : type === "promo"
                  ? { id, type, title: "Скидка", discountCode: "", description: "" }
                  : type === "divider"
                    ? { id, type }
                    : {
                        id,
                        type,
                        text: "Вы получили это письмо, потому что ваш email есть в базе клиентов магазина.",
                        unsubscribeText: "Для отписки свяжитесь с магазином.",
                        showUnsubscribe: true,
                      };
    setBlocks((current) => [...current, block]);
  };

  const toggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((current) =>
      current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId],
    );
  };

  const selectVisibleCustomers = () => {
    setSelectedCustomerIds((current) =>
      Array.from(new Set([...current, ...visibleSelectableCustomerIds])),
    );
  };

  const selectAllFilteredCustomers = () => {
    setSelectedCustomerIds((current) =>
      Array.from(new Set([...current, ...filteredSelectableCustomerIds])),
    );
  };

  const clearFilteredCustomers = () => {
    const filteredIds = new Set(filteredSelectableCustomerIds);
    setSelectedCustomerIds((current) => current.filter((id) => !filteredIds.has(id)));
  };

  const toggleProduct = (
    block: Extract<CampaignBlock, { type: "products" }>,
    productId: string,
  ) => {
    const currentIds = block.productIds ?? [];
    const productIds = currentIds.includes(productId)
      ? currentIds.filter((id) => id !== productId)
      : [...currentIds, productId].slice(0, 12);
    updateBlock<typeof block>(block.id, { productIds });
  };

  const applyHistoryCampaign = (campaign: NonNullable<typeof historyQuery.data>[number]) => {
    setCampaignName(campaign.name);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader ?? "");
    setSenderDisplayName(campaign.senderDisplayName ?? "");
    setReplyToEmail(campaign.replyToEmail ?? "");
    setTemplateKey((campaign.templateKey as TemplateKey) || "blank");
    setBrandColor(
      campaign.brandColor && colorPattern.test(campaign.brandColor)
        ? campaign.brandColor
        : defaultEmailBrandColor,
    );
    setButtonColor(
      campaign.buttonColor && colorPattern.test(campaign.buttonColor)
        ? campaign.buttonColor
        : defaultEmailBrandColor,
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
    setLogoStoreId(campaign.storeId);
    setBlocks(parseBlocks(campaign.blocksJson, campaign.body));
    toast({ variant: "success", description: "Кампания загружена в редактор." });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-40 sm:space-y-6 md:pb-10">
      <PageHeader
        title="Email-маркетинг"
        subtitle="Собирайте письма из блоков, добавляйте товары Bazaar и отправляйте только после предпросмотра."
      />

      <section className="rounded-md border border-border bg-card p-4 shadow-sm md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">Конструктор кампании</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              Письмо, аудитория и отправка
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Сначала выберите клиентов, потом проверьте письмо и отправку.
            </p>
          </div>
          <Badge
            variant={overviewQuery.data?.config.ready ? "success" : "muted"}
            className="shrink-0"
          >
            {overviewQuery.data?.config.ready ? "Готово" : "Не настроено"}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <p className="text-xs text-muted-foreground">Получатели</p>
            <p className="mt-1 text-xl font-semibold">{audienceSummary.validRecipients}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <p className="text-xs text-muted-foreground">Блоки</p>
            <p className="mt-1 text-xl font-semibold">{blocks.length}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <p className="text-xs text-muted-foreground">Замечания</p>
            <p className="mt-1 text-xl font-semibold">{warnings.length}</p>
          </div>
        </div>
      </section>

      <section className="hidden overflow-hidden rounded-md border border-primary/15 bg-primary text-primary-foreground shadow-sm md:block">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-6">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
              Конструктор кампании
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Письмо, аудитория и отправка в одном безопасном сценарии
            </h2>
            <p className="text-white/78 max-w-2xl text-sm leading-6">
              Выберите клиентов, соберите письмо из блоков, проверьте предпросмотр и только потом
              отправляйте кампанию.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[420px]">
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs text-white/65">Получатели</p>
              <p className="text-2xl font-semibold">{audienceSummary.validRecipients}</p>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs text-white/65">Блоки</p>
              <p className="text-2xl font-semibold">{blocks.length}</p>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs text-white/65">Предупреждения</p>
              <p className="text-2xl font-semibold">{warnings.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <Card id="email-audience" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>1</span>
              Аудитория
            </CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Магазин</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите магазин" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Режим аудитории</Label>
                <Select
                  value={audienceMode}
                  onValueChange={(value) => setAudienceMode(value as AudienceMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Выбрать вручную</SelectItem>
                    <SelectItem value="segment">Быстрый сегмент</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="break-words rounded-md border border-warning/30 bg-warning/10 p-3 text-sm font-medium leading-6 text-foreground">
              Убедитесь, что у вас есть согласие клиентов на рассылку.
            </div>

            {audienceMode === "segment" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={cn(
                    "rounded-md border bg-background p-4 text-left text-sm shadow-sm transition",
                    audienceSegment === "all"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/35",
                  )}
                  onClick={() => setAudienceSegment("all")}
                >
                  <span className="font-semibold">Все клиенты с email</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Без email и отписавшиеся будут исключены.
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border bg-background p-4 text-left text-sm shadow-sm transition",
                    audienceSegment === "new"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/35",
                  )}
                  onClick={() => setAudienceSegment("new")}
                >
                  <span className="font-semibold">Новые клиенты</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Созданы за последние 30 дней.
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border bg-background p-4 text-left text-sm shadow-sm transition",
                    audienceSegment === "withPurchases"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/35",
                  )}
                  onClick={() => setAudienceSegment("withPurchases")}
                >
                  <span className="font-semibold">Клиенты с покупками</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Используется поле orderCount.
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border bg-background p-4 text-left text-sm shadow-sm transition",
                    audienceSegment === "withoutPurchases"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/35",
                  )}
                  onClick={() => setAudienceSegment("withoutPurchases")}
                >
                  <span className="font-semibold">Без покупок</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Для первой активации клиентов.
                  </span>
                </button>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Источник клиентов</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as "ALL" | CustomerSource)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Все источники</SelectItem>
                    {sourceValues.map((value) => (
                      <SelectItem key={value} value={value}>
                        {sourceLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {audienceMode === "manual" ? (
                <div className="space-y-1.5">
                  <Label>Поиск клиента</Label>
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="Имя, email или телефон"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {audienceMode === "manual" ? (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-background px-3 py-2 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant={allFilteredCustomersSelected ? "primary" : "outline"}
                        className="h-8 w-full whitespace-nowrap px-2.5 text-xs sm:w-auto"
                        disabled={
                          !filteredSelectableCustomerIds.length || customersQuery.isFetching
                        }
                        onClick={selectAllFilteredCustomers}
                        title="Выбрать всех валидных получателей в текущем фильтре"
                      >
                        <SelectAllIcon className="h-4 w-4" aria-hidden />
                        Все
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={allVisibleCustomersSelected ? "primary" : "outline"}
                        className="h-8 w-full whitespace-nowrap px-2.5 text-xs sm:w-auto"
                        disabled={!visibleSelectableCustomerIds.length || customersQuery.isFetching}
                        onClick={selectVisibleCustomers}
                        title="Выбрать клиентов на текущей странице"
                      >
                        <SelectAllIcon className="h-4 w-4" aria-hidden />
                        Страница
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 w-full whitespace-nowrap px-2.5 text-xs sm:w-auto"
                        disabled={!selectedInCurrentFilterCount}
                        onClick={clearFilteredCustomers}
                      >
                        Снять
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 w-full whitespace-nowrap px-2.5 text-xs sm:w-auto"
                        disabled={!selectedCustomerIds.length}
                        onClick={() => setSelectedCustomerIds([])}
                      >
                        Очистить
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:justify-end">
                      <span>
                        Выбрано{" "}
                        <strong className="font-semibold text-foreground">
                          {selectedCustomerIds.length}
                        </strong>
                      </span>
                      <span>
                        В фильтре{" "}
                        <strong className="font-semibold text-foreground">
                          {selectedInCurrentFilterCount}/{customersQuery.data?.selectableCount ?? 0}
                        </strong>
                      </span>
                      <span>
                        Показано{" "}
                        <strong className="font-semibold text-foreground">
                          {customerPageStart}-{customerPageEnd}
                        </strong>{" "}
                        из{" "}
                        <strong className="font-semibold text-foreground">{customerTotal}</strong>
                      </span>
                    </div>
                  </div>
                </div>
                {customersQuery.data?.selectableLimitReached ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                    Массовый выбор ограничен первыми 5000 валидными получателями в фильтре.
                  </p>
                ) : null}
                <div className="max-h-[min(420px,58vh)] overflow-auto rounded-md border border-border bg-background shadow-sm">
                  <div className="sticky top-0 z-20 hidden grid-cols-[minmax(120px,0.9fr)_minmax(180px,1.3fr)_110px_40px] items-center gap-3 border-b border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm sm:grid">
                    <span>Клиент</span>
                    <span>Email / телефон</span>
                    <span>Источник</span>
                    <span className="sr-only">Выбор</span>
                  </div>
                  {(customersQuery.data?.items ?? []).map((customer) => {
                    const disabled = !customer.hasValidEmail || customer.isUnsubscribed;
                    const checked = selectedCustomerIds.includes(customer.id);
                    return (
                      <label
                        key={customer.id}
                        className={cn(
                          "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-muted/40 sm:grid-cols-[minmax(120px,0.9fr)_minmax(180px,1.3fr)_110px_40px] sm:gap-3",
                          disabled && "cursor-not-allowed bg-muted/30",
                          checked && "bg-primary/5",
                        )}
                      >
                        <span className="col-start-1 row-start-1 min-w-0 truncate font-semibold text-foreground sm:col-auto sm:row-auto">
                          {customer.name}
                        </span>
                        <span className="col-start-1 row-start-2 min-w-0 truncate text-xs text-muted-foreground sm:col-auto sm:row-auto sm:text-sm">
                          {customer.email || "Нет email"}
                          {customer.phone ? ` · ${customer.phone}` : ""}
                        </span>
                        <span className="col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-auto sm:row-auto">
                          <span className="rounded-md bg-muted px-2 py-0.5">
                            {sourceLabels[customer.source]}
                          </span>
                          {customer.orderCount > 0 ? (
                            <span className="hidden xl:inline">{customer.orderCount} покупок</span>
                          ) : null}
                        </span>
                        <input
                          type="checkbox"
                          className={cn(
                            checkboxClass,
                            "col-start-2 row-span-3 row-start-1 self-center justify-self-end sm:col-auto sm:row-auto",
                          )}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleCustomer(customer.id)}
                          aria-label={`Выбрать ${customer.name}`}
                        />
                      </label>
                    );
                  })}
                  {customersQuery.isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">{tCommon("loading")}</div>
                  ) : null}
                  {!customersQuery.isLoading && !(customersQuery.data?.items ?? []).length ? (
                    <div className="p-4 text-sm text-muted-foreground">Клиенты не найдены.</div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Страница <span className="font-semibold text-foreground">{customerPage}</span>{" "}
                    из <span className="font-semibold text-foreground">{customerTotalPages}</span>.
                    Всего: <span className="font-semibold text-foreground">{customerTotal}</span>.
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:flex sm:flex-wrap">
                    <Select
                      value={String(customerPageSize)}
                      onValueChange={(value) => {
                        setCustomerPageSize(Number(value));
                        setCustomerPage(1);
                      }}
                    >
                      <SelectTrigger className="w-full sm:w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {value} / стр.
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-10 w-10"
                      disabled={customerPage <= 1 || customersQuery.isFetching}
                      onClick={() => setCustomerPage((page) => Math.max(1, page - 1))}
                      aria-label="Предыдущая страница клиентов"
                      title="Предыдущая страница"
                    >
                      <ChevronLeftIcon className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-10 w-10"
                      disabled={customerPage >= customerTotalPages || customersQuery.isFetching}
                      onClick={() =>
                        setCustomerPage((page) => Math.min(customerTotalPages, page + 1))
                      }
                      aria-label="Следующая страница клиентов"
                      title="Следующая страница"
                    >
                      <ChevronRightIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={audienceMetricClass}>
                <p className="text-xs text-muted-foreground">Получателей</p>
                <p className="text-lg font-semibold">{audienceSummary.validRecipients}</p>
              </div>
              <div className={audienceMetricClass}>
                <p className="text-xs text-muted-foreground">Без email</p>
                <p className="text-lg font-semibold">{audienceSummary.excludedNoEmail}</p>
              </div>
              <div className={audienceMetricClass}>
                <p className="text-xs text-muted-foreground">Отписались</p>
                <p className="text-lg font-semibold">{audienceSummary.excludedUnsubscribed}</p>
              </div>
              <div className={audienceMetricClass}>
                <p className="text-xs text-muted-foreground">Дубли</p>
                <p className="text-lg font-semibold">{audienceSummary.duplicatesRemoved}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card id="email-campaign" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>2</span>
              Кампания и шаблон
            </CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Название кампании</Label>
                <Input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Шаблон</Label>
                <Select
                  value={templateKey}
                  onValueChange={(value) => applyTemplate(value as TemplateKey)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(templateLabels) as TemplateKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {templateLabels[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Тема письма</Label>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Краткий текст в превью</Label>
              <Input value={preheader} onChange={(event) => setPreheader(event.target.value)} />
              <p className="text-xs text-muted-foreground">
                Этот текст может отображаться рядом с темой письма в почтовом ящике.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Имя отправителя</Label>
                <Input
                  value={senderDisplayName}
                  onChange={(event) => setSenderDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email для ответа</Label>
                <Input
                  value={replyToEmail}
                  onChange={(event) => setReplyToEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => saveDraftMutation.mutate(campaignInput)}
                disabled={!storeId || saveDraftMutation.isLoading}
              >
                {saveDraftMutation.isLoading ? tCommon("loading") : "Сохранить кампанию"}
              </Button>
              <Badge variant={overviewQuery.data?.config.ready ? "success" : "muted"}>
                {overviewQuery.data?.config.ready ? "Отправка настроена" : "Отправка не настроена"}
              </Badge>
            </div>
            {!overviewQuery.data?.config.ready ? (
              <p className="text-sm text-danger">
                Для отправки нужен провайдер и отправитель{" "}
                {overviewQuery.data?.config.requiredFrom ?? "no-reply@bazaar.kg"}.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card id="email-brand" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>3</span>
              Бренд магазина
            </CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Бренд / логотип магазина</Label>
                <Select value={logoStoreId || storeId} onValueChange={applyBrandFromStore}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите магазин" />
                  </SelectTrigger>
                  <SelectContent>
                    {logoGallery.map((brand) => (
                      <SelectItem key={brand.storeId} value={brand.storeId}>
                        {brand.storeName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Админ может использовать бренд любого магазина, к которому у него есть доступ.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Баннер письма</Label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    value={bannerImageUrl}
                    onChange={(event) => setBannerImageUrl(event.target.value)}
                    placeholder="https://..."
                  />
                  <Button type="button" variant="outline" onClick={applyBannerToHero}>
                    Применить
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Предпросмотр, тест и отправка используют этот баннер сразу. Кнопка применяет его в
                  редактируемый hero-блок.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background p-4 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {selectedBrandStore?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedBrandStore.logoUrl}
                        alt=""
                        className="h-full w-full object-contain p-2"
                      />
                    ) : (
                      <span className="px-2 text-center text-xs text-muted-foreground">
                        Нет логотипа
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {selectedBrandStore?.storeName ?? selectedStore?.name ?? "Магазин"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedBrandStore?.legalName ||
                        selectedBrandStore?.address ||
                        "Логотип будет показан в шапке письма."}
                    </p>
                  </div>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleLogoUpload(file);
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 w-full"
                  disabled={!storeId || uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {uploadingLogo ? <Spinner className="h-4 w-4" /> : null}
                  Загрузить логотип для выбранного магазина
                </Button>
              </div>

              <div className="rounded-md border border-border bg-background p-4 shadow-sm">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Шрифт письма</Label>
                    <Select
                      value={fontFamily}
                      onValueChange={(value) => setFontFamily(value as EmailCampaignFontFamily)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fontFamilyValues.map((value) => (
                          <SelectItem key={value} value={value}>
                            {fontFamilyLabels[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ThemeColorField
                      label="Цвет бренда"
                      value={brandColor}
                      onChange={setBrandColor}
                    />
                    <ThemeColorField
                      label="Цвет кнопок"
                      value={buttonColor}
                      onChange={setButtonColor}
                    />
                    <ThemeColorField
                      label="Текст кнопок"
                      value={buttonTextColor}
                      onChange={setButtonTextColor}
                    />
                    <ThemeColorField
                      label="Фон письма"
                      value={backgroundColor}
                      onChange={setBackgroundColor}
                    />
                    <ThemeColorField
                      label="Фон контента"
                      value={contentBackgroundColor}
                      onChange={setContentBackgroundColor}
                    />
                    <ThemeColorField
                      label="Основной текст"
                      value={textColor}
                      onChange={setTextColor}
                    />
                    <ThemeColorField
                      label="Вторичный текст"
                      value={mutedTextColor}
                      onChange={setMutedTextColor}
                    />
                    <ThemeColorField
                      label="Границы"
                      value={borderColor}
                      onChange={setBorderColor}
                    />
                  </div>
                </div>
                <div
                  className="mt-4 rounded-md border p-4"
                  style={{
                    borderColor,
                    backgroundColor: contentBackgroundColor,
                    color: textColor,
                    fontFamily:
                      fontFamily === EmailCampaignFontFamily.SYSTEM
                        ? "-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif"
                        : fontFamilyLabels[fontFamily],
                  }}
                >
                  <p className="text-sm font-semibold" style={{ color: brandColor }}>
                    {senderDisplayName ||
                      selectedBrandStore?.storeName ||
                      selectedStore?.name ||
                      "Название магазина"}
                  </p>
                  <p className="mt-2 text-sm" style={{ color: mutedTextColor }}>
                    Так будут выглядеть цвета, фон, текст и CTA в письме.
                  </p>
                  <span
                    className="mt-3 inline-flex rounded-md px-4 py-2 text-sm font-semibold"
                    style={{ backgroundColor: buttonColor, color: buttonTextColor }}
                  >
                    Кнопка письма
                  </span>
                </div>
                {[
                  brandColor,
                  buttonColor,
                  buttonTextColor,
                  backgroundColor,
                  contentBackgroundColor,
                  textColor,
                  mutedTextColor,
                  borderColor,
                ].some((value) => !colorPattern.test(value)) ? (
                  <p className="mt-3 text-sm text-danger">Цвет должен быть в формате #1d4ed8.</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {logoGallery.map((brand) => {
                const selected = brand.storeId === (logoStoreId || storeId);
                return (
                  <button
                    key={brand.storeId}
                    type="button"
                    onClick={() => applyBrandFromStore(brand.storeId)}
                    className={cn(
                      "flex items-center gap-3 rounded-md border bg-background p-3 text-left shadow-sm transition hover:border-primary/40",
                      selected ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                      {brand.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={brand.logoUrl}
                          alt=""
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {brand.storeName.slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {brand.storeName}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className="h-3 w-3 rounded-md border border-border"
                          style={{ backgroundColor: brand.brandColor }}
                        />
                        {brand.logoUrl ? "Логотип есть" : "Логотип не загружен"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card id="email-blocks" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>4</span>
              Блоки письма
            </CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {blockTypeOptions.map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full justify-start sm:w-auto"
                  onClick={() => addBlock(type)}
                >
                  <AddIcon className="h-4 w-4" aria-hidden />
                  {blockLabels[type]}
                </Button>
              ))}
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <p className="font-semibold">Доступные переменные</p>
              <p className="mt-1 break-words text-muted-foreground">
                {
                  "{{customerName}}, {{storeName}}, {{storePhone}}, {{storeAddress}}, {{currentDate}}, {{discountCode}}, {{unsubscribeLink}}"
                }
              </p>
            </div>

            <div className="space-y-3">
              {blocks.map((block, index) => (
                <div
                  key={block.id}
                  className="overflow-hidden rounded-md border border-border bg-background shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/25 px-4 py-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {index + 1}. {blockLabels[block.type]}
                      </p>
                      <p className="text-xs text-muted-foreground">{block.id}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => moveBlock(block.id, -1)}
                        disabled={index === 0}
                        aria-label="Выше"
                      >
                        <ArrowUpIcon className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => moveBlock(block.id, 1)}
                        disabled={index === blocks.length - 1}
                        aria-label="Ниже"
                      >
                        <ArrowDownIcon className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="danger"
                        onClick={() =>
                          setBlocks((current) => current.filter((item) => item.id !== block.id))
                        }
                        aria-label="Удалить"
                      >
                        <DeleteIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <div className="p-4">
                    {block.type === "header" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <CheckboxField
                          checked={block.showStoreName ?? true}
                          onChange={(checked) =>
                            updateBlock<typeof block>(block.id, { showStoreName: checked })
                          }
                          label="Показывать название магазина"
                        />
                        <CheckboxField
                          checked={block.showLogo ?? true}
                          onChange={(checked) =>
                            updateBlock<typeof block>(block.id, { showLogo: checked })
                          }
                          label="Показывать логотип"
                        />
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Дополнительный заголовок</Label>
                          <Input
                            value={block.heading ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { heading: event.target.value })
                            }
                          />
                        </div>
                      </div>
                    ) : null}

                    {block.type === "hero" ? (
                      <div className="grid gap-3">
                        <div className="space-y-1.5">
                          <Label>URL изображения</Label>
                          <Input
                            value={block.imageUrl ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                imageUrl: event.target.value,
                              })
                            }
                            placeholder="https://..."
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Заголовок</Label>
                            <Input
                              value={block.heading ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  heading: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Подзаголовок</Label>
                            <Input
                              value={block.subtitle ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  subtitle: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Текст кнопки</Label>
                            <Input
                              value={block.buttonText ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  buttonText: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>URL кнопки</Label>
                            <Input
                              value={block.buttonUrl ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  buttonUrl: event.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {block.type === "text" ? (
                      <div className="grid gap-3">
                        <div className="space-y-1.5">
                          <Label>Заголовок</Label>
                          <Input
                            value={block.heading ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { heading: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Текст</Label>
                          <Textarea
                            value={block.body ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { body: event.target.value })
                            }
                            rows={5}
                          />
                        </div>
                      </div>
                    ) : null}

                    {block.type === "button" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Текст кнопки</Label>
                          <Input
                            value={block.text ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { text: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>URL</Label>
                          <Input
                            value={block.url ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { url: event.target.value })
                            }
                          />
                        </div>
                      </div>
                    ) : null}

                    {block.type === "products" ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Поиск товара</Label>
                            <Input
                              value={productSearch}
                              onChange={(event) => setProductSearch(event.target.value)}
                              placeholder="Название, SKU или штрихкод"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Категория</Label>
                            <Select value={productCategory} onValueChange={setProductCategory}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ALL">Все категории</SelectItem>
                                {productCategories.map((category) => (
                                  <SelectItem key={category} value={category}>
                                    {category}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {productItems.map((product) => {
                            const checked = (block.productIds ?? []).includes(product.id);
                            return (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => toggleProduct(block, product.id)}
                                className={cn(
                                  "flex gap-3 rounded-md border bg-background p-3 text-left text-sm shadow-sm transition hover:border-primary/35",
                                  checked ? "border-primary bg-primary/5" : "border-border",
                                )}
                              >
                                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                                  {product.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={product.imageUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : null}
                                </div>
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold">
                                    {product.name}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {product.priceText ?? "Нет цены"}
                                  </span>
                                  {!product.hasImage ? (
                                    <span className="block text-xs text-warning">
                                      Нет изображения
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(block.productIds ?? []).map((id) => (
                            <Badge key={id} variant="muted">
                              {productById.get(id)?.name ?? id}
                            </Badge>
                          ))}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <CheckboxField
                            checked={block.showImage ?? true}
                            onChange={(checked) =>
                              updateBlock<typeof block>(block.id, { showImage: checked })
                            }
                            label="Фото"
                          />
                          <CheckboxField
                            checked={block.showPrice ?? true}
                            onChange={(checked) =>
                              updateBlock<typeof block>(block.id, { showPrice: checked })
                            }
                            label="Цена"
                          />
                          <CheckboxField
                            checked={block.showButton ?? true}
                            onChange={(checked) =>
                              updateBlock<typeof block>(block.id, { showButton: checked })
                            }
                            label="Кнопка"
                          />
                          <div className="space-y-1.5">
                            <Label>Текст кнопки</Label>
                            <Input
                              value={block.buttonText ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  buttonText: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Общая ссылка</Label>
                            <Input
                              value={block.buttonUrl ?? ""}
                              onChange={(event) =>
                                updateBlock<typeof block>(block.id, {
                                  buttonUrl: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Макет</Label>
                            <Select
                              value={block.layout ?? "two"}
                              onValueChange={(value) =>
                                updateBlock<typeof block>(block.id, {
                                  layout: value as "one" | "two",
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="one">Одна колонка</SelectItem>
                                <SelectItem value="two">Две колонки</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {block.type === "promo" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Заголовок</Label>
                          <Input
                            value={block.title ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { title: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Промокод</Label>
                          <Input
                            value={block.discountCode ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                discountCode: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Описание</Label>
                          <Textarea
                            value={block.description ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                description: event.target.value,
                              })
                            }
                            rows={3}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Срок действия</Label>
                          <Input
                            value={block.expiryText ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                expiryText: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>URL кнопки</Label>
                          <Input
                            value={block.buttonUrl ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                buttonUrl: event.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : null}

                    {block.type === "footer" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Название магазина</Label>
                          <Input
                            value={block.storeName ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                storeName: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Телефон</Label>
                          <Input
                            value={block.phone ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { phone: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Адрес</Label>
                          <Input
                            value={block.address ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { address: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Текст</Label>
                          <Textarea
                            value={block.text ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, { text: event.target.value })
                            }
                            rows={3}
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Текст отписки</Label>
                          <Textarea
                            value={block.unsubscribeText ?? ""}
                            onChange={(event) =>
                              updateBlock<typeof block>(block.id, {
                                unsubscribeText: event.target.value,
                              })
                            }
                            rows={2}
                            placeholder="Для отписки свяжитесь с магазином."
                          />
                          <p className="text-xs text-muted-foreground">
                            Можно использовать переменную {"{{unsubscribeLink}}"}, если ссылка
                            отписки настроена.
                          </p>
                        </div>
                        <CheckboxField
                          checked={block.showUnsubscribe ?? true}
                          onChange={(checked) =>
                            updateBlock<typeof block>(block.id, { showUnsubscribe: checked })
                          }
                          label="Показывать отписку"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card id="email-preview" className={sectionCardClass}>
          <CardHeader
            className={cn(
              sectionHeaderClass,
              "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>5</span>
              Предпросмотр и тест
            </CardTitle>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button
                type="button"
                size="icon"
                className="h-10 w-10"
                variant={previewMode === "desktop" ? "primary" : "outline"}
                onClick={() => setPreviewMode("desktop")}
                aria-label="Предпросмотр на компьютере"
                title="Компьютер"
              >
                <DesktopPreviewIcon className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-10 w-10"
                variant={previewMode === "mobile" ? "primary" : "outline"}
                onClick={() => setPreviewMode("mobile")}
                aria-label="Предпросмотр на телефоне"
                title="Телефон"
              >
                <MobilePreviewIcon className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                placeholder={replyToEmail || "test@example.com"}
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!storeId || !subject.trim() || testMutation.isLoading}
                onClick={() =>
                  testMutation.mutate({
                    campaign: campaignInput,
                    to: testEmail || replyToEmail,
                    sampleCustomerId: selectedCustomers?.[0]?.id ?? null,
                  })
                }
              >
                {testMutation.isLoading ? tCommon("loading") : "Отправить тест"}
              </Button>
            </div>

            {warnings.length ? (
              <div className="space-y-2">
                {warnings.slice(0, 8).map((warning, index) => (
                  <div
                    key={`${warning.code}-${index}`}
                    className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm"
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            ) : null}

            {previewMutation.error ? (
              <p className="text-sm text-danger">
                {translateError(tErrors, previewMutation.error)}
              </p>
            ) : null}

            <div className="rounded-md border border-border bg-muted/40 p-4">
              <div
                className={cn(
                  "mx-auto overflow-auto rounded-md border border-border bg-white shadow-sm",
                  previewMode === "mobile" ? "max-w-[390px]" : "max-w-[760px]",
                )}
              >
                {previewMutation.data?.rendered.html ? (
                  <div dangerouslySetInnerHTML={{ __html: previewMutation.data.rendered.html }} />
                ) : (
                  <div className="p-6 text-sm text-muted-foreground">
                    Предпросмотр появится после добавления блоков.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card id="email-send" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>6</span>
              Отправка
            </CardTitle>
          </CardHeader>
          <CardContent className={sectionContentClass}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className={statCardClass}>
                <p className="text-xs text-muted-foreground">Кампания</p>
                <p className="truncate font-semibold">{campaignName || "Без названия"}</p>
              </div>
              <div className={statCardClass}>
                <p className="text-xs text-muted-foreground">Тема</p>
                <p className="truncate font-semibold">{subject || "Не указана"}</p>
              </div>
              <div className={statCardClass}>
                <p className="text-xs text-muted-foreground">Получателей</p>
                <p className="font-semibold">{audienceSummary.validRecipients}</p>
              </div>
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={!canSend || sendMutation.isLoading}
              onClick={() => setConfirmOpen(true)}
            >
              {sendMutation.isLoading ? tCommon("loading") : "Перейти к подтверждению"}
            </Button>
            {!canSend ? (
              <p className="text-sm text-muted-foreground">
                Перед отправкой нужны название, тема, содержательный блок, получатели и настроенный
                email-провайдер.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card id="email-history" className={sectionCardClass}>
          <CardHeader className={sectionHeaderClass}>
            <CardTitle className={stepTitleClass}>
              <span className={stepNumberClass}>7</span>
              История
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-5 sm:px-6">
            <TableContainer>
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Кампания</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Получатели</TableHead>
                    <TableHead>Результат</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historyQuery.data ?? []).length ? (
                    (historyQuery.data ?? []).map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <p className="font-medium">{campaign.name}</p>
                          <p className="text-xs text-muted-foreground">{campaign.subject}</p>
                        </TableCell>
                        <TableCell>{campaignStatusLabel(campaign.status)}</TableCell>
                        <TableCell>{campaign.recipientCount}</TableCell>
                        <TableCell>
                          {campaign.sentCount ?? 0} отправлено / {campaign.failedCount ?? 0} ошибок
                        </TableCell>
                        <TableCell>{formatDateTime(campaign.createdAt, locale)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => applyHistoryCampaign(campaign)}
                            >
                              <SparklesIcon className="h-4 w-4" aria-hidden />
                              Использовать
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setDetailCampaignId(campaign.id)}
                            >
                              Детали
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {historyQuery.isLoading ? tCommon("loading") : "История пока пустая."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-20 z-30 border-t border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Получателей</p>
            <p className="truncate text-xs font-semibold text-foreground">
              {audienceSummary.validRecipients} получ. · {blocks.length} блока · {warnings.length}{" "}
              зам.
            </p>
          </div>
          <a
            href="#email-preview"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-sm"
          >
            Превью
          </a>
          <Button
            type="button"
            size="sm"
            className="h-10 shrink-0"
            disabled={!canSend || sendMutation.isLoading}
            onClick={() => setConfirmOpen(true)}
          >
            Отправка
          </Button>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Отправить кампанию?"
        subtitle="Письмо будет поставлено в очередь на отправку выбранным получателям."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="grid gap-2 text-sm">
            <p>
              <strong>Кампания:</strong> {campaignName}
            </p>
            <p>
              <strong>Тема:</strong> {subject}
            </p>
            <p>
              <strong>Получателей:</strong> {audienceSummary.validRecipients}
            </p>
            <p>
              <strong>Исключены:</strong>{" "}
              {audienceSummary.excludedNoEmail +
                audienceSummary.excludedUnsubscribed +
                audienceSummary.duplicatesRemoved}
            </p>
            <p>
              <strong>Отправитель:</strong>{" "}
              {senderDisplayName || overviewQuery.data?.config.requiredFrom}
            </p>
            <p>
              <strong>Магазин:</strong> {overviewQuery.data?.store?.name ?? selectedStore?.name}
            </p>
            <p>
              <strong>Предупреждений:</strong> {warnings.length}
            </p>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!canSend || sendMutation.isLoading}
              onClick={() => sendMutation.mutate(campaignInput)}
            >
              {sendMutation.isLoading ? tCommon("loading") : "Отправить"}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailCampaignId)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCampaignId(null);
          }
        }}
        title="Детали кампании"
        className="max-w-4xl"
      >
        {detailQuery.data ? (
          <div className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <strong>Название:</strong> {detailQuery.data.campaign.name}
              </p>
              <p>
                <strong>Статус:</strong> {campaignStatusLabel(detailQuery.data.campaign.status)}
              </p>
              <p>
                <strong>Получателей:</strong> {detailQuery.data.campaign.recipientCount}
              </p>
              <p>
                <strong>Отправлено:</strong> {detailQuery.data.campaign.sentCount}
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto border border-border bg-white">
              <div dangerouslySetInnerHTML={{ __html: detailQuery.data.rendered.html }} />
            </div>
            <TableContainer>
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Ошибка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuery.data.campaign.recipients.map((recipient) => (
                    <TableRow key={recipient.id}>
                      <TableCell>{recipient.email}</TableCell>
                      <TableCell>{recipient.customer.name}</TableCell>
                      <TableCell>{recipient.status}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {recipient.errorMessage ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
        )}
      </Modal>
    </div>
  );
};

export default EmailMarketingPage;
