import { redirect } from "next/navigation";

import { buildPosCashMovementHref } from "@/lib/posCashMovementRoute";

const FinanceIncomePage = () => redirect(buildPosCashMovementHref("PAY_IN"));

export default FinanceIncomePage;
