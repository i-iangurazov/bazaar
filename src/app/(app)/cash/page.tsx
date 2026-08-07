import { redirect } from "next/navigation";

import { buildPosCashMovementHref } from "@/lib/posCashMovementRoute";

const CashPage = () => redirect(buildPosCashMovementHref());

export default CashPage;
