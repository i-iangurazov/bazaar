import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthTokenStatus } from "@/server/services/authTokens";
import { ResetTokenForm } from "./reset-token-form";

export const dynamic = "force-dynamic";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("reset");
  return { title: t("resetTitle") };
};

type ResetTokenPageProps = {
  params: Promise<{ token: string }>;
};

const ResetTokenPage = async ({ params }: ResetTokenPageProps) => {
  const { token } = await params;
  const status = await getAuthTokenStatus({
    purpose: "PASSWORD_RESET",
    token,
    requireUser: true,
  });

  if (status === "valid") {
    return <ResetTokenForm token={token} />;
  }

  const t = await getTranslations("reset");
  const tErrors = await getTranslations("errors");

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
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
            <Link href="/reset">{t("requestNewLink")}</Link>
            <Link href="/login">{t("backToLogin")}</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetTokenPage;
