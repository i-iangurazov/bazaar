"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { PageHeader } from "@/components/page-header";
import { ProductForm } from "@/components/product-form";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

const NewProductPage = () => {
  const t = useTranslations("products");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const barcode = searchParams?.get("barcode")?.trim() ?? "";
  const requestedType = searchParams?.get("type")?.trim() ?? "";
  const isBundleDefault = requestedType === "bundle";
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const { toast } = useToast();
  const attributesQuery = trpc.attributes.list.useQuery();
  const unitsQuery = trpc.units.list.useQuery();

  const createMutation = trpc.products.create.useMutation({
    onSuccess: (product) => {
      toast({ variant: "success", description: t("createSuccess") });
      router.push(`/products/${product.id}`);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  if (session && !isAdmin) {
    return (
      <div>
        <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />
      <ProductForm
        initialValues={{
          sku: "",
          name: "",
          isBundle: isBundleDefault,
          category: "",
          baseUnitId: "",
          basePriceKgs: undefined,
          description: "",
          photoUrl: "",
          images: [],
          barcodes: barcode ? [barcode] : [],
          packs: [],
          variants: [],
          bundleComponents: [],
        }}
        attributeDefinitions={attributesQuery.data ?? []}
        units={unitsQuery.data ?? []}
        onSubmit={(values) => createMutation.mutate(values)}
        isSubmitting={createMutation.isLoading}
      />
      {createMutation.error ? (
        <p className="mt-3 text-sm text-red-500">
          {translateError(tErrors, createMutation.error)}
        </p>
      ) : null}
    </div>
  );
};

export default NewProductPage;
