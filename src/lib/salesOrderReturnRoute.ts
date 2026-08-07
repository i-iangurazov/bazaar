type SearchParamsReader = Pick<URLSearchParams, "get">;

export const resolveLegacySalesReturnRedirect = (searchParams: SearchParamsReader) => {
  if (searchParams.get("mode") !== "return") {
    return null;
  }

  const registerId = searchParams.get("registerId")?.trim();
  if (!registerId) {
    return "/pos/history";
  }

  const targetParams = new URLSearchParams({ registerId });
  return `/pos/history?${targetParams.toString()}`;
};
