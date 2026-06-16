import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const ReceivingEditPage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const documentId = decodeURIComponent(params.id);
  const documentKey =
    getParam(searchParams?.documentKey) ?? `STOCK_RECEIVING:STOCK_RECEIVING:${documentId}`;
  const backHref = getParam(searchParams?.returnTo) ?? "/inventory/movements";

  return <InventoryReceivingPage editDocumentKey={documentKey} editBackHref={backHref} />;
};

export default ReceivingEditPage;
