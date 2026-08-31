import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { AuthBrand } from "@/components/auth-brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthTokenStatus } from "@/server/services/authTokens";

export const dynamic = "force-dynamic";

type RegistrationTokenLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
};

const RegistrationTokenLayout = async ({ children, params }: RegistrationTokenLayoutProps) => {
  const { token } = await params;
  const status = await getAuthTokenStatus({
    purpose: "REGISTRATION",
    token,
    requireUser: true,
  });
  if (status === "valid") {
    return children;
  }

  const t = await getTranslations("registerBusiness");
  const tErrors = await getTranslations("errors");
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-center">
        <AuthBrand />
      </div>
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t("linkUnavailableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground" role="status">
            {status === "expired" ? tErrors("tokenExpired") : tErrors("tokenInvalid")}
          </p>
          <p className="text-sm text-muted-foreground">{t("linkUnavailableDescription")}</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/signup">{t("restartRegistration")}</Link>
            <Link href="/login">{t("goToLogin")}</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegistrationTokenLayout;
