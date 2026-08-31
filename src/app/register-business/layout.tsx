import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("registerBusiness");
  return { title: t("title") };
};

const RegisterBusinessLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["registerBusiness", "common", "errors"]}>
    {children}
  </RouteIntlProvider>
);

export default RegisterBusinessLayout;
