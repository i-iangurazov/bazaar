export const O_MARKET_DEFAULT_BASE_URL = "https://api-market.o.kg";
export const O_MARKET_MAX_PRODUCTS_PER_REQUEST = 1000;
export const O_MARKET_REQUEST_TIMEOUT_MS = 90_000;

export type OMarketApiImage =
  | {
      type: "url";
      image: string;
      is_primary_image?: boolean;
    }
  | {
      type: "base64";
      image: string;
      is_primary_image?: boolean;
    };

export type OMarketApiAttribute = {
  attribute_id: number;
  value_id: number;
};

export type OMarketApiProduct = {
  sku: string;
  title?: string;
  description?: string;
  category_id?: number;
  price: number;
  quantity: number | null;
  discount_type?: "PERCENTAGE" | "PRICE";
  discount_value?: number;
  images?: OMarketApiImage[];
  width?: number;
  height?: number;
  length?: number;
  weight?: number;
  currency?: "som" | string;
  location_id?: number | null;
  is_delivery_enabled?: boolean;
  attributes?: OMarketApiAttribute[];
};

export type OMarketApiPayload = {
  products: OMarketApiProduct[];
};

export type OMarketTaskResponse = {
  result?: {
    task_id?: number;
  };
  status?: string;
};

export type OMarketImportStatusRow = {
  id: number;
  sku: string;
  error_data: Array<Record<string, unknown>>;
  status: "success" | "error" | "in_progress" | string;
  import_task_id: number;
  product_id: number | null;
  created_at: string;
  updated_at: string;
};

export type OMarketApiResponse<TBody = unknown> = {
  status: number;
  ok: boolean;
  body: TBody;
};

type OMarketApiClientInput<TPayload = unknown> = {
  token: string;
  baseUrl?: string | null;
  payload?: TPayload;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const trimSlashes = (value: string) => value.replace(/\/+$/g, "");

export const normalizeOMarketBaseUrl = (value?: string | null) => {
  const raw = value?.trim() || O_MARKET_DEFAULT_BASE_URL;
  return trimSlashes(raw);
};

const buildUrl = (baseUrl: string | null | undefined, path: string, query?: URLSearchParams) => {
  const url = new URL(path, `${normalizeOMarketBaseUrl(baseUrl)}/`);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const shouldRetryStatus = (status: number) => status === 408 || status === 429 || status >= 500;

const parseJsonSafely = async <TBody>(response: Response): Promise<TBody | string | null> => {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as TBody;
  } catch {
    return text;
  }
};

const requestJson = async <TBody, TPayload = unknown>(input: {
  token: string;
  baseUrl?: string | null;
  path: string;
  method: "GET" | "POST" | "PUT";
  payload?: TPayload;
  query?: URLSearchParams;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<OMarketApiResponse<TBody | string | null>> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(buildUrl(input.baseUrl, input.path, input.query), {
        method: input.method,
        headers: {
          "X-Access-Token": input.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: input.payload === undefined ? undefined : JSON.stringify(input.payload),
        signal: input.signal,
      });
      const body = await parseJsonSafely<TBody>(response);
      if (!response.ok && attempt === 0 && shouldRetryStatus(response.status)) {
        await sleep(400);
        continue;
      }
      return {
        status: response.status,
        ok: response.ok,
        body,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("oMarketApiRequestFailed");
};

export const createOrUpdateOMarketProducts = async (
  input: OMarketApiClientInput<OMarketApiPayload>,
) =>
  requestJson<OMarketTaskResponse, OMarketApiPayload>({
    ...input,
    method: "POST",
    path: "/api/mia/v1/product/import/create-or-update/",
  });

export const fullSyncOMarketProducts = async (input: OMarketApiClientInput<OMarketApiPayload>) =>
  requestJson<OMarketTaskResponse, OMarketApiPayload>({
    ...input,
    method: "POST",
    path: "/api/mia/v1/product/import/full-sync/",
  });

export const updateOMarketStockPrice = async (input: OMarketApiClientInput<OMarketApiPayload>) =>
  requestJson<OMarketTaskResponse, OMarketApiPayload>({
    ...input,
    method: "PUT",
    path: "/api/mia/v1/product/import",
  });

export const getOMarketImportStatus = async (
  input: OMarketApiClientInput & { taskId: number },
) =>
  requestJson<OMarketImportStatusRow[]>({
    ...input,
    method: "GET",
    path: `/api/mia/v1/product/import/info/${input.taskId}`,
  });

export const listOMarketRemoteProducts = async (
  input: OMarketApiClientInput & { page?: number; limit?: number },
) =>
  requestJson<{
    products: Array<{ uuid: string; sku: string; price: number; quantity: number }>;
    page: number;
    next?: number | null;
    count: number;
  }>({
    ...input,
    method: "GET",
    path: "/api/mia/v1/product/list",
    query: new URLSearchParams({
      page: String(input.page ?? 1),
      limit: String(input.limit ?? 1),
    }),
  });

export const getOMarketCategoryTree = async (input: OMarketApiClientInput) =>
  requestJson<{
    result: Array<{ id: number; name: string; sub_categories: unknown[] }>;
    status: string;
  }>({
    ...input,
    method: "GET",
    path: "/api/mia/v1/category/tree",
  });

export const getOMarketCategoryAttributes = async (
  input: OMarketApiClientInput & { categoryId: number },
) =>
  requestJson<{
    result: Array<{
      id: number;
      create_label: string;
      values: Array<{ id: number; value: string }>;
    }>;
    status: string;
  }>({
    ...input,
    method: "GET",
    path: "/api/mia/v1/category/attribute",
    query: new URLSearchParams({ category: String(input.categoryId) }),
  });

export const getOMarketLocations = async (input: OMarketApiClientInput) =>
  requestJson<{
    result: Array<{ id: number; name: string; is_purchase_allowed: boolean }>;
    status: string;
  }>({
    ...input,
    method: "GET",
    path: "/api/mia/v1/locations/",
  });

export const uploadOMarketEncodedImage = async (
  input: OMarketApiClientInput<{ content: string }>,
) =>
  requestJson<{ result?: { url?: string }; status?: string }, { content: string }>({
    ...input,
    method: "POST",
    path: "/api/mia/v1/images/upload/encoded/",
  });

export const uploadOMarketImageFile = async (input: {
  token: string;
  baseUrl?: string | null;
  file: Blob;
  fileName?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}) => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("file", input.file, input.fileName ?? "image");
  const response = await fetchImpl(buildUrl(input.baseUrl, "/api/mia/v1/images/upload/"), {
    method: "POST",
    headers: {
      "X-Access-Token": input.token,
      Accept: "application/json",
    },
    body: form,
    signal: input.signal,
  });
  const body = await parseJsonSafely<{ result?: { url?: string }; status?: string }>(response);
  return {
    status: response.status,
    ok: response.ok,
    body,
  };
};
