import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("signup");
  return { title: t("title") };
};

const SignupLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["signup", "common", "errors"]}>{children}</RouteIntlProvider>
);

export default SignupLayout;
