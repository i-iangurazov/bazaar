import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("verify");
  return { title: t("title"), description: t("success") };
};

const VerifyLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["verify", "common", "errors"]}>{children}</RouteIntlProvider>
);

export default VerifyLayout;
