export type GuidanceRole = "ADMIN" | "MANAGER" | "STAFF";

export type GuidanceFeature =
  | "imports"
  | "exports"
  | "analytics"
  | "compliance"
  | "supportToolkit";

export type GuidancePageKey =
  | "dashboard"
  | "products"
  | "inventory"
  | "purchaseOrders"
  | "stockCounts"
  | "exports"
  | "users";

export type GuidanceAccess = {
  role: GuidanceRole;
  features: GuidanceFeature[];
};

export type TipPlacement = "top" | "right" | "bottom" | "left";

export type GuidanceTipDefinition = {
  id: string;
  pageKey: GuidancePageKey;
  selector: string;
  titleKey: string;
  bodyKey: string;
  placement?: TipPlacement;
  roles?: GuidanceRole[];
  requiredFeature?: GuidanceFeature;
};

export type GuidanceTourStep = {
  id: string;
  selector: string;
  titleKey: string;
  bodyKey: string;
  placement?: TipPlacement;
  roles?: GuidanceRole[];
  requiredFeature?: GuidanceFeature;
};

export type GuidanceTourDefinition = {
  id: string;
  pageKey: GuidancePageKey;
  path: string;
  labelKey: string;
  roles?: GuidanceRole[];
  requiredFeature?: GuidanceFeature;
  steps: GuidanceTourStep[];
};

export type GuidanceTourRuntimeState = {
  completedTours: Set<string>;
  dismissedAutoTours: Set<string>;
  toursDisabled: boolean;
};

export const getGuidancePageKey = (pathname: string): GuidancePageKey | null => {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized.startsWith("/dashboard")) {
    return "dashboard";
  }
  if (normalized.startsWith("/products")) {
    return "products";
  }
  if (normalized.startsWith("/inventory/counts")) {
    return "stockCounts";
  }
  if (normalized.startsWith("/inventory")) {
    return "inventory";
  }
  if (normalized.startsWith("/purchase-orders")) {
    return "purchaseOrders";
  }
  if (normalized.startsWith("/reports/exports")) {
    return "exports";
  }
  if (normalized.startsWith("/settings/users")) {
    return "users";
  }
  return null;
};

const hasFeature = (features: GuidanceFeature[], requiredFeature?: GuidanceFeature) => {
  if (!requiredFeature) {
    return true;
  }
  return features.includes(requiredFeature);
};

const hasRole = (role: GuidanceRole, roles?: GuidanceRole[]) => {
  if (!roles || roles.length === 0) {
    return true;
  }
  return roles.includes(role);
};

export const filterGuidanceTips = (
  tips: GuidanceTipDefinition[],
  access: GuidanceAccess,
): GuidanceTipDefinition[] => {
  return tips.filter(
    (tip) => hasRole(access.role, tip.roles) && hasFeature(access.features, tip.requiredFeature),
  );
};

export const filterGuidanceTourSteps = (
  steps: GuidanceTourStep[],
  access: GuidanceAccess,
): GuidanceTourStep[] => {
  return steps.filter(
    (step) => hasRole(access.role, step.roles) && hasFeature(access.features, step.requiredFeature),
  );
};

export const filterGuidanceTours = (
  tours: GuidanceTourDefinition[],
  access: GuidanceAccess,
): GuidanceTourDefinition[] => {
  return tours
    .filter(
      (tour) => hasRole(access.role, tour.roles) && hasFeature(access.features, tour.requiredFeature),
    )
    .map((tour) => ({
      ...tour,
      steps: filterGuidanceTourSteps(tour.steps, access),
    }))
    .filter((tour) => tour.steps.length > 0);
};

export const shouldAutoRunTour = (state: GuidanceTourRuntimeState, tourId: string) => {
  if (state.toursDisabled) {
    return false;
  }
  if (state.completedTours.has(tourId)) {
    return false;
  }
  if (state.dismissedAutoTours.has(tourId)) {
    return false;
  }
  return true;
};

export const defaultTourByRole: Record<GuidanceRole, string> = {
  ADMIN: "dashboard-tour",
  MANAGER: "dashboard-tour",
  STAFF: "dashboard-tour",
};

export const guidanceTips: GuidanceTipDefinition[] = [
  {
    id: "dashboard:store-filter",
    pageKey: "dashboard",
    selector: '[data-tour="dashboard-store-filter"]',
    titleKey: "tips.dashboard.storeFilter.title",
    bodyKey: "tips.dashboard.storeFilter.body",
    placement: "bottom",
  },
  {
    id: "dashboard:charts-link",
    pageKey: "dashboard",
    selector: '[data-tour="dashboard-analytics-link"]',
    titleKey: "tips.dashboard.analytics.title",
    bodyKey: "tips.dashboard.analytics.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
    requiredFeature: "analytics",
  },
  {
    id: "products:create",
    pageKey: "products",
    selector: '[data-tour="products-create"]',
    titleKey: "tips.products.create.title",
    bodyKey: "tips.products.create.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    id: "products:search",
    pageKey: "products",
    selector: '[data-tour="products-search"]',
    titleKey: "tips.products.search.title",
    bodyKey: "tips.products.search.body",
    placement: "bottom",
  },
  {
    id: "inventory:receive",
    pageKey: "inventory",
    selector: '[data-tour="inventory-receive"]',
    titleKey: "tips.inventory.receive.title",
    bodyKey: "tips.inventory.receive.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    id: "inventory:print-tags",
    pageKey: "inventory",
    selector: '[data-tour="inventory-print-tags"]',
    titleKey: "tips.inventory.printTags.title",
    bodyKey: "tips.inventory.printTags.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    id: "purchaseOrders:create",
    pageKey: "purchaseOrders",
    selector: '[data-tour="po-create"]',
    titleKey: "tips.purchaseOrders.create.title",
    bodyKey: "tips.purchaseOrders.create.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    id: "stockCounts:create",
    pageKey: "stockCounts",
    selector: '[data-tour="stock-count-create"]',
    titleKey: "tips.stockCounts.create.title",
    bodyKey: "tips.stockCounts.create.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    id: "exports:generate",
    pageKey: "exports",
    selector: '[data-tour="exports-generate"]',
    titleKey: "tips.exports.generate.title",
    bodyKey: "tips.exports.generate.body",
    placement: "bottom",
    roles: ["ADMIN", "MANAGER"],
    requiredFeature: "exports",
  },
  {
    id: "users:invite",
    pageKey: "users",
    selector: '[data-tour="users-invite"]',
    titleKey: "tips.users.invite.title",
    bodyKey: "tips.users.invite.body",
    placement: "bottom",
    roles: ["ADMIN"],
  },
];

export const guidanceTours: GuidanceTourDefinition[] = [
  {
    id: "dashboard-tour",
    pageKey: "dashboard",
    path: "/dashboard",
    labelKey: "tours.dashboard.label",
    steps: [
      {
        id: "scan-input",
        selector: '[data-tour="scan-input"]',
        titleKey: "tours.dashboard.steps.scan.title",
        bodyKey: "tours.dashboard.steps.scan.body",
      },
      {
        id: "dashboard-store-filter",
        selector: '[data-tour="dashboard-store-filter"]',
        titleKey: "tours.dashboard.steps.storeFilter.title",
        bodyKey: "tours.dashboard.steps.storeFilter.body",
      },
      {
        id: "dashboard-analytics-link",
        selector: '[data-tour="dashboard-analytics-link"]',
        titleKey: "tours.dashboard.steps.analytics.title",
        bodyKey: "tours.dashboard.steps.analytics.body",
        roles: ["ADMIN", "MANAGER"],
        requiredFeature: "analytics",
      },
    ],
  },
  {
    id: "products-tour",
    pageKey: "products",
    path: "/products",
    labelKey: "tours.products.label",
    steps: [
      {
        id: "products-search",
        selector: '[data-tour="products-search"]',
        titleKey: "tours.products.steps.search.title",
        bodyKey: "tours.products.steps.search.body",
      },
      {
        id: "products-create",
        selector: '[data-tour="products-create"]',
        titleKey: "tours.products.steps.create.title",
        bodyKey: "tours.products.steps.create.body",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        id: "products-print-tags",
        selector: '[data-tour="products-print-tags"]',
        titleKey: "tours.products.steps.printTags.title",
        bodyKey: "tours.products.steps.printTags.body",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    id: "inventory-tour",
    pageKey: "inventory",
    path: "/inventory",
    labelKey: "tours.inventory.label",
    steps: [
      {
        id: "inventory-receive",
        selector: '[data-tour="inventory-receive"]',
        titleKey: "tours.inventory.steps.receive.title",
        bodyKey: "tours.inventory.steps.receive.body",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        id: "inventory-adjust",
        selector: '[data-tour="inventory-adjust"]',
        titleKey: "tours.inventory.steps.adjust.title",
        bodyKey: "tours.inventory.steps.adjust.body",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        id: "inventory-transfer",
        selector: '[data-tour="inventory-transfer"]',
        titleKey: "tours.inventory.steps.transfer.title",
        bodyKey: "tours.inventory.steps.transfer.body",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    id: "purchase-orders-tour",
    pageKey: "purchaseOrders",
    path: "/purchase-orders",
    labelKey: "tours.purchaseOrders.label",
    steps: [
      {
        id: "po-create",
        selector: '[data-tour="po-create"]',
        titleKey: "tours.purchaseOrders.steps.create.title",
        bodyKey: "tours.purchaseOrders.steps.create.body",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        id: "po-table",
        selector: '[data-tour="po-table"]',
        titleKey: "tours.purchaseOrders.steps.table.title",
        bodyKey: "tours.purchaseOrders.steps.table.body",
      },
    ],
  },
  {
    id: "stock-counts-tour",
    pageKey: "stockCounts",
    path: "/inventory/counts",
    labelKey: "tours.stockCounts.label",
    steps: [
      {
        id: "stock-count-create",
        selector: '[data-tour="stock-count-create"]',
        titleKey: "tours.stockCounts.steps.create.title",
        bodyKey: "tours.stockCounts.steps.create.body",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        id: "stock-count-table",
        selector: '[data-tour="stock-count-table"]',
        titleKey: "tours.stockCounts.steps.table.title",
        bodyKey: "tours.stockCounts.steps.table.body",
      },
    ],
  },
  {
    id: "exports-tour",
    pageKey: "exports",
    path: "/reports/exports",
    labelKey: "tours.exports.label",
    roles: ["ADMIN", "MANAGER"],
    requiredFeature: "exports",
    steps: [
      {
        id: "exports-generate",
        selector: '[data-tour="exports-generate"]',
        titleKey: "tours.exports.steps.generate.title",
        bodyKey: "tours.exports.steps.generate.body",
        requiredFeature: "exports",
      },
      {
        id: "exports-jobs",
        selector: '[data-tour="exports-jobs"]',
        titleKey: "tours.exports.steps.jobs.title",
        bodyKey: "tours.exports.steps.jobs.body",
        requiredFeature: "exports",
      },
    ],
  },
  {
    id: "users-tour",
    pageKey: "users",
    path: "/settings/users",
    labelKey: "tours.users.label",
    roles: ["ADMIN"],
    steps: [
      {
        id: "users-invite",
        selector: '[data-tour="users-invite"]',
        titleKey: "tours.users.steps.invite.title",
        bodyKey: "tours.users.steps.invite.body",
      },
      {
        id: "users-table",
        selector: '[data-tour="users-table"]',
        titleKey: "tours.users.steps.table.title",
        bodyKey: "tours.users.steps.table.body",
      },
    ],
  },
];
