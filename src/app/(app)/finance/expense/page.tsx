import { redirect } from "next/navigation";

import { buildPosCashMovementHref } from "@/lib/posCashMovementRoute";

const FinanceExpensePage = () => redirect(buildPosCashMovementHref("PAY_OUT"));

export default FinanceExpensePage;
