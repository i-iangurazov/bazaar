export const BAKAI_STORE_MAX_PRODUCTS_PER_REQUEST = 1000;
export const BAKAI_STORE_REQUEST_TIMEOUT_MS = 90_000;
export const BAKAI_STORE_DEFAULT_CITY_ID = "1";

export type BakaiStoreApiProductAttribute = {
  name: string;
  value: string;
};

export type BakaiStoreApiProduct = {
  name: string;
  sku: string;
  price: number;
  category_name: string;
  description: string;
  images: string[];
  branch_id: number;
  quantity: number;
  is_active: boolean;
  brand_name?: string;
  discount_amount?: number;
  similar_products_sku?: string[];
  url?: string;
  is_adult?: boolean;
  is_master?: boolean;
  sort_order?: number;
  sort_order_reason?: string;
  attributes?: BakaiStoreApiProductAttribute[];
};

export type BakaiStoreApiPayload = {
  products: BakaiStoreApiProduct[];
};

export type BakaiStoreApiResponse = {
  status: number;
  ok: boolean;
  body: unknown;
};

type BakaiStoreApiClientInput = {
  token: string;
  payload: BakaiStoreApiPayload;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const resolveImportEndpoint = () => {
  const configured = process.env.BAKAI_STORE_IMPORT_ENDPOINT?.trim();
  if (configured) {
    return configured;
  }
  throw new Error("bakaiStoreImportEndpointMissing");
};

const resolveCityId = () => process.env.BAKAI_STORE_CITY_ID?.trim() || BAKAI_STORE_DEFAULT_CITY_ID;

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const shouldRetryStatus = (status: number) => status === 408 || status === 429 || status >= 500;

const parseJsonSafely = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export const getBakaiStoreImportEndpoint = () => resolveImportEndpoint();

export const getBakaiStoreCityId = () => resolveCityId();

export const sendBakaiStoreProducts = async (
  input: BakaiStoreApiClientInput,
): Promise<BakaiStoreApiResponse> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(resolveImportEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          CityId: resolveCityId(),
        },
        body: JSON.stringify(input.payload),
        signal: input.signal,
      });

      const body = await parseJsonSafely(response);
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

  throw lastError instanceof Error ? lastError : new Error("bakaiStoreApiRequestFailed");
};

export const probeBakaiStoreConnection = async (input: {
  token: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}) => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(resolveImportEndpoint(), {
    method: "OPTIONS",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      CityId: resolveCityId(),
    },
    signal: input.signal,
  });

  return {
    ok: response.ok || [400, 401, 403, 405].includes(response.status),
    status: response.status,
    endpoint: resolveImportEndpoint(),
    cityId: resolveCityId(),
  };
};
