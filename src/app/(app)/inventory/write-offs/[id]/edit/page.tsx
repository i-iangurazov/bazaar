import { InventoryWriteOffsPage } from "@/components/inventory/write-off-workflow";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const WriteOffEditPage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const documentId = decodeURIComponent(params.id);
  const documentKey = getParam(searchParams?.documentKey) ?? `WRITE_OFF:WRITE_OFF:${documentId}`;
  const backHref = resolveSafeReturnTo(getParam(searchParams?.returnTo));

  return <InventoryWriteOffsPage editDocumentKey={documentKey} editBackHref={backHref} />;
};

export default WriteOffEditPage;
