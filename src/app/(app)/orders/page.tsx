import { redirect } from "next/navigation";

const OrdersRedirectPage = () => {
  redirect("/purchase-orders");
};

export default OrdersRedirectPage;
