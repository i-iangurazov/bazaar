import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";

import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";
import { normalizeDynamicRouteId } from "@/lib/dynamicRouteId";
import { resolveProductMovementEditDocumentKey } from "@/lib/productMovementEditDocumentKey";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { authOptions } from "@/server/auth/nextauth";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const ReceivingEditPage = async ({
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
    fallbackDocumentType: "STOCK_RECEIVING",
    fallbackReferenceType: "STOCK_RECEIVING",
  });
  if (!documentKey) {
    notFound();
  }
  const backHref = resolveSafeReturnTo(getParam(resolvedSearchParams.returnTo));
  const session = await getServerSession(authOptions);
  const draftOwner =
    session?.user?.id && session.user.organizationId
      ? { userId: session.user.id, organizationId: session.user.organizationId }
      : null;

  return (
    <InventoryReceivingPage
      draftOwner={draftOwner}
      editDocumentKey={documentKey}
      editBackHref={backHref}
    />
  );
};

export default ReceivingEditPage;
