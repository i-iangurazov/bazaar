import { getServerSession } from "next-auth";

import { InventoryReceivingPage } from "@/components/inventory/receiving-workflow";
import { authOptions } from "@/server/auth/nextauth";

const ReceivingPage = async () => {
  const session = await getServerSession(authOptions);
  const draftOwner =
    session?.user?.id && session.user.organizationId
      ? { userId: session.user.id, organizationId: session.user.organizationId }
      : null;

  return <InventoryReceivingPage draftOwner={draftOwner} />;
};

export default ReceivingPage;
