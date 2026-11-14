import type { AppleSignedTransaction, AppleTransactionHistory } from "./appleBilling";

type Outcome = { index: number } & (
  | { success: true; confirmation: { transactionId: string; status: string } }
  | { success: false; reason: string; retryable: boolean }
);
type Ports = {
  begin: () => Promise<AppleTransactionHistory>;
  next: (cursor: string) => Promise<AppleTransactionHistory>;
  record: (transactions: string[]) => Promise<{ results: Outcome[] }>;
  finish: (transactionId: string) => Promise<unknown>;
  progress: (count: number) => void;
  isCurrent: () => boolean;
};

/** In-memory progress only: no signed evidence is persisted in web storage. */
export class AppleRestoreSession {
  constructor(readonly organizationId: string | null) {}
  private work: {
    page: AppleTransactionHistory;
    offset: number;
    cursors: Set<string>;
    review: boolean;
    checked: Set<string>;
    retries: AppleSignedTransaction[];
  } | null = null;

  get pending() {
    return this.work !== null;
  }

  async resume(ports: Ports): Promise<{ review: boolean; complete: boolean }> {
    if (!this.work)
      this.work = {
        page: await ports.begin(),
        offset: 0,
        cursors: new Set(),
        review: false,
        checked: new Set(),
        retries: [],
      };
    const work = this.work;
    do {
      if (!ports.isCurrent()) throw new Error("applePurchaseOrganizationMismatch");
      if (work.page.unverifiedTransactionIds.length) work.review = true;
      while (work.offset < work.page.transactions.length) {
        if (!ports.isCurrent()) throw new Error("applePurchaseOrganizationMismatch");
        const batch = work.page.transactions.slice(work.offset, work.offset + 50);
        // Keep the offset until the whole response is available. A lost response
        // safely repeats the same verified receipts instead of restarting history.
        const saved = await ports.record(
          batch.map((transaction) => transaction.signedTransactionInfo),
        );
        const indexes = new Set(saved.results.map((result) => result.index));
        if (
          saved.results.length !== batch.length ||
          indexes.size !== batch.length ||
          saved.results.some(
            (result) =>
              !Number.isInteger(result.index) ||
              result.index < 0 ||
              result.index >= batch.length ||
              (result.success &&
                result.confirmation.transactionId !== batch[result.index].transactionId),
          )
        )
          throw new Error("appleHistoryIncomplete");
        if (!ports.isCurrent()) throw new Error("applePurchaseOrganizationMismatch");
        for (const result of saved.results) {
          const transaction = batch[result.index];
          if (!result.success) {
            if (result.retryable) work.retries.push(transaction);
            else work.review = true;
            continue;
          }
          if (result.confirmation.status === "REVIEW") work.review = true;
          try {
            if (!ports.isCurrent()) throw new Error("applePurchaseOrganizationMismatch");
            await ports.finish(transaction.transactionId);
            work.checked.add(transaction.transactionId);
          } catch {
            work.retries.push(transaction);
          }
        }
        work.offset += batch.length;
        ports.progress(work.checked.size);
      }
      const cursor = work.page.nextCursor;
      if (!cursor) break;
      if (!ports.isCurrent()) throw new Error("applePurchaseOrganizationMismatch");
      if (work.cursors.has(cursor)) throw new Error("appleHistoryIncomplete");
      const page = await ports.next(cursor);
      work.cursors.add(cursor);
      work.page = page;
      work.offset = 0;
    } while (true);
    if (work.retries.length) {
      work.page = { transactions: work.retries, unverifiedTransactionIds: [], nextCursor: null };
      work.retries = [];
      work.offset = 0;
      return { review: true, complete: false };
    }
    this.work = null;
    return { review: work.review, complete: true };
  }
}
