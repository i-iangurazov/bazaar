"use client";

import { useParams } from "next/navigation";

import { SalesOrderForm } from "@/components/sales-order-form";

export default function EditSalesOrderPage() {
  const params = useParams<{ id: string }>();
  return <SalesOrderForm mode="edit" orderId={String(params.id ?? "")} />;
}
