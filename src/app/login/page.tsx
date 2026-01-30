import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LoginPage = async () => {
  const t = await getTranslations("auth");
  const mode = process.env.SIGNUP_MODE ?? "invite_only";
  const isOpenMode = mode === "open";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-8 sm:py-12">
      <div className="w-full max-w-md flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("loginTitle")}</CardTitle>
          <p className="text-sm text-gray-500">{t("loginSubtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <LoginForm />
          <div className="flex flex-col gap-2 text-sm text-gray-600">
            {isOpenMode ? (
              <a href="/signup" className="font-semibold text-ink underline">
                {t("createAccount")}
              </a>
            ) : (
              <>
                <a href="/signup" className="font-semibold text-ink underline">
                  {t("requestAccess")}
                </a>
                <a href="/invite" className="font-semibold text-ink underline">
                  {t("acceptInvite")}
                </a>
                <span className="text-xs text-gray-500">{t("inviteHint")}</span>
              </>
            )}
          </div>
          <p className="mt-4 text-xs text-gray-400">{t("demoAccounts")}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
