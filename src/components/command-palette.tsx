"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { ScanInput } from "@/components/ScanInput";
import {
  ProductSearchResultItem,
  type ProductSearchResultProduct,
} from "@/components/product-search-result-item";
import { useToast } from "@/components/ui/toast";
import {
  AdjustIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BillingIcon,
  InventoryIcon,
  PurchaseOrdersIcon,
  ProductsIcon,
  ReceiveIcon,
  SalesOrdersIcon,
  SearchIcon,
  StoresIcon,
  SuppliersIcon,
  TagIcon,
  TransferIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { filterCommandPaletteActions, type CommandPaletteCategory } from "@/lib/command-palette";
import {
  addRecentCommandPaletteSearch,
  parseRecentCommandPaletteSearches,
} from "@/lib/command-palette-recent";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import {
  buildScopedStorageKey,
  useScopedLocalStorageState,
} from "@/lib/useScopedLocalStorageState";
import {
  hasPermission,
  permissionForSearchResultType,
  type AppPermission,
  type RoleAccess,
} from "@/lib/roleAccess";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/server/services/search/global";

type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string | null;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: "actions" | "recent" | "results";
  category?: CommandPaletteCategory;
  resultType?: SearchResult["type"];
  product?: ProductSearchResultProduct;
  keywords?: string[];
  queryValue?: string;
  permission?: AppPermission;
};

const actionCategories: CommandPaletteCategory[] = ["documents", "products", "other", "payments"];

const normalizeQuery = (value: string) => value.trim();
const itemKey = (item: PaletteItem) => `${item.group}:${item.id}`;
const resultGroupOrder = ["product", "supplier", "store", "purchaseOrder"] as const;
const defaultRecentSearches: string[] = [];

export const CommandPalette = ({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const t = useTranslations("commandPalette");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();
  const access: RoleAccess = useMemo(
    () => ({
      role: session?.user?.role,
      isPlatformOwner: Boolean(session?.user?.isPlatformOwner),
      isOrgOwner: Boolean(session?.user?.isOrgOwner),
    }),
    [session?.user?.isOrgOwner, session?.user?.isPlatformOwner, session?.user?.role],
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isControlled = typeof open === "boolean";
  const isOpen = isControlled ? Boolean(open) : internalOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setActiveIndex(0);
      setHoveredIndex(null);
      setKeyboardNavigation(false);
    }
  }, [isOpen]);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeQuery(query);
  const normalizedSearchQuery = normalizeQuery(deferredQuery);
  const recentSearchesStorageKey = useMemo(
    () =>
      buildScopedStorageKey({
        prefix: "command-palette-recent-searches",
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const { value: recentSearches, setValue: setRecentSearches } = useScopedLocalStorageState({
    storageKey: recentSearchesStorageKey,
    defaultValue: defaultRecentSearches,
    parse: parseRecentCommandPaletteSearches,
  });
  const rememberRecentSearch = useCallback(
    (value: string) => {
      setRecentSearches((current) => addRecentCommandPaletteSearch(current, value));
    },
    [setRecentSearches],
  );
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
  }, [setRecentSearches]);

  const searchQuery = trpc.search.global.useQuery(
    { q: normalizedSearchQuery },
    { enabled: normalizedSearchQuery.length >= 2 && isOpen },
  );

  const actions = useMemo<PaletteItem[]>(
    () => [
      {
        id: "create-sale-order",
        label: t("actions.sale"),
        keywords: [t("keywords.sale"), t("keywords.document"), t("keywords.order")],
        sublabel: null,
        href: "/pos/sell",
        icon: SalesOrdersIcon,
        group: "actions",
        category: "documents",
        permission: "usePos",
      },
      {
        id: "sale-return",
        label: t("actions.saleReturn"),
        keywords: [t("keywords.sale"), t("keywords.return"), t("keywords.document")],
        sublabel: null,
        href: "/pos/history",
        icon: ArrowDownIcon,
        group: "actions",
        category: "documents",
        permission: "viewSales",
      },
      {
        id: "inventory-receive",
        label: t("actions.stockReceive"),
        keywords: [t("keywords.inventory"), t("keywords.receive"), t("keywords.document")],
        sublabel: null,
        href: "/inventory?action=receive",
        icon: ReceiveIcon,
        group: "actions",
        category: "documents",
        permission: "viewInventory",
      },
      {
        id: "inventory-adjust",
        label: t("actions.stockWriteoff"),
        keywords: [t("keywords.inventory"), t("keywords.adjust"), t("keywords.document")],
        sublabel: null,
        href: "/inventory?action=adjust",
        icon: AdjustIcon,
        group: "actions",
        category: "documents",
        permission: "viewInventory",
      },
      {
        id: "inventory-count",
        label: t("actions.stockCount"),
        keywords: [t("keywords.inventory"), t("keywords.count"), t("keywords.document")],
        sublabel: null,
        href: "/inventory/counts/new",
        icon: InventoryIcon,
        group: "actions",
        category: "documents",
        permission: "viewInventory",
      },
      {
        id: "inventory-transfer",
        label: t("actions.stockTransfer"),
        keywords: [t("keywords.inventory"), t("keywords.transfer"), t("keywords.document")],
        sublabel: null,
        href: "/inventory?action=transfer",
        icon: TransferIcon,
        group: "actions",
        category: "documents",
        permission: "viewInventory",
      },
      {
        id: "create-product",
        label: t("actions.product"),
        keywords: [t("keywords.product"), t("keywords.catalog"), t("keywords.create")],
        sublabel: null,
        href: "/products/new?type=product",
        icon: ProductsIcon,
        group: "actions",
        category: "products",
        permission: "manageProducts",
      },
      {
        id: "create-bundle",
        label: t("actions.bundle"),
        keywords: [t("keywords.bundle"), t("keywords.catalog"), t("keywords.create")],
        sublabel: null,
        href: "/products/new?type=bundle",
        icon: TagIcon,
        group: "actions",
        category: "products",
        permission: "manageProducts",
      },
      {
        id: "new-customer",
        label: t("actions.customer"),
        keywords: [t("keywords.customer"), t("keywords.other"), t("keywords.create")],
        sublabel: null,
        href: "/customers/new",
        icon: UserIcon,
        group: "actions",
        category: "other",
        permission: "viewSales",
      },
      {
        id: "new-supplier",
        label: t("actions.supplier"),
        keywords: [t("keywords.supplier"), t("keywords.other"), t("keywords.create")],
        sublabel: null,
        href: "/suppliers/new",
        icon: SuppliersIcon,
        group: "actions",
        category: "other",
        permission: "viewSuppliers",
      },
      {
        id: "new-employee",
        label: t("actions.employee"),
        keywords: [t("keywords.employee"), t("keywords.other"), t("keywords.create")],
        sublabel: null,
        href: "/settings/users?create=1",
        icon: UsersIcon,
        group: "actions",
        category: "other",
        permission: "manageUsers",
      },
      {
        id: "new-store",
        label: t("actions.store"),
        keywords: [t("keywords.store"), t("keywords.other"), t("keywords.create")],
        sublabel: null,
        href: "/stores/new",
        icon: StoresIcon,
        group: "actions",
        category: "other",
        permission: "viewStores",
      },
      {
        id: "cash",
        label: t("actions.cash"),
        keywords: [t("keywords.cash"), t("keywords.other")],
        sublabel: null,
        href: "/pos",
        icon: BillingIcon,
        group: "actions",
        category: "other",
        permission: "viewCash",
      },
      {
        id: "finance-income",
        label: t("actions.income"),
        keywords: [t("keywords.finance"), t("keywords.income"), t("keywords.payment")],
        sublabel: null,
        href: "/finance/income",
        icon: ArrowDownIcon,
        group: "actions",
        category: "payments",
        permission: "viewCash",
      },
      {
        id: "finance-expense",
        label: t("actions.expense"),
        keywords: [t("keywords.finance"), t("keywords.expense"), t("keywords.payment")],
        sublabel: null,
        href: "/finance/expense",
        icon: ArrowUpIcon,
        group: "actions",
        category: "payments",
        permission: "viewCash",
      },
    ],
    [t],
  );

  const filteredActions = useMemo(() => {
    const visibleActions = actions.filter((action) => hasPermission(access, action.permission));
    const searchable = visibleActions.map((action) => ({
      id: action.id,
      category: action.category ?? "other",
      label: action.label,
      keywords: action.keywords ?? [],
      href: action.href,
    }));
    const matches = filterCommandPaletteActions(searchable, normalizedQuery);
    const actionMap = new Map(visibleActions.map((action) => [action.id, action]));
    return matches.flatMap((match) => {
      const item = actionMap.get(match.id);
      return item ? [item] : [];
    });
  }, [access, actions, normalizedQuery]);

  const results = useMemo<PaletteItem[]>(() => {
    const items = searchQuery.data?.results ?? [];
    return items
      .filter((item) => hasPermission(access, permissionForSearchResultType(item.type)))
      .map((item) => {
        switch (item.type) {
          case "supplier":
            return {
              id: item.id,
              label: item.label,
              sublabel: item.sublabel,
              href: item.href,
              icon: SuppliersIcon,
              group: "results",
              resultType: item.type,
            };
          case "store":
            return {
              id: item.id,
              label: item.label,
              sublabel: item.sublabel,
              href: item.href,
              icon: StoresIcon,
              group: "results",
              resultType: item.type,
            };
          case "purchaseOrder":
            return {
              id: item.id,
              label: item.label,
              sublabel: item.sublabel,
              href: item.href,
              icon: PurchaseOrdersIcon,
              group: "results",
              resultType: item.type,
            };
          default:
            return {
              id: item.id,
              label: item.label,
              sublabel: item.sublabel,
              href: item.href,
              icon: ProductsIcon,
              group: "results",
              resultType: item.type,
              product: item.product,
            };
        }
      });
  }, [access, searchQuery.data]);

  const resultGroups = useMemo(
    () =>
      resultGroupOrder
        .map((type) => ({
          type,
          items: results.filter((item) => item.resultType === type),
        }))
        .filter((group) => group.items.length > 0),
    [results],
  );

  const orderedResults = useMemo(
    () => resultGroups.flatMap((group) => group.items),
    [resultGroups],
  );
  const recentItems = useMemo<PaletteItem[]>(
    () =>
      normalizedQuery.length >= 2
        ? []
        : recentSearches.map((value) => ({
            id: value,
            label: value,
            href: "#",
            icon: SearchIcon,
            group: "recent",
            queryValue: value,
          })),
    [normalizedQuery.length, recentSearches],
  );

  const allItems = useMemo(
    () => [...recentItems, ...filteredActions, ...orderedResults],
    [filteredActions, orderedResults, recentItems],
  );
  const activeItem = allItems[activeIndex];
  const indexByItemId = useMemo(
    () => new Map(allItems.map((item, index) => [itemKey(item), index])),
    [allItems],
  );
  const groupedActions = useMemo(
    () =>
      actionCategories.map((category) => ({
        category,
        items: filteredActions.filter((action) => action.category === category),
      })),
    [filteredActions],
  );

  useEffect(() => {
    setActiveIndex(0);
    setHoveredIndex(null);
    setKeyboardNavigation(false);
  }, [normalizedQuery, filteredActions.length, orderedResults.length]);

  const findByBarcode = trpc.products.findByBarcode.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSelect = (item?: PaletteItem) => {
    if (!item) {
      return;
    }
    if (item.queryValue) {
      setQuery(item.queryValue);
      setKeyboardNavigation(false);
      setHoveredIndex(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (normalizedQuery) {
      rememberRecentSearch(normalizedQuery);
    }
    router.push(item.href);
    setOpen(false);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setKeyboardNavigation(true);
      setHoveredIndex(null);
      setActiveIndex((prev) => (allItems.length ? (prev + 1) % allItems.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyboardNavigation(true);
      setHoveredIndex(null);
      setActiveIndex((prev) =>
        allItems.length ? (prev - 1 + allItems.length) % allItems.length : 0,
      );
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleScanSubmit = async ({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<boolean> => {
    const selectedIndex = hoveredIndex ?? activeIndex;
    const shouldSelectActiveItem =
      allItems.length > 0 &&
      (hoveredIndex !== null || keyboardNavigation || normalizedQuery.length >= 2);
    if (shouldSelectActiveItem) {
      handleSelect(allItems[selectedIndex]);
      return true;
    }

    if (normalizedValue.length < 2) {
      return false;
    }

    try {
      const product = await findByBarcode.mutateAsync({ value: normalizedValue });
      if (!product) {
        toast({ variant: "info", description: t("noResults") });
        return false;
      }
      rememberRecentSearch(normalizedValue);
      router.push(`/products/${product.id}`);
      setOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={setOpen}
      title={t("title")}
      subtitle={t("subtitle")}
      className="max-w-4xl"
      headerClassName="px-4 py-4 sm:px-6 sm:py-5"
      bodyClassName="space-y-4 px-4 pb-5 pt-4 sm:px-6 sm:pb-6"
    >
      <div className="space-y-5">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <ScanInput
            context="commandPanel"
            ref={inputRef}
            value={query}
            onValueChange={(nextValue) => {
              setQuery(nextValue);
              setKeyboardNavigation(false);
            }}
            onKeyDown={handleInputKeyDown}
            onSubmitValue={handleScanSubmit}
            supportsTabSubmit
            placeholder={t("placeholder")}
            inputClassName="h-11 rounded-none border-border/80 bg-background pl-9 text-sm"
            ariaLabel={t("searchLabel")}
            showDropdown={false}
          />
        </div>

        {normalizedQuery.length >= 2 ? (
          <section className="rounded-none border border-border/80 bg-card/80 p-3 sm:p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("resultsTitle")}
            </div>
            {searchQuery.isFetching && orderedResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : orderedResults.length ? (
              <div className="space-y-4">
                {resultGroups.map((group) => (
                  <div key={group.type} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`resultSections.${group.type}`)}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {group.items.map((item) => {
                        const key = itemKey(item);
                        const index = indexByItemId.get(key) ?? 0;
                        const Icon = item.icon;
                        const isActive =
                          hoveredIndex === index ||
                          (keyboardNavigation && activeItem ? itemKey(activeItem) === key : false);
                        if (item.resultType === "product" && item.product) {
                          return (
                            <ProductSearchResultItem
                              key={`${item.group}-${item.id}`}
                              product={item.product}
                              active={isActive}
                              className={cn(
                                "rounded-none border",
                                isActive
                                  ? "border-primary/40 shadow-sm"
                                  : "border-border/70 bg-card hover:border-primary/25",
                              )}
                              onMouseEnter={() => {
                                setKeyboardNavigation(false);
                                setActiveIndex(index);
                                setHoveredIndex(index);
                              }}
                              onMouseLeave={() =>
                                setHoveredIndex((current) => (current === index ? null : current))
                              }
                              onMouseDown={(event) => {
                                event.preventDefault();
                                setKeyboardNavigation(false);
                              }}
                              onClick={() => handleSelect(item)}
                            />
                          );
                        }
                        return (
                          <button
                            key={`${item.group}-${item.id}`}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 rounded-none border px-3 py-2.5 text-left transition",
                              isActive
                                ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                                : "border-border/70 bg-card text-foreground hover:border-primary/25 hover:bg-accent/30",
                            )}
                            onMouseEnter={() => {
                              setKeyboardNavigation(false);
                              setActiveIndex(index);
                              setHoveredIndex(index);
                            }}
                            onMouseLeave={() =>
                              setHoveredIndex((current) => (current === index ? null : current))
                            }
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setKeyboardNavigation(false);
                            }}
                            onClick={() => handleSelect(item)}
                          >
                            <span
                              className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-none border",
                                isActive
                                  ? "border-primary/40 bg-primary/15 text-primary"
                                  : "border-border bg-secondary/70 text-muted-foreground",
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {item.label}
                              </p>
                              {item.sublabel ? (
                                <p className="truncate text-xs text-muted-foreground">
                                  {item.sublabel}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noResults")}</p>
            )}
          </section>
        ) : (
          <div className="space-y-3">
            {recentItems.length ? (
              <section className="rounded-none border border-border/70 bg-secondary/20 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("recentSearchesTitle")}
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                    onClick={clearRecentSearches}
                  >
                    {t("clearRecentSearches")}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recentItems.map((item) => {
                    const key = itemKey(item);
                    const index = indexByItemId.get(key) ?? 0;
                    const Icon = item.icon;
                    const isActive =
                      hoveredIndex === index ||
                      (keyboardNavigation && activeItem ? itemKey(activeItem) === key : false);
                    return (
                      <button
                        key={`${item.group}-${item.id}`}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-none border px-3 py-2.5 text-left text-sm transition",
                          isActive
                            ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                            : "border-border/70 bg-card text-foreground hover:border-primary/25 hover:bg-accent/30",
                        )}
                        onMouseEnter={() => {
                          setKeyboardNavigation(false);
                          setActiveIndex(index);
                          setHoveredIndex(index);
                        }}
                        onMouseLeave={() =>
                          setHoveredIndex((current) => (current === index ? null : current))
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setKeyboardNavigation(false);
                        }}
                        onClick={() => handleSelect(item)}
                      >
                        <span
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-none border",
                            isActive
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border bg-secondary/70 text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="truncate font-medium text-foreground">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <div className="rounded-none border border-border/70 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              {t("typeMoreToSearch")}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {groupedActions.map((group) => {
            if (!group.items.length) {
              return null;
            }
            return (
              <section
                key={group.category}
                className="rounded-none border border-border/70 bg-secondary/20 p-3 sm:p-4"
              >
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`sections.${group.category}`)}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const key = itemKey(item);
                    const index = indexByItemId.get(key) ?? 0;
                    const isActive =
                      hoveredIndex === index ||
                      (keyboardNavigation && activeItem ? itemKey(activeItem) === key : false);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-none border px-3 py-2.5 text-left text-sm transition",
                          isActive
                            ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                            : "border-border/70 bg-card text-foreground hover:border-primary/25 hover:bg-accent/30",
                        )}
                        onMouseEnter={() => {
                          setKeyboardNavigation(false);
                          setActiveIndex(index);
                          setHoveredIndex(index);
                        }}
                        onMouseLeave={() =>
                          setHoveredIndex((current) => (current === index ? null : current))
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setKeyboardNavigation(false);
                        }}
                        onClick={() => handleSelect(item)}
                      >
                        <span
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-none border",
                            isActive
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border bg-secondary/70 text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="font-medium text-foreground">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
