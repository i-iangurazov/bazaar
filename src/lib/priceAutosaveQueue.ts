import type { ProductPriceAutosaveRequest, ProductPricePatch } from "./productPriceAutosave";
export type PriceSaveReceipt = {
  status: "SAVED";
  version: string;
  prices: ProductPricePatch[];
  stored?: Array<{
    variantId: string | null;
    overridePriceKgs: number | null;
    retailPriceKgs: number | null;
    wholesalePriceKgs: number | null;
  }>;
  changed: boolean;
};
export type PriceSaveState = {
  status: "idle" | "saving" | "saved" | "error" | "conflict" | "checking";
  error?: unknown;
  pending: boolean;
};
type Options = {
  productId: string;
  storeId: string;
  version: string;
  context: () => Pick<
    ProductPriceAutosaveRequest,
    "unitId" | "currencyCode" | "currencyRateKgsPerUnit"
  >;
  collect: () => ProductPricePatch[];
  hasDirty: () => boolean;
  save: (request: ProductPriceAutosaveRequest) => Promise<PriceSaveReceipt>;
  reconcile: (
    request: ProductPriceAutosaveRequest,
  ) => Promise<PriceSaveReceipt | { status: "CANCELED" }>;
  persist: (request: ProductPriceAutosaveRequest | null) => void;
  acknowledge: (request: ProductPricePatch[], receipt: PriceSaveReceipt) => void;
  restore: (prices: ProductPricePatch[]) => void;
  refresh: () => Promise<string>;
  onSaved: (version: string) => void;
  onState: (state: PriceSaveState) => void;
};
/** One writer per mounted store/product. Unknown outcomes retain their exact request key. */
export class PriceAutosaveQueue {
  private version: string;
  private pending?: ProductPriceAutosaveRequest;
  private running?: Promise<boolean>;
  private queued = false;
  private disposed = false;
  private conflict = false;
  private conflictError?: unknown;
  private recovery?: ProductPriceAutosaveRequest;
  constructor(private options: Options) {
    this.version = options.version;
  }
  get unresolved() {
    return Boolean(this.pending || this.running);
  }
  syncVersion(version: string) {
    if (!this.unresolved && !this.conflict && !this.options.hasDirty()) this.version = version;
  }
  private state(status: PriceSaveState["status"], error?: unknown) {
    if (!this.disposed) this.options.onState({ status, error, pending: Boolean(this.pending) });
  }
  edited() {
    if (!this.unresolved && !this.conflict) this.state("idle");
  }
  invalidate(error: unknown) {
    this.conflict = true;
    this.conflictError = error;
    this.queued = false;
    this.state("conflict", error);
  }
  dispose() {
    this.disposed = true;
  }
  private clear() {
    this.pending = undefined;
    this.recovery = undefined;
    try {
      this.options.persist(null);
    } catch {
      /* A retained receipt can safely be reconciled. */
    }
  }
  save(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.recovery) return this.recover(this.recovery);
    if (this.conflict && this.pending) return this.recover(this.pending);
    if (this.conflict) return Promise.resolve(false);
    this.queued = true;
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  async flushManual() {
    if (this.running) return this.running;
    if (this.pending) return this.save();
    // The ordinary Save action still validates and commits the entire form itself.
    return true;
  }
  private async drain() {
    while (this.queued && !this.disposed) {
      this.queued = false;
      const retrying = Boolean(this.pending);
      if (!this.pending) {
        let prices: ProductPricePatch[];
        try {
          prices = this.options.collect();
        } catch (error) {
          this.state("error", error);
          return false;
        }
        if (!prices.length) return true;
        const request = {
          ...this.options.context(),
          productId: this.options.productId,
          storeId: this.options.storeId,
          expectedVersion: this.version,
          idempotencyKey: crypto.randomUUID(),
          prices,
        };
        try {
          this.options.persist(request);
        } catch {
          this.state("error", new Error("productPreparationStorageUnavailable"));
          return false;
        }
        this.pending = request;
      }
      const request = this.pending;
      this.state("saving");
      try {
        const result = await this.options.save(request);
        this.clear();
        if (this.disposed) return true;
        if (this.conflict) {
          this.state("conflict", this.conflictError);
          return false;
        }
        this.version = result.version;
        this.options.acknowledge(request.prices, result);
        this.options.onSaved(result.version);
        this.state("saved");
        // A newer settled edit may have been made while an unknown result was pending.
        if (retrying) this.queued = true;
      } catch (error) {
        if (this.disposed) return false;
        const message = error instanceof Error ? error.message : "";
        const code = (error as { data?: { code?: string } })?.data?.code;
        if (["BAD_REQUEST", "CONFLICT"].includes(code ?? "") && message !== "requestInProgress")
          this.clear();
        if (message === "priceAutosaveAttemptClosed") {
          this.clear();
          this.version = request.expectedVersion;
          const ctx = this.options.context();
          if (
            ctx.unitId !== request.unitId ||
            ctx.currencyCode !== request.currencyCode ||
            ctx.currencyRateKgsPerUnit !== request.currencyRateKgsPerUnit
          ) {
            this.invalidate(new Error("priceAutosaveConflict"));
            return false;
          }
          this.options.restore(request.prices);
          this.state("error", new Error("priceAutosaveNotApplied"));
          return false;
        }
        if (message === "priceAutosaveConflict" || message === "productChangedElsewhere") {
          this.clear();
          this.conflict = true;
          this.conflictError = error;
          this.state("conflict", error);
        } else this.state("error", error);
        return false;
      }
    }
    return !this.disposed;
  }
  async recover(request: ProductPriceAutosaveRequest) {
    if (this.running) return this.running;
    this.pending = request;
    this.recovery = request;
    this.state("checking");
    this.running = (async () => {
      try {
        const result = await this.options.reconcile(request);
        if (this.disposed) return false;
        if (result.status === "SAVED") {
          // A receipt can predate another user's edit. Refresh current data; never replay old UI values.
          this.version = await this.options.refresh();
          if (this.disposed) return false;
          this.clear();
          this.conflict = false;
          this.conflictError = undefined;
          this.options.onSaved(this.version);
          this.state("saved");
          return true;
        }
        this.clear();
        this.version = request.expectedVersion;
        const ctx = this.options.context();
        if (
          ctx.unitId !== request.unitId ||
          ctx.currencyCode !== request.currencyCode ||
          ctx.currencyRateKgsPerUnit !== request.currencyRateKgsPerUnit
        ) {
          this.invalidate(new Error("priceAutosaveConflict"));
          return false;
        }
        this.options.restore(request.prices);
        this.state("error", new Error("priceAutosaveNotApplied"));
        return false;
      } catch (error) {
        this.state("error", error);
        return false;
      }
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  async reload() {
    if (this.unresolved) return false;
    this.state("checking");
    try {
      const version = await this.options.refresh();
      if (this.disposed) return false;
      this.version = version;
      this.conflict = false;
      this.conflictError = undefined;
      this.options.onSaved(version);
      this.state("idle");
      return true;
    } catch (error) {
      this.state("conflict", error);
      return false;
    }
  }
}
