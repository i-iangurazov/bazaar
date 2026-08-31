import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("auth");
  return { title: t("loginTitle"), description: t("loginSubtitle") };
};

const LoginLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["auth", "common", "errors"]}>{children}</RouteIntlProvider>
);

export default LoginLayout;
