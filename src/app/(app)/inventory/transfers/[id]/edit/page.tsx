import { InventoryTransfersPage } from "@/components/inventory/transfer-workflow";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const TransferEditPage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const documentId = decodeURIComponent(params.id);
  const documentKey = getParam(searchParams?.documentKey) ?? `TRANSFER:TRANSFER:${documentId}`;
  const backHref = resolveSafeReturnTo(getParam(searchParams?.returnTo));

  return <InventoryTransfersPage editDocumentKey={documentKey} editBackHref={backHref} />;
};

export default TransferEditPage;
