export const reportStoreQueryParam = "storeId";

export const readAuthorizedReportStoreId = (
  params: Pick<URLSearchParams, "get">,
  authorizedStoreIds: readonly string[],
) => {
  const requestedStoreId = params.get(reportStoreQueryParam)?.trim() ?? "";
  if (!requestedStoreId || !authorizedStoreIds.includes(requestedStoreId)) {
    return "";
  }
  return requestedStoreId;
};

export const reportStoreRouteNeedsCanonicalization = (
  params: Pick<URLSearchParams, "get">,
  authorizedStoreIds: readonly string[],
) => {
  const requestedStoreId = params.get(reportStoreQueryParam)?.trim() ?? "";
  return Boolean(requestedStoreId && !authorizedStoreIds.includes(requestedStoreId));
};

export const writeReportStoreRouteState = (currentQuery: string, storeId: string) => {
  const params = new URLSearchParams(currentQuery);
  const normalizedStoreId = storeId.trim();
  if (normalizedStoreId) {
    params.set(reportStoreQueryParam, normalizedStoreId);
  } else {
    params.delete(reportStoreQueryParam);
  }
  return params.toString();
};
