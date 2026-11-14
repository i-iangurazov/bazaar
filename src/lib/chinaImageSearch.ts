// Public contract. Provider credentials and raw payloads never cross this boundary.
export const imageSearchMaxBytes = 3 * 1024 * 1024;
export type ImageSearchMode = "disabled" | "demo" | "live";
export type ImageSearchItem = {
  id: string;
  title: string;
  originalTitle: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  price: number | null;
  currency: "CNY";
  seller: string | null;
};
export type ImageSearchResult = {
  mode: "demo" | "live";
  channel: "1688";
  items: ImageSearchItem[];
  // One bounded first page in the prototype; no hidden billable pagination.
  total: number;
};
