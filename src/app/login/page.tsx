import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { AuthBrand } from "@/components/auth-brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LoginPage = async () => {
  const t = await getTranslations("auth");
  const mode = process.env.SIGNUP_MODE ?? "invite_only";
  const isOpenMode = mode === "open";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-8 sm:py-12">
      <div className="w-full max-w-md flex justify-center">
        <AuthBrand />
      </div>
      <div className="w-full max-w-md flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("loginTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("loginSubtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <LoginForm />
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {isOpenMode ? (
              <Link href="/signup" className="font-semibold text-primary hover:text-primary/80">
                {t("createAccount")}
              </Link>
            ) : (
              <>
                <Link href="/signup" className="font-semibold text-primary hover:text-primary/80">
                  {t("requestAccess")}
                </Link>
                <Link href="/invite" className="font-semibold text-primary hover:text-primary/80">
                  {t("acceptInvite")}
                </Link>
                <span className="text-xs text-muted-foreground">{t("inviteHint")}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
