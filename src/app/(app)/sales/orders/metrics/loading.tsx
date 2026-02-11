import { Spinner } from "@/components/ui/spinner";
import { getTranslations } from "next-intl/server";

const SalesOrdersMetricsLoading = async () => {
  const tCommon = await getTranslations("common");
  return (
    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" />
      {tCommon("loading")}
    </div>
  );
};

export default SalesOrdersMetricsLoading;
