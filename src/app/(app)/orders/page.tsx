import { redirect } from "next/navigation";

const OrdersRedirectPage = () => {
  redirect("/sales/orders");
};

export default OrdersRedirectPage;
