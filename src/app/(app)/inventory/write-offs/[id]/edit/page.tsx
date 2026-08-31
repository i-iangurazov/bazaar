import { notFound } from "next/navigation";

import { InventoryWriteOffsPage } from "@/components/inventory/write-off-workflow";
import { normalizeDynamicRouteId } from "@/lib/dynamicRouteId";
import { resolveProductMovementEditDocumentKey } from "@/lib/productMovementEditDocumentKey";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const WriteOffEditPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const documentId = normalizeDynamicRouteId(id);
  if (!documentId) {
    notFound();
  }
  const documentKey = resolveProductMovementEditDocumentKey({
    routeId: documentId,
    requestedDocumentKey: getParam(resolvedSearchParams.documentKey),
    fallbackDocumentType: "WRITE_OFF",
    fallbackReferenceType: "WRITE_OFF",
  });
  if (!documentKey) {
    notFound();
  }
  const backHref = resolveSafeReturnTo(getParam(resolvedSearchParams.returnTo));

  return <InventoryWriteOffsPage editDocumentKey={documentKey} editBackHref={backHref} />;
};

export default WriteOffEditPage;
