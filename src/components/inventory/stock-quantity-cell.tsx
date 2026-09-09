"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { InlineEditableCell } from "@/components/table/InlineEditableCell";
import { inlineEditRegistry } from "@/lib/inlineEdit/registry";
import { trpc } from "@/lib/trpc";

export function StockQuantityCell(props: {
  storeId: string;
  productId: string;
  variantId?: string | null;
  onHand: number;
  version: number;
}) {
  const locale = useLocale();
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const mutation = trpc.inventory.setOnHand.useMutation();
  return (
    <InlineEditableCell
      rowId={`${props.storeId}:${props.productId}:${props.variantId ?? "BASE"}`}
      row={{ snapshot: props, minStock: 0 }}
      value={props.onHand}
      definition={inlineEditRegistry.inventory.onHand}
      context={{ stockAdjustReason: t("stockAdjustment") }}
      role={session?.user?.role}
      locale={locale}
      columnLabel={t("onHand")}
      tTable={t}
      tCommon={tCommon}
      enabled
      executeMutation={async (operation) => {
        if (operation.route !== "inventory.setOnHand") throw new Error("Invalid stock operation");
        try {
          await mutation.mutateAsync(operation.input);
        } finally {
          await Promise.all([utils.products.invalidate(), utils.inventory.invalidate()]);
        }
      }}
    />
  );
}
