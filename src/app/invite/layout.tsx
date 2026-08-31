import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("invite");
  return { title: t("title"), description: t("entrySubtitle") };
};

const InviteLayout = ({ children }: { children: React.ReactNode }) => (
  <RouteIntlProvider namespaces={["invite", "common", "errors"]}>{children}</RouteIntlProvider>
);

export default InviteLayout;
