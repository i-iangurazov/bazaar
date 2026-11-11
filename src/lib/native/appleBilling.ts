import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { isIOS, isPluginAvailable } from "@/lib/native/platform";

export type AppleProduct = {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
  /** Storefront decimal metadata. Server-verified transactions determine money. */
  price: string;
  currencyCode: string;
  type: "AUTO_RENEWABLE" | "NON_RENEWING" | "CONSUMABLE" | "NON_CONSUMABLE";
  subscriptionPeriod?: { value: number; unit: "day" | "week" | "month" | "year" };
  subscriptionGroupId?: string;
};

/** Evidence for server verification; receiving this object never grants access. */
export type AppleSignedTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  signedTransactionInfo: string;
  appAccountToken?: string;
  purchaseDate: string;
  expirationDate?: string;
  revocationDate?: string;
  environment?: string;
  ownershipType: string;
  isUpgraded: boolean;
};

export type AppleProductResult = { products: AppleProduct[]; missingProductIds: string[] };
export type ApplePurchaseResult =
  | { status: "purchased"; transaction: AppleSignedTransaction }
  | { status: "pending" }
  | { status: "cancelled"; cancellationAcknowledged: boolean; cancellationRecorded: boolean }
  | {
    /** This invocation never called StoreKit; this does not assert no prior payment. */
    status: "not_started";
    cancellationAcknowledged: boolean;
    cancellationRecorded: boolean;
    error: { code: string; serverCode?: string };
  };
export type AppleCancellationRetryResult = {
  pendingCount: number;
  acknowledgedCount: number;
  recordedCount: number;
};
export type AppleUnfinishedTransactions = {
  transactions: AppleSignedTransaction[];
  unverifiedTransactionIds: string[];
};
export type AppleTransactionHistory = AppleUnfinishedTransactions & { nextCursor: string | null };
export type AppleTransactionUpdate =
  | { transaction: AppleSignedTransaction; error?: never }
  | { error: { code: "APPLE_UNVERIFIED_TRANSACTION" }; transaction?: never };

interface BazaarAppleBillingPlugin {
  getProducts(options: { productIds: string[] }): Promise<AppleProductResult>;
  // Native resolves the SKU and appAccountToken through the authenticated server.
  purchase(options: { intentId: string }): Promise<ApplePurchaseResult>;
  retryCancellations(): Promise<AppleCancellationRetryResult>;
  getUnfinishedTransactions(): Promise<AppleUnfinishedTransactions>;
  getTransactionHistory(options: { cursor?: string }): Promise<AppleTransactionHistory>;
  restorePurchases(): Promise<AppleTransactionHistory>;
  // Native checks the server's durable acknowledgement before calling finish().
  finishTransaction(options: { transactionId: string }): Promise<{ finished: true }>;
  showManageSubscriptions(): Promise<void>;
  requestRefund(options: { transactionId: string }): Promise<{ status: "submitted" | "cancelled" }>;
  addListener(
    eventName: "transactionUpdated",
    listener: (event: AppleTransactionUpdate) => void,
  ): Promise<PluginListenerHandle>;
}

const AppleBilling = registerPlugin<BazaarAppleBillingPlugin>("BazaarAppleBilling");

export class AppleBillingError extends Error {
  readonly code: string;
  readonly serverCode?: string;

  constructor(code: string, serverCode?: string) {
    super(code);
    this.name = "AppleBillingError";
    this.code = code;
    this.serverCode = serverCode;
  }
}

export const isAppleBillingAvailable = () => isIOS() && isPluginAvailable("BazaarAppleBilling");

const normalizeError = (error: unknown): AppleBillingError => {
  if (error instanceof AppleBillingError) return error;
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; data?: { serverCode?: unknown }; serverCode?: unknown };
    const code = typeof value.code === "string" ? value.code : "APPLE_STORE_ERROR";
    const rawServerCode = value.data?.serverCode ?? value.serverCode;
    return new AppleBillingError(code, typeof rawServerCode === "string" ? rawServerCode : undefined);
  }
  return new AppleBillingError("APPLE_STORE_ERROR");
};

const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (!isAppleBillingAvailable()) throw new AppleBillingError("APPLE_BILLING_UNAVAILABLE");
  try {
    return await operation();
  } catch (error) {
    throw normalizeError(error);
  }
};

/** Pass IDs from the server's approved catalog. Missing IDs are never purchasable. */
export const getAppleProducts = async (productIds: string[]): Promise<AppleProductResult> => {
  if (!isAppleBillingAvailable()) throw new AppleBillingError("APPLE_BILLING_UNAVAILABLE");
  const unique = [...new Set(productIds)];
  const result: AppleProductResult = { products: [], missingProductIds: [] };
  // The full versioned catalog can exceed one StoreKit request. Fetch every
  // approved addition/term combination without a burst of parallel requests.
  for (let index = 0; index < unique.length; index += 100) {
    const batch = await invoke(() => AppleBilling.getProducts({ productIds: unique.slice(index, index + 100) }));
    result.products.push(...batch.products);
    result.missingProductIds.push(...batch.missingProductIds);
  }
  return result;
};

/** A purchased result must be confirmed by the server before access is refreshed. */
export const purchaseAppleProduct = (intentId: string): Promise<ApplePurchaseResult> =>
  invoke(() => AppleBilling.purchase({ intentId }));

/** Retry only native-journaled definite cancellations with the current session. */
export const retryAppleCancellations = () => invoke(() => AppleBilling.retryCancellations());

/** Safe background recovery: unlike restore, this never asks for an Apple login. */
export const getUnfinishedAppleTransactions = () =>
  invoke(() => AppleBilling.getUnfinishedTransactions());

/** Continue until nextCursor is null; do not silently discard older purchases. */
export const getAppleTransactionHistory = (cursor?: string) =>
  invoke(() => AppleBilling.getTransactionHistory(cursor ? { cursor } : {}));

/** Explicit user action: AppStore.sync may display an Apple Account login sheet. */
export const restoreApplePurchases = () => invoke(() => AppleBilling.restorePurchases());

/** Call after server confirmation. Native independently verifies its durable ACK. */
export const finishAppleTransaction = (transactionId: string) =>
  invoke(() => AppleBilling.finishTransaction({ transactionId }));

export const showAppleSubscriptionManagement = () =>
  invoke(() => AppleBilling.showManageSubscriptions());

/** Submitted means Apple received a request; notifications determine any refund. */
export const requestAppleRefund = (transactionId: string) =>
  invoke(() => AppleBilling.requestRefund({ transactionId }));

export const addAppleTransactionListener = (listener: (event: AppleTransactionUpdate) => void) =>
  invoke(() => AppleBilling.addListener("transactionUpdated", listener));
