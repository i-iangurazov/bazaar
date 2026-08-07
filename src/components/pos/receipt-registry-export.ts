type ReceiptPage<T> = {
  items: T[];
  total: number;
};

export const fetchAllReceiptPages = async <T>(input: {
  fetchPage: (page: number, pageSize: number) => Promise<ReceiptPage<T>>;
  pageSize?: number;
}) => {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 100, 100));
  const firstPage = await input.fetchPage(1, pageSize);
  const rows = [...firstPage.items];
  const totalPages = Math.ceil(firstPage.total / pageSize);

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await input.fetchPage(page, pageSize);
    rows.push(...result.items);
  }

  return rows;
};
