"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  DownloadIcon,
  InventoryIcon,
  ProductsIcon,
  PurchaseOrdersIcon,
  SalesOrdersIcon,
  SearchIcon,
  StoresIcon,
  SuppliersIcon,
} from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string | null;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: "actions" | "results";
};

export const CommandPalette = () => {
  const t = useTranslations("commandPalette");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const searchQuery = trpc.search.global.useQuery(
    { q: query.trim() },
    { enabled: query.trim().length >= 2 && open },
  );

  const actions = useMemo<PaletteItem[]>(
    () => [
      {
        id: "action-create-so",
        label: t("actionCreateSo"),
        sublabel: null,
        href: "/sales/orders/new",
        icon: SalesOrdersIcon,
        group: "actions",
      },
      {
        id: "action-create-po",
        label: t("actionCreatePo"),
        sublabel: null,
        href: "/purchase-orders/new",
        icon: PurchaseOrdersIcon,
        group: "actions",
      },
      {
        id: "action-stock-count",
        label: t("actionStartCount"),
        sublabel: null,
        href: "/inventory/counts",
        icon: InventoryIcon,
        group: "actions",
      },
      {
        id: "action-print-tags",
        label: t("actionPrintTags"),
        sublabel: null,
        href: "/products",
        icon: DownloadIcon,
        group: "actions",
      },
    ],
    [t],
  );

  const results = useMemo<PaletteItem[]>(() => {
    const items = searchQuery.data?.results ?? [];
    return items.map((item) => {
      switch (item.type) {
        case "supplier":
          return {
            id: item.id,
            label: item.label,
            sublabel: item.sublabel,
            href: item.href,
            icon: SuppliersIcon,
            group: "results",
          };
        case "store":
          return {
            id: item.id,
            label: item.label,
            sublabel: item.sublabel,
            href: item.href,
            icon: StoresIcon,
            group: "results",
          };
        case "purchaseOrder":
          return {
            id: item.id,
            label: item.label,
            sublabel: item.sublabel,
            href: item.href,
            icon: PurchaseOrdersIcon,
            group: "results",
          };
        default:
          return {
            id: item.id,
            label: item.label,
            sublabel: item.sublabel,
            href: item.href,
            icon: ProductsIcon,
            group: "results",
          };
      }
    });
  }, [searchQuery.data]);

  const allItems = useMemo(() => [...actions, ...results], [actions, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  const findByBarcode = trpc.products.findByBarcode.useMutation({
    onSuccess: (product) => {
      if (product) {
        router.push(`/products/${product.id}`);
        setOpen(false);
        return;
      }
      toast({ variant: "info", description: t("noResults") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSelect = (item?: PaletteItem) => {
    if (!item) {
      return;
    }
    router.push(item.href);
    setOpen(false);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (allItems.length ? (prev + 1) % allItems.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        allItems.length ? (prev - 1 + allItems.length) % allItems.length : 0,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (allItems.length) {
        handleSelect(allItems[activeIndex]);
        return;
      }
      const trimmed = query.trim();
      if (trimmed.length >= 2) {
        findByBarcode.mutate({ value: trimmed });
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("placeholder")}
            className="pl-9"
            aria-label={t("searchLabel")}
          />
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("actionsTitle")}
          </div>
          <div className="space-y-1">
            {actions.map((item, index) => {
              const Icon = item.icon;
              const isActive = allItems[activeIndex]?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                    isActive ? "bg-gray-100 text-ink" : "text-gray-600 hover:bg-gray-50"
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(item)}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("resultsTitle")}
          </div>
          {searchQuery.isFetching ? (
            <p className="text-sm text-gray-500">{t("loading")}</p>
          ) : results.length ? (
            <div className="space-y-1">
              {results.map((item, index) => {
                const globalIndex = actions.length + index;
                const Icon = item.icon;
                const isActive = allItems[activeIndex]?.id === item.id;
                return (
                  <button
                    key={`${item.group}-${item.id}`}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                      isActive ? "bg-gray-100 text-ink" : "text-gray-600 hover:bg-gray-50"
                    }`}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(item)}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{item.label}</p>
                      {item.sublabel ? (
                        <p className="truncate text-xs text-gray-500">{item.sublabel}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t("noResults")}</p>
          )}
        </div>
      </div>
    </Modal>
  );
};
