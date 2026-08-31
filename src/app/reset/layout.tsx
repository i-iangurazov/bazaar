import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("reset");
  return { title: t("title") };
};

const ResetLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["reset", "common", "errors"]}>{children}</RouteIntlProvider>
);

export default ResetLayout;
