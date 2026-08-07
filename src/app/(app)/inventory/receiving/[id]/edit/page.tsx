import { getServerSession } from "next-auth";

import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { authOptions } from "@/server/auth/nextauth";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const ReceivingEditPage = async ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const documentId = decodeURIComponent(params.id);
  const documentKey =
    getParam(searchParams?.documentKey) ?? `STOCK_RECEIVING:STOCK_RECEIVING:${documentId}`;
  const backHref = resolveSafeReturnTo(getParam(searchParams?.returnTo));
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
